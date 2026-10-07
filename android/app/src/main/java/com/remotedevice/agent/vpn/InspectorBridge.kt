package com.remotedevice.agent.vpn

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger

/**
 * Loopback bridge for in-app API inspection.
 *
 * A device app that we control (e.g. the user's own app, built with a tiny
 * Dio/OkHttp interceptor) POSTs its *already-decrypted* request/response here,
 * and we forward it to the viewer's DevTools panel exactly like a MITM
 * transaction — but with no CA, no root and no TLS interception. The app simply
 * reports the plaintext it already holds, and only apps that opt in by sending
 * ever appear. This is how HTTPS bodies can be inspected on an ordinary,
 * un-rooted device without weakening anyone's transport security.
 *
 * Binds to 127.0.0.1 only: loopback never leaves the device and never passes
 * through the VPN tunnel, so it cannot be captured or reach the network.
 *
 * Wire format: an ordinary HTTP/1.1 POST whose body is one JSON object, or an
 * array of them, with fields: method, url, reqHeaders, reqBody, status,
 * respHeaders, respBody, ms, app (all optional except url).
 */
object InspectorBridge {
    const val PORT = 8899
    private const val TAG = "InspectorBridge"
    private const val MAX_BODY = 4 * 1024 * 1024 // guard against a runaway client

    private val ids = AtomicInteger(1)
    @Volatile private var server: ServerSocket? = null

    fun start() {
        if (server != null) return
        Thread({ loop() }, "inspector-bridge").apply { isDaemon = true; start() }
    }

    fun stop() {
        try { server?.close() } catch (_: Exception) {}
        server = null
    }

    private fun loop() {
        try {
            val s = ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"))
            server = s
            Log.i(TAG, "listening on 127.0.0.1:$PORT")
            while (!s.isClosed) {
                val c = try { s.accept() } catch (_: Exception) { break }
                // Each client is tiny and short-lived; a thread per connection is fine.
                Thread { handle(c) }.apply { isDaemon = true }.start()
            }
        } catch (e: Exception) {
            Log.w(TAG, "bridge failed: ${e.message}")
        }
    }

    private fun handle(c: Socket) {
        try {
            c.use {
                val ins = it.getInputStream()
                val (method, contentLength) = readHead(ins)
                val body = if (method == "POST" && contentLength > 0) readBody(ins, contentLength) else ""
                if (body.isNotEmpty()) ingest(body)
                it.getOutputStream().apply {
                    write("HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    flush()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "handle error: ${e.message}")
        }
    }

    /** Read the request line + headers (bytes, up to CRLFCRLF). Returns method + Content-Length. */
    private fun readHead(ins: InputStream): Pair<String, Int> {
        val head = StringBuilder()
        var last4 = 0
        while (true) {
            val b = ins.read()
            if (b < 0) break
            head.append(b.toChar())
            last4 = (last4 shl 8) or b
            if (last4 == 0x0d0a0d0a) break // \r\n\r\n
            if (head.length > 64 * 1024) break
        }
        val lines = head.toString().split("\r\n")
        val method = lines.firstOrNull()?.substringBefore(' ') ?: ""
        var len = 0
        for (line in lines.drop(1)) {
            val idx = line.indexOf(':')
            if (idx > 0 && line.substring(0, idx).trim().equals("Content-Length", true)) {
                len = line.substring(idx + 1).trim().toIntOrNull() ?: 0
            }
        }
        return method to len.coerceAtMost(MAX_BODY)
    }

    private fun readBody(ins: InputStream, length: Int): String {
        val buf = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = ins.read(buf, read, length - read)
            if (n < 0) break
            read += n
        }
        return String(buf, 0, read, Charsets.UTF_8)
    }

    private fun ingest(body: String) {
        try {
            val trimmed = body.trim()
            if (trimmed.startsWith("[")) {
                val arr = JSONArray(trimmed)
                for (i in 0 until arr.length()) emitOne(arr.getJSONObject(i))
            } else {
                emitOne(JSONObject(trimmed))
            }
        } catch (e: Exception) {
            Log.w(TAG, "bad payload: ${e.message}")
        }
    }

    private fun emitOne(p: JSONObject) {
        val url = p.optString("url")
        if (url.isEmpty()) return
        val scheme = if (url.contains("://")) url.substringBefore("://") else "https"
        val afterScheme = url.substringAfter("://", url)
        val authority = afterScheme.substringBefore("/")
        val host = authority.substringBefore("?").substringBefore(':')
        val path = afterScheme.substring(authority.length).ifEmpty { "/" }
        val reqBody = p.optString("reqBody", "")
        val respBody = p.optString("respBody", "")

        val rec = JSONObject()
            .put("id", "app-" + ids.getAndIncrement())
            .put("ev", "txn")
            .put("proto", scheme)
            .put("scheme", scheme)
            .put("host", host)
            .put("method", p.optString("method", "GET"))
            .put("path", path)
            .put("url", url)
            .put("t", p.optLong("t", System.currentTimeMillis() - p.optLong("ms", 0)))
            .put("ms", p.optLong("ms", 0))
            .put("reqHeaders", normHeaders(p.opt("reqHeaders")))
            .put("up", reqBody.toByteArray(Charsets.UTF_8).size)
            .put("app", p.optString("app").ifEmpty { "App" })
        if (reqBody.isNotEmpty()) rec.put("reqBody", reqBody)
        if (p.has("status")) {
            rec.put("status", p.optInt("status"))
            rec.put("respHeaders", normHeaders(p.opt("respHeaders")))
            rec.put("down", respBody.toByteArray(Charsets.UTF_8).size)
            p.optString("ctype").takeIf { it.isNotEmpty() }?.let { rec.put("ctype", it) }
            if (respBody.isNotEmpty()) rec.put("respBody", respBody)
        }
        ApiBus.emit(rec)
    }

    /** Accept headers as either [[k,v],...] (passed through) or {"k":"v"} (converted). */
    private fun normHeaders(h: Any?): JSONArray {
        if (h is JSONArray) return h
        val arr = JSONArray()
        if (h is JSONObject) for (k in h.keys()) arr.put(JSONArray().put(k).put(h.get(k).toString()))
        return arr
    }
}
