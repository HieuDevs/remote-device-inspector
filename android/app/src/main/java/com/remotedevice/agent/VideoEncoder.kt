package com.remotedevice.agent

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.util.Log
import android.view.Surface

/**
 * Hardware H.264 encoder fed by a Surface.
 *
 * The VirtualDisplay renders the mirrored screen straight into [inputSurface]
 * on the GPU, so pixels never pass through app memory. We only ever touch the
 * compressed output, which is a few KB per frame.
 */
class VideoEncoder(
    val width: Int,
    val height: Int,
    bitrate: Int,
    private val onPacket: (flags: Int, ptsUs: Long, data: ByteArray) -> Unit,
) {
    private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    val inputSurface: Surface
    @Volatile private var running = true
    private val drainThread: Thread

    init {
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            // Rare periodic keyframes; viewers ask for one explicitly when they need it.
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 10)
            // A static screen produces no new frames; repeat the last one so
            // a viewer that just joined still gets a picture within 100 ms.
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000)
            setInteger(MediaFormat.KEY_PRIORITY, 0) // real-time
        }
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = codec.createInputSurface()
        codec.start()
        drainThread = Thread(::drain, "encoder").apply { start() }
    }

    fun requestKeyFrame() {
        try {
            codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (e: IllegalStateException) {
            // Encoder already stopped.
        }
    }

    fun release() {
        running = false
        drainThread.join(500)
        try {
            codec.stop()
        } catch (_: IllegalStateException) {
        }
        codec.release()
        inputSurface.release()
    }

    private fun drain() {
        val info = MediaCodec.BufferInfo()
        try {
            while (running) {
                val index = codec.dequeueOutputBuffer(info, 100_000)
                if (index < 0) continue
                val buffer = codec.getOutputBuffer(index)
                if (buffer != null && info.size > 0) {
                    val data = ByteArray(info.size)
                    buffer.position(info.offset)
                    buffer.get(data)
                    var flags = 0
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) flags = flags or Protocol.FLAG_CONFIG
                    if (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0) flags = flags or Protocol.FLAG_KEY
                    onPacket(flags, info.presentationTimeUs, data)
                }
                codec.releaseOutputBuffer(index, false)
            }
        } catch (e: IllegalStateException) {
            if (running) Log.e(TAG, "encoder failed", e)
        }
    }

    companion object {
        private const val TAG = "VideoEncoder"
    }
}
