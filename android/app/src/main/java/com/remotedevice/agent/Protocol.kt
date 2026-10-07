package com.remotedevice.agent

/**
 * Wire format between this agent and the relay (see server/server.js):
 *
 *     u8 type | u32 big-endian length | payload
 *
 * A length prefix is all TCP needs to turn its byte stream back into messages.
 */
object Protocol {
    const val HELLO = 0x01      // → relay  JSON {deviceId, model, sdk, control}
    const val SESSION = 0x02    // ← relay  JSON {code}
    const val HEARTBEAT = 0x03  // → relay  JSON {control}
    const val VIDEO = 0x10      // → relay  u8 flags | u64 ptsUs | H.264 Annex-B
    const val META = 0x11       // → relay  JSON {width, height}
    const val CONTROL = 0x20    // ← relay  JSON from viewer
    const val VIEWERS = 0x21    // ← relay  JSON {count}
    const val KEYFRAME = 0x22   // ← relay  (empty)
    const val APILOG = 0x30     // → relay  JSON network flow record (one per line)

    const val FLAG_CONFIG = 1   // SPS/PPS, needed before any frame can be decoded
    const val FLAG_KEY = 2      // IDR frame, decodable on its own

    const val MAX_FRAME = 8 * 1024 * 1024
}
