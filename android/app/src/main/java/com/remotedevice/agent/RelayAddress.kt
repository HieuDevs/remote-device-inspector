package com.remotedevice.agent

/**
 * How to reach the relay, parsed from the single address field the user types.
 *
 *   10.0.2.2:7000            → raw TCP   (emulator / LAN, unchanged behaviour)
 *   192.168.1.10:7000        → raw TCP   (host:port with a numeric port)
 *   relay.example.com        → wss://relay.example.com/device   (tunnel / VPS+TLS)
 *   abc.trycloudflare.com    → wss://…/device
 *   ws://host:8080           → plain WebSocket (explicit)
 *   wss://host[/path]        → secure WebSocket (explicit)
 *   tcp://host:port          → raw TCP (explicit)
 *
 * Rule of thumb: a bare "host:port" with a numeric port stays raw TCP for
 * backward compatibility; anything that looks like a domain without a port is
 * assumed to be a tunnel endpoint and dialled over wss, which is what passes
 * cleanly through Cloudflare Tunnel and ordinary HTTPS reverse proxies.
 */
data class RelayAddress(
    val ws: Boolean,
    val tls: Boolean,
    val host: String,
    val port: Int,
    val path: String,
) {
    val summary: String
        get() = if (ws) "${if (tls) "wss" else "ws"}://$host:$port$path" else "$host:$port (TCP)"

    companion object {
        fun parse(raw: String): RelayAddress? {
            var s = raw.trim()
            if (s.isEmpty()) return null

            var scheme: String? = null
            val sep = s.indexOf("://")
            if (sep >= 0) {
                scheme = s.substring(0, sep).lowercase()
                s = s.substring(sep + 3)
            }

            // Split an optional "/path" off the authority; keep a default for ws.
            val slash = s.indexOf('/')
            var path = if (slash >= 0) s.substring(slash) else ""
            val authority = if (slash >= 0) s.substring(0, slash) else s
            if (authority.isEmpty()) return null

            val host = authority.substringBeforeLast(":")
            val portPart = if (authority.contains(":")) authority.substringAfterLast(":") else ""
            val port = portPart.toIntOrNull()
            if (host.isEmpty()) return null

            return when (scheme) {
                "tcp" -> {
                    val p = port ?: return null
                    RelayAddress(ws = false, tls = false, host = host, port = p, path = "")
                }
                "ws" -> RelayAddress(true, false, host, port ?: 80, path.ifEmpty { "/device" })
                "wss" -> RelayAddress(true, true, host, port ?: 443, path.ifEmpty { "/device" })
                null -> {
                    // No scheme: a numeric port means legacy raw TCP; otherwise
                    // treat it as a secure-tunnel hostname.
                    if (port != null) RelayAddress(false, false, host, port, "")
                    else RelayAddress(true, true, host, 443, "/device")
                }
                else -> null
            }
        }
    }
}
