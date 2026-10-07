package com.remotedevice.agent.vpn

import org.json.JSONObject

/** Decouples the capture engine from the relay: ScreenShareService installs a sink. */
object ApiBus {
    @Volatile var sink: ((JSONObject) -> Unit)? = null
    @Volatile var capturing = false

    fun emit(record: JSONObject) {
        sink?.invoke(record)
    }
}
