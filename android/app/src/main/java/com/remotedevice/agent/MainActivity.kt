package com.remotedevice.agent

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

/**
 * The only user-facing screen. The user opens it, types the server address, and
 * taps "Start sharing" — which triggers the system MediaProjection consent
 * dialog. Nothing captures or transmits until the user accepts that dialog.
 */
class MainActivity : Activity() {

    private lateinit var serverField: EditText
    private lateinit var codeView: TextView
    private lateinit var statusDot: View
    private lateinit var statusView: TextView
    private lateinit var copyCode: Button
    private lateinit var shareCode: Button
    private lateinit var toggle: Button
    private lateinit var controlState: TextView
    private lateinit var controlChip: TextView
    private lateinit var enableControl: Button

    private lateinit var projectionManager: MediaProjectionManager

    private val projectionLauncher = registerForActivityResultCompat()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        projectionManager = getSystemService(MediaProjectionManager::class.java)

        serverField = findViewById(R.id.server)
        codeView = findViewById(R.id.code)
        statusDot = findViewById(R.id.statusDot)
        statusView = findViewById(R.id.status)
        copyCode = findViewById(R.id.copyCode)
        shareCode = findViewById(R.id.shareCode)
        toggle = findViewById(R.id.toggle)
        controlState = findViewById(R.id.controlState)
        controlChip = findViewById(R.id.controlChip)
        enableControl = findViewById(R.id.enableControl)

        // Default assumes the device is attached to the dev machine over adb
        // and `adb reverse tcp:7000 tcp:7000` is set up (see the Makefile): then
        // 127.0.0.1:7000 on the device reaches the relay on the computer — the
        // same value works for both the emulator and a USB-connected phone.
        // (7000 is the device TCP port; the browser viewer uses HTTP port 8080.)
        serverField.setText(prefs().getString("server", "127.0.0.1:7000"))

        toggle.setOnClickListener {
            if (ShareState.running) ScreenShareService.stop(this) else requestStart()
        }
        // Tapping the big code copies it too — the most natural gesture.
        codeView.setOnClickListener { ShareState.code?.let { Clip.copyCode(this, it) } }
        copyCode.setOnClickListener { ShareState.code?.let { Clip.copyCode(this, it) } }
        shareCode.setOnClickListener {
            val code = ShareState.code ?: return@setOnClickListener
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, getString(R.string.share_text, Clip.pretty(code)))
            startActivity(Intent.createChooser(send, getString(R.string.share_code)))
        }
        enableControl.setOnClickListener {
            // We cannot enable the service ourselves; send the user to Settings.
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            Toast.makeText(this, "Turn on \"${getString(R.string.control_service_label)}\"", Toast.LENGTH_LONG).show()
        }
        ShareState.listener = { runOnUiThread(::render) }
    }

    override fun onResume() {
        super.onResume()
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        render()
    }

    override fun onDestroy() {
        ShareState.listener = null
        super.onDestroy()
    }

    private fun requestStart() {
        val server = serverField.text.toString().trim()
        if (RelayAddress.parse(server) == null) {
            Toast.makeText(this, "Invalid address. Use host:port or the relay's domain.", Toast.LENGTH_SHORT).show()
            return
        }
        prefs().edit().putString("server", server).apply()
        // System consent dialog: "Start recording or casting with Remote Agent?"
        projectionLauncher(projectionManager.createScreenCaptureIntent())
    }

    private fun onProjectionResult(resultCode: Int, data: Intent?) {
        if (resultCode != Activity.RESULT_OK || data == null) {
            Toast.makeText(this, "Screen sharing was declined", Toast.LENGTH_SHORT).show()
            return
        }
        val server = serverField.text.toString().trim()
        if (RelayAddress.parse(server) == null) return
        ScreenShareService.start(this, resultCode, data, server)
        // Auto-start API capture with the share — no separate tap needed.
        autoStartCapture()
    }

    /** Capture starts automatically with the share — the VPN consent dialog is
     *  the only prompt, and only the first time. */
    private fun autoStartCapture() {
        if (com.remotedevice.agent.vpn.ApiBus.capturing) return
        val consent = android.net.VpnService.prepare(this)
        if (consent != null) startActivityForResult(consent, REQ_VPN) else onVpnGranted()
    }

    private fun onVpnGranted() {
        startService(Intent(this, com.remotedevice.agent.vpn.CaptureVpnService::class.java))
        render()
    }

    private fun render() {
        val running = ShareState.running
        val code = ShareState.code
        toggle.text = getString(if (running) R.string.stop else R.string.start)
        toggle.setBackgroundResource(if (running) R.drawable.btn_danger else R.drawable.btn_primary)

        codeView.text = code?.let(Clip::pretty) ?: "––– ––– –––"
        codeView.setTextColor(getColor(if (code != null) R.color.fg else R.color.idle))
        codeView.isClickable = code != null
        copyCode.isEnabled = code != null
        shareCode.isEnabled = code != null

        val (dot, line) = when {
            !running -> R.color.idle to "Not sharing. Tap the button below to start."
            code == null -> R.color.warn to ShareState.status
            ShareState.status.startsWith("Connection lost") -> R.color.warn to ShareState.status
            ShareState.viewers > 0 -> R.color.ok to "${ShareState.viewers} viewing your screen"
            else -> R.color.accent to "Ready — send this code to your supporter"
        }
        statusDot.background.mutate().setTint(getColor(dot))
        statusView.text = line

        serverField.isEnabled = !running
        serverField.alpha = if (running) 0.6f else 1f

        val control = ControlService.isEnabled
        controlState.text = if (control) {
            "Your supporter can tap, swipe and type while you share."
        } else {
            "Off — view only. Turn it on in Settings → Accessibility."
        }
        controlChip.visibility = if (control) View.VISIBLE else View.GONE
        enableControl.visibility = if (control) View.GONE else View.VISIBLE

    }

    private fun prefs() = getSharedPreferences("ui", MODE_PRIVATE)

    // --- minimal Activity-result plumbing (no AndroidX) ---

    private var projectionCallback: ((Intent) -> Unit)? = null

    private fun registerForActivityResultCompat(): (Intent) -> Unit = { intent ->
        startActivityForResult(intent, REQ_PROJECTION)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PROJECTION) onProjectionResult(resultCode, data)
        else if (requestCode == REQ_VPN && resultCode == Activity.RESULT_OK) onVpnGranted()
    }

    companion object {
        private const val REQ_PROJECTION = 100
        private const val REQ_VPN = 101
    }
}
