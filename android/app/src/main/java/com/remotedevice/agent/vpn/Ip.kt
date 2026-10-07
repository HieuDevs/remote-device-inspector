package com.remotedevice.agent.vpn

import java.net.InetAddress
import java.nio.ByteBuffer

/**
 * Minimal IPv4 + TCP/UDP packet parsing and building for the userspace NAT.
 * Only what the capture engine needs; IPv6 and IP options are not handled.
 */

const val PROTO_TCP = 6
const val PROTO_UDP = 17

class Ipv4(val buffer: ByteBuffer) {
    val ihl = (buffer.get(0).toInt() and 0x0f) * 4
    val protocol = buffer.get(9).toInt() and 0xff
    val totalLength = buffer.getShort(2).toInt() and 0xffff
    val srcAddr: Int = buffer.getInt(12)
    val dstAddr: Int = buffer.getInt(16)

    val src: InetAddress get() = intToAddr(srcAddr)
    val dst: InetAddress get() = intToAddr(dstAddr)
    val payloadOffset get() = ihl
    val payloadLength get() = totalLength - ihl

    companion object {
        fun isIpv4(b: ByteBuffer) = (b.get(0).toInt() and 0xf0) == 0x40
    }
}

class Tcp(val ip: Ipv4) {
    private val off = ip.payloadOffset
    val srcPort = ip.buffer.getShort(off).toInt() and 0xffff
    val dstPort = ip.buffer.getShort(off + 2).toInt() and 0xffff
    val seq: Long = ip.buffer.getInt(off + 4).toLong() and 0xffffffffL
    val ack: Long = ip.buffer.getInt(off + 8).toLong() and 0xffffffffL
    val dataOffset = ((ip.buffer.get(off + 12).toInt() and 0xf0) ushr 4) * 4
    val flags = ip.buffer.get(off + 13).toInt() and 0xff
    val window = ip.buffer.getShort(off + 14).toInt() and 0xffff

    val fin get() = flags and 0x01 != 0
    val syn get() = flags and 0x02 != 0
    val rst get() = flags and 0x04 != 0
    val psh get() = flags and 0x08 != 0
    val ackFlag get() = flags and 0x10 != 0

    val payloadOffset get() = off + dataOffset
    val payloadLength get() = ip.payloadLength - dataOffset

    fun payload(): ByteArray {
        val len = payloadLength
        if (len <= 0) return ByteArray(0)
        val out = ByteArray(len)
        val dup = ip.buffer.duplicate()
        dup.position(payloadOffset)
        dup.get(out, 0, len)
        return out
    }
}

class Udp(val ip: Ipv4) {
    private val off = ip.payloadOffset
    val srcPort = ip.buffer.getShort(off).toInt() and 0xffff
    val dstPort = ip.buffer.getShort(off + 2).toInt() and 0xffff
    val length = ip.buffer.getShort(off + 4).toInt() and 0xffff
    val payloadOffset get() = off + 8
    val payloadLength get() = length - 8

    fun payload(): ByteArray {
        val len = payloadLength
        if (len <= 0) return ByteArray(0)
        val out = ByteArray(len)
        val dup = ip.buffer.duplicate()
        dup.position(payloadOffset)
        dup.get(out, 0, len)
        return out
    }
}

fun intToAddr(v: Int): InetAddress =
    InetAddress.getByAddress(byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte()))

fun addrToInt(a: InetAddress): Int {
    val b = a.address
    return (b[0].toInt() and 0xff shl 24) or (b[1].toInt() and 0xff shl 16) or
        (b[2].toInt() and 0xff shl 8) or (b[3].toInt() and 0xff)
}

/** One's-complement checksum over a slice. */
private fun checksum(buf: ByteArray, start: Int, len: Int, initial: Long): Int {
    var sum = initial
    var i = start
    val end = start + len
    while (i + 1 < end) {
        sum += ((buf[i].toInt() and 0xff) shl 8) or (buf[i + 1].toInt() and 0xff)
        i += 2
    }
    if (i < end) sum += (buf[i].toInt() and 0xff) shl 8
    while (sum shr 16 != 0L) sum = (sum and 0xffff) + (sum shr 16)
    return (sum.inv() and 0xffff).toInt()
}

object PacketBuilder {
    /**
     * Build an IPv4 packet carrying [l4] (a complete TCP or UDP segment with its
     * checksum field zeroed), computing both checksums.
     */
    fun build(srcAddr: Int, dstAddr: Int, protocol: Int, l4: ByteArray): ByteArray {
        val total = 20 + l4.size
        val out = ByteArray(total)
        // IPv4 header
        out[0] = 0x45
        out[2] = (total ushr 8).toByte(); out[3] = total.toByte()
        out[6] = 0x40 // don't fragment
        out[8] = 64 // ttl
        out[9] = protocol.toByte()
        putInt(out, 12, srcAddr); putInt(out, 16, dstAddr)
        val ipSum = checksum(out, 0, 20, 0)
        out[10] = (ipSum ushr 8).toByte(); out[11] = ipSum.toByte()
        System.arraycopy(l4, 0, out, 20, l4.size)

        // L4 checksum over pseudo-header + segment
        var pseudo = 0L
        pseudo += (srcAddr ushr 16) and 0xffff; pseudo += srcAddr and 0xffff
        pseudo += (dstAddr ushr 16) and 0xffff; pseudo += dstAddr and 0xffff
        pseudo += protocol.toLong()
        pseudo += l4.size.toLong()
        val csumOffset = if (protocol == PROTO_TCP) 20 + 16 else 20 + 6
        out[csumOffset] = 0; out[csumOffset + 1] = 0
        val l4sum = checksum(out, 20, l4.size, pseudo)
        out[csumOffset] = (l4sum ushr 8).toByte(); out[csumOffset + 1] = l4sum.toByte()
        return out
    }

    fun tcpSegment(
        srcPort: Int, dstPort: Int, seq: Long, ack: Long, flags: Int, window: Int, payload: ByteArray,
    ): ByteArray {
        val seg = ByteArray(20 + payload.size)
        putShort(seg, 0, srcPort); putShort(seg, 2, dstPort)
        putInt(seg, 4, seq.toInt()); putInt(seg, 8, ack.toInt())
        seg[12] = (5 shl 4).toByte() // data offset = 5 words, no options
        seg[13] = flags.toByte()
        putShort(seg, 14, window)
        System.arraycopy(payload, 0, seg, 20, payload.size)
        return seg
    }

    fun udpSegment(srcPort: Int, dstPort: Int, payload: ByteArray): ByteArray {
        val seg = ByteArray(8 + payload.size)
        putShort(seg, 0, srcPort); putShort(seg, 2, dstPort)
        putShort(seg, 4, 8 + payload.size)
        System.arraycopy(payload, 0, seg, 8, payload.size)
        return seg
    }

    private fun putShort(b: ByteArray, o: Int, v: Int) { b[o] = (v ushr 8).toByte(); b[o + 1] = v.toByte() }
    private fun putInt(b: ByteArray, o: Int, v: Int) {
        b[o] = (v ushr 24).toByte(); b[o + 1] = (v ushr 16).toByte(); b[o + 2] = (v ushr 8).toByte(); b[o + 3] = v.toByte()
    }
}

const val TCP_FIN = 0x01
const val TCP_SYN = 0x02
const val TCP_RST = 0x04
const val TCP_PSH = 0x08
const val TCP_ACK = 0x10
