package com.remotedevice.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Applies remote input to this device.
 *
 * Android has no API to synthesize touch events app-to-app; the only sanctioned
 * route is an AccessibilityService, which the user must enable by hand in
 * Settings → Accessibility (it cannot be turned on programmatically). While it
 * is off, [isEnabled] is false, the relay advertises the session as view-only,
 * and no input is ever applied.
 *
 * Coordinates arrive normalized (0..1) so they are independent of the streamed
 * resolution; we scale them to the real display here.
 */
class ControlService : AccessibilityService() {

    override fun onServiceConnected() {
        instance = this
        Log.i(TAG, "control enabled")
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    private val screenW get() = resources.displayMetrics.widthPixels
    private val screenH get() = resources.displayMetrics.heightPixels

    /** Called from the relay thread via [ScreenShareService.onControl]. */
    fun handle(msg: JSONObject) {
        try {
            when (msg.optString("t")) {
                "down" -> touchDown(x(msg.getDouble("x")), y(msg.getDouble("y")))
                "move" -> touchMove(x(msg.getDouble("x")), y(msg.getDouble("y")))
                "up" -> touchUp(x(msg.getDouble("x")), y(msg.getDouble("y")))
                "gesture" -> gesture(msg.getJSONArray("p"), msg.optInt("d", 100))
                "key" -> key(msg.optString("k"))
                "type" -> type(msg.optString("s"))
                "keyframe" -> {} // handled by the service, ignored here
            }
        } catch (e: Exception) {
            Log.w(TAG, "bad control msg: ${e.message}")
        }
    }

    // --- streamed touch: real-time down/move/up like a real finger, using
    //     StrokeDescription continuation so drag/scroll feel live ---
    private var stroke: GestureDescription.StrokeDescription? = null
    private var lastX = 0f
    private var lastY = 0f
    private var lastTime = 0L

    // A continuation stroke MUST start at the EXACT pixel the previous stroke
    // ended on, or Android rejects the whole gesture ("points mismatch"). So we
    // always remember the real end point of the last path in lastX/lastY and
    // begin the next segment there — never from the raw incoming coordinate.
    private fun touchDown(px: Float, py: Float) {
        // A stroke needs a non-zero-length path; end 1px below and remember THAT.
        val ex = px; val ey = py + 1f
        val path = Path().apply { moveTo(px, py); lineTo(ex, ey) }
        val s = GestureDescription.StrokeDescription(path, 0, 1, true)
        dispatchGesture(GestureDescription.Builder().addStroke(s).build(), null, null)
        stroke = s; lastX = ex; lastY = ey; lastTime = System.currentTimeMillis()
    }

    private fun touchMove(px: Float, py: Float) {
        val prev = stroke ?: return touchDown(px, py)
        val now = System.currentTimeMillis()
        val dur = (now - lastTime).coerceIn(1, 100)
        // Start exactly where we left off; nudge the end if it would be zero-length.
        var ex = px; var ey = py
        if (ex == lastX && ey == lastY) ey += 1f
        val path = Path().apply { moveTo(lastX, lastY); lineTo(ex, ey) }
        val s = prev.continueStroke(path, 0, dur, true)
        dispatchGesture(GestureDescription.Builder().addStroke(s).build(), null, null)
        stroke = s; lastX = ex; lastY = ey; lastTime = now
    }

    private fun touchUp(px: Float, py: Float) {
        val prev = stroke ?: return tap(px, py) // down+up with no live stroke = a tap
        val now = System.currentTimeMillis()
        val dur = (now - lastTime).coerceIn(1, 100)
        var ex = px; var ey = py
        if (ex == lastX && ey == lastY) ey += 1f
        val path = Path().apply { moveTo(lastX, lastY); lineTo(ex, ey) }
        val s = prev.continueStroke(path, 0, dur, false) // willContinue=false lifts the finger
        dispatchGesture(GestureDescription.Builder().addStroke(s).build(), null, null)
        stroke = null
    }

    private fun tap(px: Float, py: Float) {
        val path = Path().apply { moveTo(px, py); lineTo(px + 1f, py + 1f) }
        dispatchGesture(
            GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 50)).build(),
            null, null,
        )
    }

    private fun gesture(points: JSONArray, durationMs: Int) {
        if (points.length() == 0) return
        val path = Path()
        val p0 = points.getJSONArray(0)
        val x0 = x(p0.getDouble(0))
        val y0 = y(p0.getDouble(1))
        path.moveTo(x0, y0)
        for (i in 1 until points.length()) {
            val p = points.getJSONArray(i)
            path.lineTo(x(p.getDouble(0)), y(p.getDouble(1)))
        }
        // A tap is a single point; a path with only moveTo has no contour and
        // StrokeDescription rejects it. Give it a 1px segment so it is a valid
        // (but visually stationary) stroke.
        if (points.length() == 1) path.lineTo(x0 + 1f, y0 + 1f)

        val duration = durationMs.toLong().coerceIn(1, 10_000)
        val stroke = GestureDescription.StrokeDescription(path, 0, duration)
        val ok = dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
        Log.i(TAG, "gesture ${points.length()} pts -> ($x0,$y0) dur=$duration dispatched=$ok")
    }

    private fun key(name: String) {
        val action = when (name) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "lock" -> GLOBAL_ACTION_LOCK_SCREEN
            "wake" -> return wakeScreen()
            "backspace" -> return editFocused { it.deleteLastChar() }
            "enter" -> return editFocused { it.pressEnter() }
            else -> return
        }
        performGlobalAction(action)
    }

    /**
     * Turn the display on. GLOBAL_ACTION_LOCK_SCREEN turns it off but there is
     * no matching "turn on" action, so we briefly hold a wake lock that forces
     * the screen bright. If the device has only a swipe lock (no PIN/pattern),
     * we also swipe up to dismiss the keyguard. A *secure* keyguard cannot be
     * dismissed remotely by design — the person at the device must unlock it.
     */
    @Suppress("DEPRECATION")
    private fun wakeScreen() {
        val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
        val wl = pm.newWakeLock(
            android.os.PowerManager.FULL_WAKE_LOCK or
                android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                android.os.PowerManager.ON_AFTER_RELEASE,
            "remote-agent:wake",
        )
        wl.acquire(3_000)
        wl.release()
        // Non-secure keyguard: swipe up from the bottom to dismiss.
        val km = getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager
        if (km.isKeyguardLocked && !km.isKeyguardSecure) {
            val path = Path().apply {
                moveTo(screenW / 2f, screenH * 0.9f)
                lineTo(screenW / 2f, screenH * 0.1f)
            }
            dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
                    .build(),
                null, null,
            )
        }
        Log.i(TAG, "wake screen (secure=${km.isKeyguardSecure})")
    }

    /**
     * Text entry, like a soft keyboard. ACTION_SET_TEXT replaces the whole field,
     * so we must read the CURRENT text first — but an AccessibilityNodeInfo caches
     * its text, and right after an edit that cache is stale. Reading it blindly
     * resurrects just-deleted text and appends the new char to it (the reported
     * bug). So we refresh() the node every time and insert at the real caret
     * instead of always at the end.
     */
    private fun type(text: String) {
        if (text.isEmpty()) return
        editFocused { node ->
            node.refresh() // force the latest text + selection, never the cache
            val current = node.text?.toString() ?: ""
            val (start, end) = selectionOf(node, current)
            val next = current.substring(0, start) + text + current.substring(end)
            val caret = start + text.length
            setTextAndCaret(node, next, caret)
        }
    }

    private inline fun editFocused(block: (AccessibilityNodeInfo) -> Unit) {
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
        try {
            block(node)
        } finally {
            node.recycle()
        }
    }

    /** Current selection clamped to the text, defaulting to the caret-at-end. */
    private fun selectionOf(node: AccessibilityNodeInfo, current: String): Pair<Int, Int> {
        var start = node.textSelectionStart
        var end = node.textSelectionEnd
        if (start !in 0..current.length) start = current.length
        if (end < start || end > current.length) end = start
        return start to end
    }

    private fun setTextAndCaret(node: AccessibilityNodeInfo, value: String, caret: Int) {
        node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        })
        node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, caret)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, caret)
        })
    }

    private fun AccessibilityNodeInfo.deleteLastChar() {
        refresh() // same stale-cache hazard as type()
        val current = text?.toString() ?: return
        if (current.isEmpty()) return
        val (start, end) = selectionOf(this, current)
        val next: String
        val caret: Int
        when {
            end > start -> { next = current.substring(0, start) + current.substring(end); caret = start } // delete selection
            start > 0 -> { next = current.substring(0, start - 1) + current.substring(start); caret = start - 1 } // backspace at caret
            else -> return
        }
        setTextAndCaret(this, next, caret)
    }

    private fun AccessibilityNodeInfo.pressEnter() {
        // Best effort: trigger the field's editor action (search/send/next).
        performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun x(n: Double) = (n.coerceIn(0.0, 1.0) * screenW).toFloat()
    private fun y(n: Double) = (n.coerceIn(0.0, 1.0) * screenH).toFloat()

    companion object {
        private const val TAG = "ControlService"

        @Volatile
        var instance: ControlService? = null
            private set

        /** True only while the user has the accessibility service enabled. */
        val isEnabled: Boolean get() = instance != null
    }
}
