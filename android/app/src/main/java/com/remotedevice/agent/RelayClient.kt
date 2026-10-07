package com.remotedevice.agent

import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Outbound connection to the relay, with automatic reconnect.
 *
 * Two transports carry the identical length-prefixed protocol
 * (`u8 type | u32 len | payload`):
 *
 *   • raw TCP          — LAN / emulator, lowest latency (the original path).
 *   • WebSocket (wss)  — for tunnels such as Cloudflare Tunnel or any HTTPS
 *                        reverse proxy, which forward WebSocket but not raw TCP.
 *
 * Which one is used is decided purely by [RelayAddress]. A tiny RFC 6455 client
 * is implemented inline so the app keeps zero third-party dependencies.
 *
 * Writes go through a queue drained by one writer thread so the encoder never
 * blocks on the network. When the queue backs up (slow uplink) delta frames are
 * dropped and a keyframe is requested: in real-time video, late is worse than
 * missing.
 */
class RelayClient(
    private val address: RelayAddress,
    private val hello: () -> JSONObject,
    private val listener: Listener,
) {
    interface Listener {
        fun onSession(code: String)
        fun onDisconnected(error: String?)
        fun onViewers(count: Int)
        fun onKeyFrameRequest()
        fun onControl(msg: JSONObject)
    }

    private class Packet(val bytes: ByteArray, val droppable: Boolean)

    @Volatile private var running = false
    @Volatile private var transport: Transport? = null
    private var thread: Thread? = null
    private val queue = LinkedBlockingQueue<Packet>()
    private val queuedBytes = AtomicLong()
    private var waitingKey = false

    fun start() {
        running = true
        thread = Thread(::connectLoop, "relay").apply { start() }
    }

    fun stop() {
        running = false
        transport?.close()
        thread?.interrupt()
    }

    fun sendJson(type: Int, json: JSONObject) {
        enqueue(frame(type, json.toString().toByteArray()), droppable = false)
    }

    /** Called from the encoder thread only. */
    fun sendVideo(flags: Int, ptsUs: Long, data: ByteArray) {
        val droppable = flags and (Protocol.FLAG_KEY or Protocol.FLAG_CONFIG) == 0
        if (droppable) {
            // Every delta frame references the previous one, so once one is
            // dropped the rest of the GOP is undecodable: skip to the next IDR.
            if (!waitingKey && queuedBytes.get() > QUEUE_LIMIT) {
                waitingKey = true
                listener.onKeyFrameRequest()
            }
            if (waitingKey) return
        } else if (flags and Protocol.FLAG_KEY != 0) {
            waitingKey = false
        }
        val payload = ByteBuffer.allocate(9 + data.size)
            .put(flags.toByte())
            .putLong(ptsUs)
            .put(data)
            .array()
        enqueue(frame(Protocol.VIDEO, payload), droppable)
    }

    private fun enqueue(bytes: ByteArray, droppable: Boolean) {
        if (transport == null) return
        queuedBytes.addAndGet(bytes.size.toLong())
        queue.put(Packet(bytes, droppable))
    }

    private fun frame(type: Int, payload: ByteArray): ByteArray =
        ByteBuffer.allocate(5 + payload.size)
            .put(type.toByte())
            .putInt(payload.size)
            .put(payload)
            .array()

    private fun connectLoop() {
        while (running) {
            var error: String? = null
            try {
                session()
            } catch (e: Exception) {
                error = e.message ?: e.javaClass.simpleName
                Log.w(TAG, "connection lost: $error")
            }
            if (!running) break
            listener.onDisconnected(error)
            try {
                Thread.sleep(RECONNECT_DELAY_MS)
            } catch (_: InterruptedException) {
            }
        }
    }

    private fun session() {
        val t = if (address.ws) openWebSocket() else openTcp()
        queue.clear()
        queuedBytes.set(0)
        transport = t

        // HELLO must be the first frame on the wire. Write it synchronously
        // before the writer thread starts draining the queue — and before the
        // encoder (transport is now non-null) can enqueue a video frame — so a
        // reconnect mid-session can't race a frame ahead of HELLO ("frame
        // before HELLO" on the relay).
        t.write(frame(Protocol.HELLO, hello().toString().toByteArray()))
        t.flush()

        val writer = Thread({ writeLoop(t) }, "relay-writer").apply { start() }
        try {
            readLoop(t)
        } finally {
            transport = null
            t.close()
            writer.interrupt()
            queue.clear()
            queuedBytes.set(0)
        }
    }

    private fun writeLoop(t: Transport) {
        try {
            while (!t.closed) {
                val first = queue.poll(1, TimeUnit.SECONDS) ?: continue
                var packet: Packet? = first
                // Drain everything available, then flush once.
                while (packet != null) {
                    t.write(packet.bytes)
                    queuedBytes.addAndGet(-packet.bytes.size.toLong())
                    packet = queue.poll()
                }
                t.flush()
            }
        } catch (_: InterruptedException) {
        } catch (e: Exception) {
            Log.w(TAG, "write failed: ${e.message}")
            t.close() // unblocks the reader, which triggers reconnect
        }
    }

    private fun readLoop(t: Transport) {
        while (running) {
            val (type, payload) = t.readFrame()
            val json = { JSONObject(String(payload)) }
            when (type) {
                Protocol.SESSION -> listener.onSession(json().getString("code"))
                Protocol.VIEWERS -> listener.onViewers(json().getInt("count"))
                Protocol.KEYFRAME -> listener.onKeyFrameRequest()
                Protocol.CONTROL -> listener.onControl(json())
                else -> Log.w(TAG, "unknown frame type $type")
            }
        }
    }

    // --- transports ------------------------------------------------------

    private fun openTcp(): Transport {
        val s = Socket()
        s.tcpNoDelay = true // small control/video packets must not wait for Nagle
        s.keepAlive = true
        s.connect(InetSocketAddress(address.host, address.port), CONNECT_TIMEOUT_MS)
        Log.i(TAG, "connected TCP ${address.host}:${address.port}")
        return TcpTransport(s)
    }

    private fun openWebSocket(): Transport {
        val raw = Socket()
        raw.tcpNoDelay = true
        raw.keepAlive = true
        raw.connect(InetSocketAddress(address.host, address.port), CONNECT_TIMEOUT_MS)
        val sock: Socket = if (address.tls) {
            (SSLSocketFactory.getDefault() as SSLSocketFactory)
                .createSocket(raw, address.host, address.port, true).let { ssl ->
                    ssl as SSLSocket
                    // Verify the certificate actually matches the hostname.
                    ssl.sslParameters = ssl.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
                    ssl.startHandshake()
                    ssl
                }
        } else raw
        val t = WsTransport(sock, address.host, address.port, address.path)
        t.handshake()
        Log.i(TAG, "connected ${address.summary}")
        return t
    }

    /** Transport-agnostic view used by the read/write loops. */
    private interface Transport {
        val closed: Boolean
        fun write(bytes: ByteArray)
        fun flush()
        fun readFrame(): Pair<Int, ByteArray>
        fun close()
    }

    /** Raw TCP: the framed bytes go straight onto the stream. */
    private class TcpTransport(private val s: Socket) : Transport {
        private val out = DataOutputStream(BufferedOutputStream(s.getOutputStream(), 64 * 1024))
        private val input = DataInputStream(BufferedInputStream(s.getInputStream()))
        override val closed get() = s.isClosed
        override fun write(bytes: ByteArray) = out.write(bytes)
        override fun flush() = out.flush()
        override fun readFrame(): Pair<Int, ByteArray> {
            val type = input.readUnsignedByte()
            val len = input.readInt()
            if (len < 0 || len > Protocol.MAX_FRAME) error("bad frame length $len")
            val payload = ByteArray(len)
            input.readFully(payload)
            return type to payload
        }
        override fun close() { try { s.close() } catch (_: Exception) {} }
    }

    /**
     * Minimal RFC 6455 client. Each application frame is sent as one masked
     * binary WebSocket message; on read, incoming binary messages are buffered
     * and the same `u8 type | u32 len | payload` frames are parsed back out, so
     * a message boundary need not line up with an application-frame boundary.
     */
    private class WsTransport(
        private val s: Socket,
        private val host: String,
        private val port: Int,
        private val path: String,
    ) : Transport {
        private val out: OutputStream = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
        private val input: InputStream = BufferedInputStream(s.getInputStream())
        private val rng = SecureRandom()
        private var buf = ByteArray(0)
        private var bufPos = 0
        @Volatile private var isClosed = false

        override val closed get() = isClosed || s.isClosed

        fun handshake() {
            val key = Base64.getEncoder().encodeToString(ByteArray(16).also { rng.nextBytes(it) })
            val hostHeader = if ((port == 443) || (port == 80)) host else "$host:$port"
            val req = buildString {
                append("GET $path HTTP/1.1\r\n")
                append("Host: $hostHeader\r\n")
                append("Upgrade: websocket\r\n")
                append("Connection: Upgrade\r\n")
                append("Sec-WebSocket-Key: $key\r\n")
                append("Sec-WebSocket-Version: 13\r\n")
                append("\r\n")
            }
            out.write(req.toByteArray(Charsets.ISO_8859_1))
            out.flush()

            val statusLine = readHttpLine()
            if (!statusLine.contains(" 101")) error("ws handshake failed: $statusLine")
            // Drain the rest of the response headers.
            while (true) {
                val line = readHttpLine()
                if (line.isEmpty()) break
            }
        }

        private fun readHttpLine(): String {
            val sb = StringBuilder()
            while (true) {
                val b = input.read()
                if (b < 0) error("ws handshake: stream closed")
                if (b == 0x0d) continue // CR
                if (b == 0x0a) break    // LF
                sb.append(b.toChar())
                if (sb.length > 8 * 1024) error("ws handshake: header too long")
            }
            return sb.toString()
        }

        // --- framing ---

        @Synchronized
        override fun write(bytes: ByteArray) {
            // One unfragmented, masked binary frame (opcode 0x2).
            val header = ByteArray(10)
            var n = 0
            header[n++] = (0x80 or 0x2).toByte() // FIN + binary
            val len = bytes.size
            when {
                len < 126 -> header[n++] = (0x80 or len).toByte()
                len <= 0xFFFF -> {
                    header[n++] = (0x80 or 126).toByte()
                    header[n++] = (len ushr 8).toByte()
                    header[n++] = len.toByte()
                }
                else -> {
                    header[n++] = (0x80 or 127).toByte()
                    for (i in 7 downTo 0) header[n++] = (len.toLong() ushr (8 * i)).toByte()
                }
            }
            val mask = ByteArray(4).also { rng.nextBytes(it) }
            out.write(header, 0, n)
            out.write(mask)
            val masked = ByteArray(len)
            for (i in 0 until len) masked[i] = (bytes[i].toInt() xor mask[i and 3].toInt()).toByte()
            out.write(masked)
        }

        override fun flush() = out.flush()

        override fun readFrame(): Pair<Int, ByteArray> {
            val type = readAppByte()
            val b0 = readAppByte()
            val b1 = readAppByte()
            val b2 = readAppByte()
            val b3 = readAppByte()
            val len = ((b0 shl 24) or (b1 shl 16) or (b2 shl 8) or b3)
            if (len < 0 || len > Protocol.MAX_FRAME) error("bad frame length $len")
            val payload = ByteArray(len)
            var got = 0
            while (got < len) {
                ensureBuffered()
                val n = minOf(len - got, buf.size - bufPos)
                System.arraycopy(buf, bufPos, payload, got, n)
                bufPos += n
                got += n
            }
            return type to payload
        }

        /** Next application byte, pulling more WebSocket messages as needed. */
        private fun readAppByte(): Int {
            ensureBuffered()
            return buf[bufPos++].toInt() and 0xFF
        }

        private fun ensureBuffered() {
            while (bufPos >= buf.size) {
                buf = readWsMessage()
                bufPos = 0
            }
        }

        /** Read one complete binary application message, answering control frames. */
        private fun readWsMessage(): ByteArray {
            var message = ByteArray(0)
            while (true) {
                val h0 = readByte()
                val fin = (h0 and 0x80) != 0
                val opcode = h0 and 0x0f
                val h1 = readByte()
                val masked = (h1 and 0x80) != 0 // server→client must be unmasked
                var len = (h1 and 0x7f).toLong()
                if (len == 126L) {
                    len = ((readByte().toLong() shl 8) or readByte().toLong())
                } else if (len == 127L) {
                    len = 0
                    for (i in 0 until 8) len = (len shl 8) or readByte().toLong()
                }
                if (masked) { readByte(); readByte(); readByte(); readByte() }
                if (len > Protocol.MAX_FRAME) error("ws frame too large: $len")
                val data = ByteArray(len.toInt())
                var off = 0
                while (off < data.size) {
                    val r = input.read(data, off, data.size - off)
                    if (r < 0) error("ws stream closed")
                    off += r
                }
                when (opcode) {
                    0x1, 0x2, 0x0 -> {
                        message = if (message.isEmpty()) data else message + data
                        if (fin) return message
                    }
                    0x8 -> { isClosed = true; error("ws closed by server") } // close
                    0x9 -> writeControl(0xA, data) // ping → pong
                    0xA -> {} // pong, ignore
                    else -> {}
                }
            }
        }

        @Synchronized
        private fun writeControl(opcode: Int, payload: ByteArray) {
            val mask = ByteArray(4).also { rng.nextBytes(it) }
            out.write(0x80 or opcode)
            out.write(0x80 or payload.size) // control payloads are always < 126
            out.write(mask)
            val masked = ByteArray(payload.size)
            for (i in payload.indices) masked[i] = (payload[i].toInt() xor mask[i and 3].toInt()).toByte()
            out.write(masked)
            out.flush()
        }

        private fun readByte(): Int {
            val b = input.read()
            if (b < 0) error("ws stream closed")
            return b
        }

        override fun close() {
            isClosed = true
            try { s.close() } catch (_: Exception) {}
        }
    }

    companion object {
        private const val TAG = "RelayClient"
        private const val QUEUE_LIMIT = 1L * 1024 * 1024
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val RECONNECT_DELAY_MS = 3_000L
    }
}
