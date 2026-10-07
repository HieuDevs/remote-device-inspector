package com.remotedevice.agent.vpn

import org.json.JSONObject
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.channels.DatagramChannel
import java.nio.channels.SelectionKey

/**
 * One userspace UDP flow. Datagrams are forwarded through a protected channel.
 * DNS responses (port 53) are parsed to build the IP→hostname map that names
 * TCP flows which have no SNI or Host header.
 */
class UdpConn(private val flow: Flow, private val nat: Nat, private val id: Int) : Upstream {

    private val channel = DatagramChannel.open()
    private var key: SelectionKey? = null
    private val readBuf = ByteBuffer.allocate(2048)
    private var closed = false
    private var bytesUp = 0L
    private var bytesDown = 0L
    private val startedAt = System.currentTimeMillis()
    var lastActive = startedAt; private set

    fun open() {
        try {
            channel.configureBlocking(false)
            nat.protectSocket(channel.socket())
            channel.connect(InetSocketAddress(intToAddr(flow.dstAddr), flow.dstPort))
            key = nat.register(channel, SelectionKey.OP_READ, this)
            if (flow.dstPort != 53) {
                nat.report(base().put("ev", "open").apply { DnsCache.get(flow.dstAddr)?.let { put("host", it) } })
            }
        } catch (e: Exception) { close() }
    }

    fun onPacket(u: Udp) {
        lastActive = System.currentTimeMillis()
        val p = u.payload()
        try {
            channel.write(ByteBuffer.wrap(p))
            bytesUp += p.size
        } catch (e: Exception) { close() }
    }

    override fun onReady(key: SelectionKey) {
        if (!key.isReadable) return
        try {
            readBuf.clear()
            val n = channel.read(readBuf)
            if (n <= 0) return
            readBuf.flip()
            val data = ByteArray(n)
            readBuf.get(data)
            lastActive = System.currentTimeMillis()
            bytesDown += n
            if (flow.dstPort == 53) DnsCache.observe(data)
            val seg = PacketBuilder.udpSegment(flow.dstPort, flow.srcPort, data)
            nat.writeToTun(PacketBuilder.build(flow.dstAddr, flow.srcAddr, PROTO_UDP, seg))
        } catch (e: Exception) { close() }
    }

    override fun onError(e: Exception) { close() }

    fun close() {
        if (closed) return
        closed = true
        try { key?.cancel() } catch (_: Exception) {}
        try { channel.close() } catch (_: Exception) {}
        if (flow.dstPort != 53) {
            nat.report(base().put("ev", "close").put("up", bytesUp).put("down", bytesDown)
                .put("ms", System.currentTimeMillis() - startedAt))
        }
    }

    private val app: String? by lazy { nat.appFor(17, flow) }

    private fun base(): JSONObject = JSONObject()
        .put("id", id)
        .put("proto", if (flow.dstPort == 53) "dns" else "udp")
        .put("dstIp", intToAddr(flow.dstAddr).hostAddress)
        .put("dstPort", flow.dstPort)
        .put("t", startedAt)
        .apply { app?.let { put("app", it) } }
}
