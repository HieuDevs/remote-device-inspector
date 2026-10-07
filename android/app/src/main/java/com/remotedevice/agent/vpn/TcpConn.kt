package com.remotedevice.agent.vpn

import android.util.Log
import org.json.JSONObject
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.channels.SelectionKey
import java.nio.channels.SocketChannel
import java.util.ArrayDeque

/**
 * One userspace TCP connection. We stand in for the remote peer towards the app
 * and relay bytes to a real, VPN-protected socket. Sequence handling is
 * deliberately minimal (no SACK, no windowing, no retransmission) — enough for
 * the request/response flows that API traffic consists of.
 */
class TcpConn(private val flow: Flow, private val nat: Nat, private val id: Int) : Upstream {

    private val mask = 0xffffffffL
    private var myseq = 1L          // our seq toward the app
    private var theirSeq = 0L       // next byte we expect from the app
    private val channel = SocketChannel.open()
    private var key: SelectionKey? = null
    private var connected = false
    private var appClosed = false
    var closed = false; private set

    private val pending = ArrayDeque<ByteArray>()     // app→upstream before connect
    private val outToUpstream = ArrayDeque<ByteBuffer>()
    private val readBuf = ByteBuffer.allocate(TcpConnConst.MSS)

    private var sniffed = false
    private var respSniffed = false
    private var scheme: String? = null
    private var firstByteAt = 0L
    private var bytesUp = 0L
    private var bytesDown = 0L
    private val startedAt = System.currentTimeMillis()
    private var host: String? = null

    fun onSyn(t: Tcp) {
        theirSeq = (t.seq + 1) and mask
        host = DnsCache.get(flow.dstAddr)
        try {
            channel.configureBlocking(false)
            // All traffic is forwarded raw to the real peer (VPN-protected so it
            // is not looped back through the tunnel). Nothing is decrypted.
            nat.protectSocket(channel.socket())
            channel.connect(InetSocketAddress(intToAddr(flow.dstAddr), flow.dstPort))
            key = nat.register(channel, SelectionKey.OP_CONNECT, this)
        } catch (e: Exception) {
            reset(); return
        }
        // Optimistic SYN-ACK so the app can start sending immediately.
        send(TCP_SYN or TCP_ACK, TcpConnConst.EMPTY)
        myseq = (myseq + 1) and mask
        reportOpen()
    }

    fun onSegment(t: Tcp) {
        if (t.rst) { close(); return }
        val len = t.payloadLength
        if (len > 0) {
            if (t.seq == theirSeq) {
                val p = t.payload()
                sniff(p)
                if (connected) enqueueUpstream(p) else pending.add(p)
                theirSeq = (theirSeq + len) and mask
                bytesUp += len
                send(TCP_ACK, TcpConnConst.EMPTY)
            } else {
                send(TCP_ACK, TcpConnConst.EMPTY) // duplicate / out of order
            }
        }
        if (t.fin) {
            theirSeq = (theirSeq + 1) and mask
            send(TCP_ACK, TcpConnConst.EMPTY)
            appClosed = true
            if (connected) try { channel.socket().shutdownOutput() } catch (_: Exception) {}
            maybeClose()
        }
    }

    override fun onReady(key: SelectionKey) {
        if (key.isConnectable) {
            if (channel.finishConnect()) {
                connected = true
                while (pending.isNotEmpty()) outToUpstream.add(ByteBuffer.wrap(pending.poll()))
                flushUpstream()
                updateInterest()
            }
        }
        if (key.isValid && key.isWritable) flushUpstream()
        if (key.isValid && key.isReadable) readUpstream()
    }

    override fun onError(e: Exception) {
        reset()
    }

    private fun enqueueUpstream(bytes: ByteArray) {
        outToUpstream.add(ByteBuffer.wrap(bytes))
        flushUpstream()
    }

