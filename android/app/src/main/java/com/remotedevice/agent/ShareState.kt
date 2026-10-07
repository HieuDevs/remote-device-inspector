package com.remotedevice.agent

import android.os.Handler
import android.os.Looper

/** Process-wide session state, observed by [MainActivity]. Updates are delivered on the main thread. */
object ShareState {
    @Volatile var running = false
        private set
    @Volatile var code: String? = null
        private set
    @Volatile var status: String = ""
        private set
    @Volatile var viewers = 0
        private set

    var listener: (() -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())

    fun update(
        running: Boolean = this.running,
        code: String? = this.code,
        status: String = this.status,
        viewers: Int = this.viewers,
    ) {
        this.running = running
        this.code = code
        this.status = status
        this.viewers = viewers
        main.post { listener?.invoke() }
    }
}
