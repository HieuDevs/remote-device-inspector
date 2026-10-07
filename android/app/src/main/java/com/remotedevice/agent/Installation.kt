package com.remotedevice.agent

import android.content.Context
import java.util.UUID

/** A random id generated once per install, so a reconnecting device keeps its session code. */
object Installation {
    private const val PREFS = "install"
    private const val KEY = "id"

    fun id(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getString(KEY, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY, it).apply()
        }
    }
}