    private fun flushUpstream() {
        try {
            while (outToUpstream.isNotEmpty()) {
                val buf = outToUpstream.peek()
                channel.write(buf)
                if (buf.hasRemaining()) break
                outToUpstream.poll()
            }
        } catch (e: Exception) { reset(); return }
        updateInterest()
    }

    private fun updateInterest() {
        val k = key ?: return
        if (!k.isValid) return
        var ops = SelectionKey.OP_READ
        if (outToUpstream.isNotEmpty()) ops = ops or SelectionKey.OP_WRITE
        k.interestOps(ops)
    }

    private fun readUpstream() {
        try {
            readBuf.clear()
            val n = channel.read(readBuf)
            if (n == -1) {
                send(TCP_FIN or TCP_ACK, TcpConnConst.EMPTY)
                myseq = (myseq + 1) and mask
                close()
                return
            }
            if (n <= 0) return
            readBuf.flip()
            val data = ByteArray(n)
            readBuf.get(data)
            if (firstByteAt == 0L) firstByteAt = System.currentTimeMillis()
            if (scheme == "http" && !respSniffed) {
                respSniffed = true
                Sniff.httpResponse(data)?.let { r ->
                    nat.report(base().put("ev", "resp").put("status", r.status)
                        .put("ttfb", firstByteAt - startedAt)
                        .apply { r.contentType?.let { put("ctype", it) } })
                }
            }
            bytesDown += n
            send(TCP_PSH or TCP_ACK, data)
            myseq = (myseq + n) and mask
        } catch (e: Exception) { reset() }
    }

    private fun send(flags: Int, payload: ByteArray) {
        val seg = PacketBuilder.tcpSegment(
            flow.dstPort, flow.srcPort, myseq, theirSeq, flags, TcpConnConst.WINDOW, payload,
        )
        nat.writeToTun(PacketBuilder.build(flow.dstAddr, flow.srcAddr, PROTO_TCP, seg))
    }

    // Parse just enough of the first bytes to record the method/path (HTTP) or
    // SNI host (HTTPS) as metadata. Bodies are never read or decrypted.
    private fun sniff(p: ByteArray) {
        if (sniffed || bytesUp > 16384) return
        Sniff.http(p)?.let {
            sniffed = true
            scheme = "http"
            host = it.host ?: host
            nat.report(base().put("scheme", "http").put("method", it.method).put("path", it.path)
                .apply { host?.let { h -> put("host", h) } })
            return
        }
        Sniff.tlsSni(p)?.let {
            sniffed = true
            scheme = "https"
            host = it
            nat.report(base().put("scheme", "https").put("host", it))
        }
    }

    private fun reportOpen() {
        nat.report(base().put("ev", "open").apply { host?.let { put("host", it) } })
    }

    private val app: String? by lazy { nat.appFor(6, flow) }

    private fun base(): JSONObject = JSONObject()
        .put("id", id)
        .put("proto", "tcp")
        .put("dstIp", intToAddr(flow.dstAddr).hostAddress)
        .put("dstPort", flow.dstPort)
        .put("t", startedAt)
        .apply { app?.let { put("app", it) } }

    private fun maybeClose() {
        if (appClosed) close()
    }

    private fun reset() {
        try {
            val seg = PacketBuilder.tcpSegment(flow.dstPort, flow.srcPort, myseq, theirSeq, TCP_RST or TCP_ACK, 0, TcpConnConst.EMPTY)
            nat.writeToTun(PacketBuilder.build(flow.dstAddr, flow.srcAddr, PROTO_TCP, seg))
        } catch (_: Exception) {}
        close()
    }

    private fun close() {
        if (closed) return
        closed = true
        try { key?.cancel() } catch (_: Exception) {}
        try { channel.close() } catch (_: Exception) {}
        nat.report(base().put("ev", "close").put("up", bytesUp).put("down", bytesDown)
            .put("ms", System.currentTimeMillis() - startedAt).apply { host?.let { put("host", it) } })
    }
}

object TcpConnConst {
    const val MSS = 1460
    const val WINDOW = 65535
    val EMPTY = ByteArray(0)
}
