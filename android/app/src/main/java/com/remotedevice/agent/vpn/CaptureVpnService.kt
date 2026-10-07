package com.remotedevice.agent.vpn

import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import org.json.JSONObject
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.channels.DatagramChannel
import java.nio.channels.SelectionKey
import java.nio.channels.Selector
import java.nio.channels.SocketChannel
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * A userspace VPN that captures every IP packet, logs flow metadata (host via
 * TLS SNI or DNS, HTTP request line for plaintext), and forwards the traffic so
 * the device keeps connectivity. It is a small NAT, not a full TCP/IP stack:
 * it handles the request/response flows that API calls produce, and skips IPv6,
 * TCP options, windowing and retransmission. Payload bytes are forwarded but
 * never stored or sent anywhere — only the derived metadata is reported.
 */
class CaptureVpnService : VpnService() {

    private var tun: ParcelFileDescriptor? = null
    private var engine: Thread? = null
    @Volatile private var running = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stop()
            return START_NOT_STICKY
        }
        if (running) return START_STICKY
        start()
        return START_STICKY
    }

    private fun start() {
        val builder = Builder()
            .setSession("Remote Agent – API capture")
            .addAddress("10.111.0.2", 32)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("8.8.8.8")
            .setMtu(MTU)
            .setBlocking(true)
        // Capture every app as metadata (host, size, timing, which app); exclude
        // only ourselves to avoid looping the relay/video upload. Traffic is
        // always forwarded raw — nothing is decrypted, so no app ever breaks.
        // Full request/response bodies come from apps that opt in via the
        // InspectorBridge, not from decrypting anyone's TLS.
        try { builder.addDisallowedApplication(packageName) } catch (e: Exception) { Log.w(TAG, "app filter: ${e.message}") }
        val pfd = builder.establish() ?: run { stopSelf(); return }
        tun = pfd

        running = true
        ApiBus.capturing = true
        ApiBus.emit(JSONObject().put("ev", "capture").put("on", true))
        engine = Thread({ Engine(pfd).run() }, "vpn-engine").apply { start() }
        Log.i(TAG, "capture started")
    }

    private fun stop() {
        running = false
        ApiBus.capturing = false
        ApiBus.emit(JSONObject().put("ev", "capture").put("on", false))
        engine?.interrupt()
        try { tun?.close() } catch (_: Exception) {}
        tun = null
        stopSelf()
        Log.i(TAG, "capture stopped")
    }

    override fun onDestroy() {
        stop()
        super.onDestroy()
    }

    // -----------------------------------------------------------------------

    private inner class Engine(pfd: ParcelFileDescriptor) : Nat {
        private val input = FileInputStream(pfd.fileDescriptor)
        private val output = FileOutputStream(pfd.fileDescriptor)
        private val selector = Selector.open()
        private val fromApp = ConcurrentLinkedQueue<ByteArray>()
        private val tcp = HashMap<Flow, TcpConn>()
        private val udp = HashMap<Flow, UdpConn>()
        private val flowSeq = AtomicInteger(1)

        fun run() {
            // Reader thread: blocking tun reads feed the engine's queue.
            val reader = Thread({
                val buf = ByteArray(MTU)
                try {
                    while (running) {
                        val n = input.read(buf)
                        if (n <= 0) continue
                        fromApp.add(buf.copyOf(n))
                        selector.wakeup()
                    }
                } catch (_: Exception) {}
            }, "vpn-reader").apply { start() }

            try {
                while (running) {
                    selector.select(1000)
                    val it = selector.selectedKeys().iterator()
                    while (it.hasNext()) {
                        val key = it.next(); it.remove()
                        val h = key.attachment() as? Upstream ?: continue
                        try { h.onReady(key) } catch (e: Exception) { h.onError(e) }
                    }
                    var pkt = fromApp.poll()
                    while (pkt != null) { handle(pkt); pkt = fromApp.poll() }
                    sweepIdle()
                }
            } catch (e: Exception) {
                if (running) Log.e(TAG, "engine error", e)
            } finally {
                reader.interrupt()
                selector.close()
            }
        }

        override fun writeToTun(packet: ByteArray) {
            synchronized(output) { output.write(packet) }
        }

        override fun protectSocket(socket: java.net.Socket) = protect(socket)
        override fun protectSocket(socket: java.net.DatagramSocket) = protect(socket)
        override fun report(record: JSONObject) = ApiBus.emit(record)

        private val cm by lazy { getSystemService(android.net.ConnectivityManager::class.java) }
        private val appCache = HashMap<Int, Pair<String?, String?>>() // uid -> (pkg, label)

        // Attribute a flow to its owning app via the kernel's connection owner
        // lookup (API 29+), resolving uid → (package, label), cached.
        private fun resolve(proto: Int, flow: Flow): Pair<String?, String?>? {
            if (Build.VERSION.SDK_INT < 29) return null
            return try {
                val uid = cm.getConnectionOwnerUid(
                    proto,
                    java.net.InetSocketAddress(intToAddr(flow.srcAddr), flow.srcPort),
                    java.net.InetSocketAddress(intToAddr(flow.dstAddr), flow.dstPort),
                )
                if (uid < 0) return null
                appCache.getOrPut(uid) {
                    val pkg = packageManager.getPackagesForUid(uid)?.firstOrNull()
                    val label = pkg?.let {
                        try { packageManager.getApplicationInfo(it, 0).loadLabel(packageManager).toString() } catch (e: Exception) { it }
                    } ?: "uid:$uid"
                    pkg to label
                }
            } catch (e: Exception) {
                null
            }
        }

        override fun appFor(proto: Int, flow: Flow): String? = resolve(proto, flow)?.second
        override fun appPkgFor(proto: Int, flow: Flow): String? = resolve(proto, flow)?.first

        private fun handle(packet: ByteArray) {
            val buf = ByteBuffer.wrap(packet)
            if (!Ipv4.isIpv4(buf)) return
            val ip = Ipv4(buf)
            when (ip.protocol) {
                PROTO_TCP -> handleTcp(ip, Tcp(ip))
                PROTO_UDP -> handleUdp(ip, Udp(ip))
            }
        }

        private fun handleTcp(ip: Ipv4, t: Tcp) {
            val flow = Flow(ip.srcAddr, t.srcPort, ip.dstAddr, t.dstPort)
            var conn = tcp[flow]
            if (t.syn && conn == null) {
                conn = TcpConn(flow, this, flowSeq.getAndIncrement())
                tcp[flow] = conn
                conn.onSyn(t)
                return
            }
            if (conn == null) {
                if (!t.rst) sendRst(flow, t)
                return
            }
            conn.onSegment(t)
            if (conn.closed) tcp.remove(flow)
        }

        private fun handleUdp(ip: Ipv4, u: Udp) {
            val flow = Flow(ip.srcAddr, u.srcPort, ip.dstAddr, u.dstPort)
            val conn = udp.getOrPut(flow) { UdpConn(flow, this, flowSeq.getAndIncrement()).also { it.open() } }
            conn.onPacket(u)
        }

        override fun register(channel: java.nio.channels.SelectableChannel, ops: Int, up: Upstream): SelectionKey =
            channel.register(selector, ops, up)

        private fun sendRst(flow: Flow, t: Tcp) {
            val seg = PacketBuilder.tcpSegment(flow.dstPort, flow.srcPort, t.ack, t.seq + 1, TCP_RST or TCP_ACK, 0, EMPTY)
            writeToTun(PacketBuilder.build(flow.dstAddr, flow.srcAddr, PROTO_TCP, seg))
        }

        private var lastSweep = 0L
        private fun sweepIdle() {
            val now = System.currentTimeMillis()
            if (now - lastSweep < 5000) return
            lastSweep = now
            udp.entries.removeAll { (_, c) -> if (now - c.lastActive > 30_000) { c.close(); true } else false }
        }
    }

    companion object {
        private const val TAG = "CaptureVpn"
        const val MTU = 1500
        const val ACTION_STOP = "com.remotedevice.agent.vpn.STOP"
        val EMPTY = ByteArray(0)
    }
}

/** 4-tuple identifying a flow. */
data class Flow(val srcAddr: Int, val srcPort: Int, val dstAddr: Int, val dstPort: Int)

/** Something registered with the engine's selector. */
interface Upstream {
    fun onReady(key: SelectionKey)
    fun onError(e: Exception)
}

/** The NAT engine's capabilities, as the per-flow connections use them. */
interface Nat {
    fun writeToTun(packet: ByteArray)
    fun register(channel: java.nio.channels.SelectableChannel, ops: Int, up: Upstream): SelectionKey
    fun protectSocket(socket: java.net.Socket): Boolean
    fun protectSocket(socket: java.net.DatagramSocket): Boolean
    fun report(record: JSONObject)
    /** App label owning this flow, or null if unknown. */
    fun appFor(proto: Int, flow: Flow): String?
    /** App package owning this flow, or null if unknown. */
    fun appPkgFor(proto: Int, flow: Flow): String?
}
