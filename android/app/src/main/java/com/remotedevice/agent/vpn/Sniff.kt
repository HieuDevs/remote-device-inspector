package com.remotedevice.agent.vpn

/**
 * Extracts human-meaningful identifiers from the first bytes of a flow:
 *  - the TLS SNI host from a ClientHello (works for HTTPS without decryption),
 *  - the request line + Host header from plaintext HTTP.
 * Payload bytes are never stored or forwarded anywhere; only these identifiers
 * are reported.
 */
object Sniff {

    data class Http(val method: String, val path: String, val host: String?)

    /** Parse the TLS ClientHello SNI, or null if [data] is not one. */
    fun tlsSni(data: ByteArray): String? {
        try {
            var p = 0
            if (data.size < 43) return null
            if (data[0].toInt() != 0x16) return null // not a TLS handshake record
            // record: type(1) version(2) length(2)
            p = 5
            if (data[p].toInt() != 0x01) return null // not ClientHello
            // handshake: type(1) length(3) version(2) random(32)
            p += 4 + 2 + 32
            val sessionIdLen = u8(data, p); p += 1 + sessionIdLen
            val cipherLen = u16(data, p); p += 2 + cipherLen
            val compLen = u8(data, p); p += 1 + compLen
            if (p + 2 > data.size) return null
            val extTotal = u16(data, p); p += 2
            val extEnd = minOf(p + extTotal, data.size)
            while (p + 4 <= extEnd) {
                val type = u16(data, p); val len = u16(data, p + 2); p += 4
                if (type == 0x0000) { // server_name
                    // server_name_list length(2), name type(1), name length(2), name
                    var q = p + 2
                    if (q + 3 > data.size) return null
                    val nameLen = u16(data, q + 1); q += 3
                    if (q + nameLen > data.size) return null
                    return String(data, q, nameLen, Charsets.US_ASCII)
                }
                p += len
            }
        } catch (_: Exception) {
        }
        return null
    }

    data class HttpResp(val status: Int, val contentType: String?)

    private val METHODS = listOf("GET", "POST", "PUT", "HEAD", "DELETE", "PATCH", "OPTIONS")

    fun http(data: ByteArray): Http? {
        if (data.size < 16) return null
        val text = String(data, 0, minOf(data.size, 4096), Charsets.ISO_8859_1)
        val firstLine = text.substringBefore("\r\n")
        val parts = firstLine.split(" ")
        if (parts.size < 3 || !parts[2].startsWith("HTTP/")) return null
        if (METHODS.none { parts[0] == it }) return null
        val host = header(text, "Host")
        return Http(parts[0], parts[1], host)
    }

    /** Parse a plaintext HTTP response status line + Content-Type. */
    fun httpResponse(data: ByteArray): HttpResp? {
        if (data.size < 12) return null
        val text = String(data, 0, minOf(data.size, 4096), Charsets.ISO_8859_1)
        if (!text.startsWith("HTTP/")) return null
        val firstLine = text.substringBefore("\r\n")
        val status = firstLine.split(" ").getOrNull(1)?.toIntOrNull() ?: return null
        return HttpResp(status, header(text, "Content-Type")?.substringBefore(";")?.trim())
    }

    private fun header(text: String, name: String): String? =
        Regex("(?im)^$name:\\s*(.+)$").find(text)?.groupValues?.get(1)?.trim()

    private fun u8(b: ByteArray, i: Int) = b[i].toInt() and 0xff
    private fun u16(b: ByteArray, i: Int) = (u8(b, i) shl 8) or u8(b, i + 1)
}

/** Maps resolved IPs back to hostnames, filled by watching DNS answers. */
object DnsCache {
    private val map = java.util.concurrent.ConcurrentHashMap<Int, String>()

    fun put(ip: Int, name: String) { map[ip] = name }
    fun get(ip: Int): String? = map[ip]

    /** Parse A/AAAA answers from a DNS response and remember name→ip. */
    fun observe(payload: ByteArray) {
        try {
            if (payload.size < 12) return
            val qd = ((payload[4].toInt() and 0xff) shl 8) or (payload[5].toInt() and 0xff)
            val an = ((payload[6].toInt() and 0xff) shl 8) or (payload[7].toInt() and 0xff)
            if (an == 0) return
            var p = 12
            val name = StringBuilder()
            p = readName(payload, p, name)
            p += 4 // qtype + qclass
            repeat(qd - 1) { val sb = StringBuilder(); p = readName(payload, p, sb); p += 4 }
            repeat(an) {
                val sb = StringBuilder()
                p = readName(payload, p, sb)
                if (p + 10 > payload.size) return
                val type = ((payload[p].toInt() and 0xff) shl 8) or (payload[p + 1].toInt() and 0xff)
                val rdlen = ((payload[p + 8].toInt() and 0xff) shl 8) or (payload[p + 9].toInt() and 0xff)
                p += 10
                if (type == 1 && rdlen == 4) { // A record
                    val ip = ((payload[p].toInt() and 0xff) shl 24) or ((payload[p + 1].toInt() and 0xff) shl 16) or
                        ((payload[p + 2].toInt() and 0xff) shl 8) or (payload[p + 3].toInt() and 0xff)
                    put(ip, name.toString())
                }
                p += rdlen
            }
        } catch (_: Exception) {
        }
    }

    private fun readName(b: ByteArray, start: Int, out: StringBuilder): Int {
        var p = start
        var jumped = false
        var end = start
        while (p < b.size) {
            val len = b[p].toInt() and 0xff
            if (len == 0) { p++; break }
            if (len and 0xc0 == 0xc0) { // pointer
                if (!jumped) end = p + 2
                p = ((len and 0x3f) shl 8) or (b[p + 1].toInt() and 0xff)
                jumped = true
                continue
            }
            if (out.isNotEmpty()) out.append('.')
            out.append(String(b, p + 1, len, Charsets.US_ASCII))
            p += 1 + len
        }
        return if (jumped) end else p
    }
}
