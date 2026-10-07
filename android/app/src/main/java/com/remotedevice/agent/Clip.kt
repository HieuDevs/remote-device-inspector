package com.remotedevice.agent

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.widget.Toast

/** Session-code clipboard helpers, shared by the main screen and the notification action. */
object Clip {
    /** "123456789" → "123 456 789": easier to read aloud over the phone. */
    fun pretty(code: String): String = code.chunked(3).joinToString(" ")

    fun copyCode(ctx: Context, code: String) {
        val cm = ctx.getSystemService(ClipboardManager::class.java)
        cm.setPrimaryClip(ClipData.newPlainText(ctx.getString(R.string.session_code), code))
        // Android 13+ shows its own "copied" confirmation; avoid a double toast.
        if (Build.VERSION.SDK_INT < 33) {
            Toast.makeText(ctx, R.string.copied, Toast.LENGTH_SHORT).show()
        }
    }
}
