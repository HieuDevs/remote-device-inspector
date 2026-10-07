package com.remotedevice.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The sharing pipeline:
 *
 *   MediaProjection ─▶ VirtualDisplay ─▶ Surface ─▶ MediaCodec (H.264) ─▶ RelayClient ─▶ relay
 *                                                                               │
 *                        ControlService (dispatchGesture) ◀── control JSON ◀────┘
 *
 * This service only ever runs after the user has accepted the system
 * MediaProjection consent dialog, and it keeps a persistent, non-dismissible
 * notification visible for the entire session. There is no silent mode.
 */
class ScreenShareService : Service(), RelayClient.Listener {

    private val main = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var encoder: VideoEncoder? = null
    private var relay: RelayClient? = null

    @Volatile private var viewers = 0
    /** SPS/PPS of the current encoder, replayed to the relay after every reconnect. */
    @Volatile private var lastConfig: ByteArray? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_COPY) {
            ShareState.code?.let { Clip.copyCode(this, it) }
            return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data: Intent? = intent?.let {
            if (Build.VERSION.SDK_INT >= 33) it.getParcelableExtra(EXTRA_DATA, Intent::class.java)
            else @Suppress("DEPRECATION") it.getParcelableExtra(EXTRA_DATA)
        }
        val server = intent?.getStringExtra(EXTRA_SERVER)
        val address = server?.let { RelayAddress.parse(it) }
        if (data == null || address == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        // Android 10+: a mediaProjection foreground service must be in the
        // foreground *before* the projection token is redeemed.
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, buildNotification("Starting…"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, buildNotification("Starting…"))
        }

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mp = mpm.getMediaProjection(resultCode, data)
        if (mp == null) {
            Log.e(TAG, "projection token rejected")
            stopSelf()
            return START_NOT_STICKY
        }
        // The user revoking the capture (via the system "casting" chip) stops us.
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                main.post { stopSelf() }
            }
        }, main)
        projection = mp

        startPipeline(mp, address)
        ShareState.update(running = true, status = "Connecting to the relay…")
        return START_NOT_STICKY
    }

    private fun startPipeline(mp: MediaProjection, address: RelayAddress) {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(metrics)
        val (w, h) = scaleToMax(metrics.widthPixels, metrics.heightPixels, MAX_DIMENSION)

        val enc = VideoEncoder(w, h, bitrateFor(w, h)) { fl, pts, data ->
            if (fl and Protocol.FLAG_CONFIG != 0) lastConfig = data
            relay?.sendVideo(fl, pts, data)
        }
        encoder = enc

        virtualDisplay = mp.createVirtualDisplay(
            "remote-agent",
            w, h, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            enc.inputSurface, null, null,
        )

        val model = "${Build.MANUFACTURER} ${Build.MODEL}"
        relay = RelayClient(
            address,
            hello = {
                JSONObject().apply {
                    put("deviceId", Installation.id(this@ScreenShareService))
                    put("model", model)
                    put("sdk", Build.VERSION.SDK_INT)
                    put("control", ControlService.isEnabled)
                }
            },
            listener = this,
        ).also { it.start() }

        // Forward captured API flow records (if the VPN capture is running) to viewers.
        com.remotedevice.agent.vpn.ApiBus.sink = { record -> relay?.sendJson(Protocol.APILOG, record) }
        // Also accept full request/response logs that on-device apps push to us
        // over loopback (no CA/root needed — see InspectorBridge).
        com.remotedevice.agent.vpn.InspectorBridge.start()

        main.post { enc.requestKeyFrame() }
        startHeartbeat()
    }

    private val heartbeat = object : Runnable {
        override fun run() {
            relay?.sendJson(Protocol.HEARTBEAT, JSONObject().put("control", ControlService.isEnabled))
            main.postDelayed(this, 5_000)
        }
    }

    private fun startHeartbeat() {
        main.removeCallbacks(heartbeat)
        main.postDelayed(heartbeat, 5_000)
    }

    // --- RelayClient.Listener (called on relay threads) ---

    override fun onSession(code: String) = main.post {
        ShareState.update(code = code, status = "Ready. Read the code to your supporter.")
        updateNotification(statusLine())
        // A fresh viewer needs config + a keyframe; also re-send config after reconnect.
        lastConfig?.let { relay?.sendVideo(Protocol.FLAG_CONFIG, 0, it) }
        encoder?.requestKeyFrame()
        encoder?.let { relay?.sendJson(Protocol.META, JSONObject().put("width", it.width).put("height", it.height)) }
    }.let { }

    override fun onDisconnected(error: String?) = main.post {
        ShareState.update(status = "Connection lost, retrying… ${error ?: ""}".trim())
        updateNotification("Reconnecting…")
    }.let { }

    override fun onViewers(count: Int) = main.post {
        viewers = count
        ShareState.update(viewers = count)
        updateNotification(statusLine())
        if (count > 0) {
            lastConfig?.let { relay?.sendVideo(Protocol.FLAG_CONFIG, 0, it) }
            encoder?.requestKeyFrame()
            // Tell the new viewer whether API capture is currently running.
            relay?.sendJson(Protocol.APILOG, org.json.JSONObject().put("ev", "capture").put("on", com.remotedevice.agent.vpn.ApiBus.capturing))
        }
    }.let { }

    override fun onKeyFrameRequest() {
        encoder?.requestKeyFrame()
    }

    override fun onControl(msg: JSONObject) {
        // Input is only ever applied if the user separately enabled the
        // accessibility service; otherwise the session is view-only.
        ControlService.instance?.handle(msg)
    }

    // --- lifecycle ---

    override fun onDestroy() {
        main.removeCallbacks(heartbeat)
        com.remotedevice.agent.vpn.ApiBus.sink = null
        com.remotedevice.agent.vpn.InspectorBridge.stop()
        relay?.stop()
        virtualDisplay?.release()
        encoder?.release()
        projection?.stop()
        relay = null
        encoder = null
        virtualDisplay = null
        projection = null
        ShareState.update(running = false, code = null, status = "Sharing stopped.", viewers = 0)
        super.onDestroy()
    }

    // --- notification (always visible while sharing) ---

    private fun statusLine(): String {
        val code = ShareState.code
        val who = if (viewers > 0) "$viewers viewing" else "no one connected yet"
        return if (code != null) "Code ${Clip.pretty(code)} · $who" else who
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        val ch = NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW)
        ch.description = "Shown while your screen is being shared."
        nm.createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true) // cannot be swiped away
            .setContentIntent(open)
        if (ShareState.code != null) {
            val copy = PendingIntent.getService(
                this, 2, Intent(this, ScreenShareService::class.java).setAction(ACTION_COPY),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.addAction(Notification.Action.Builder(null, getString(R.string.copy_code), copy).build())
        }
        return builder
            .addAction(Notification.Action.Builder(null, getString(R.string.stop), stop).build())
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(text))
    }

    companion object {
        private const val TAG = "ScreenShareService"
        private const val CHANNEL = "screen_share"
        private const val NOTIF_ID = 1
        private const val MAX_DIMENSION = 1280 // long edge; keeps bitrate/latency sane
        const val ACTION_STOP = "com.remotedevice.agent.STOP"
        const val ACTION_COPY = "com.remotedevice.agent.COPY_CODE"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_SERVER = "server"

        fun start(ctx: Context, resultCode: Int, data: Intent, server: String) {
            val i = Intent(ctx, ScreenShareService::class.java)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_DATA, data)
                .putExtra(EXTRA_SERVER, server)
            ctx.startForegroundService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, ScreenShareService::class.java).setAction(ACTION_STOP))
        }

        private fun scaleToMax(w: Int, h: Int, maxEdge: Int): Pair<Int, Int> {
            val longEdge = max(w, h)
            if (longEdge <= maxEdge) return even(w) to even(h)
            val s = maxEdge.toDouble() / longEdge
            return even((w * s).roundToInt()) to even((h * s).roundToInt())
        }

        // H.264 requires even dimensions.
        private fun even(v: Int) = v and 1.inv()

        private fun bitrateFor(w: Int, h: Int): Int =
            (w.toLong() * h * 30 / 20).toInt().coerceIn(1_000_000, 8_000_000)
    }
}
