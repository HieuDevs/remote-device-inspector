# Device Inspector

**English** · [Tiếng Việt](README.vi.md)

A self-hosted relay and web dashboard for mobile engineers:

- **API inspector**: see every HTTP / WebSocket call your app makes, with full headers and bodies. JSON, Server-Sent Events, NDJSON, images, PDF, media, HTML, XML and binary each get a suitable viewer. Bodies are never truncated.
- **Android remote control**: stream a phone's screen to the browser (hardware H.264 decoded with WebCodecs) and tap, swipe and type on it. The phone's own network traffic shows up next to the screen.

No root, no CA certificate, no system-wide MITM. Your app reports its own traffic, or you route it through the relay's HTTP proxy.

---

## Contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Getting traffic into the inspector](#getting-traffic-into-the-inspector)
- [Ingest API](#ingest-api)
- [Android remote control](#android-remote-control)
- [Using the dashboard](#using-the-dashboard)
- [Relay reference](#relay-reference)
- [Development](#development)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

---

## Architecture

```
 ┌──────────────────────┐   POST /ingest (JSON)    ┌──────────────────────────┐   WebSocket /ws   ┌───────────────┐
 │ Your app             │ ───────────────────────▶ │                          │ ◀───────────────▶ │  Dashboard    │
 │ (Dio/OkHttp/Alamofire│   or HTTP proxy :8080    │   Relay (Node, TS)       │                   │  React + Vite │
 │  /axios interceptor) │ ───────────────────────▶ │   :8080  HTTP + WS       │                   │  (browser)    │
 └──────────────────────┘                          │   :7000  device TCP      │                   └───────────────┘
 ┌──────────────────────┐   framed TCP :7000       │                          │
 │ Android Remote Agent │ ───────────────────────▶ │   sessions, proxy,       │
 │ (screen, input, VPN) │   or wss://…/device      │   ingest, /exec          │
 └──────────────────────┘                          └──────────────────────────┘
```

- Every client dials **out** to the relay, so neither the phone nor the browser needs a public IP.
- The relay never decodes video. It forwards H.264 packets from the device to viewers and control JSON from viewers to the device.
- `server/src/protocol/flow.ts` holds the types shared by the relay and the dashboard (type-only, imported through the `@proto` alias).

| Path | Stack |
| :--- | :--- |
| `server/` | Relay: Node ≥ 20.19, TypeScript, `ws` |
| `web/` | Dashboard: React 19, TypeScript, Vite, zustand |
| `android/` | Remote Agent: Kotlin, minSdk 26 (Android 8.0), MediaProjection, AccessibilityService, VpnService |

---

## Quick start

Requirements: [Bun](https://bun.com) ≥ 1.4 (package manager and scripts) and Node.js ≥ 20.19 (runtime).

```bash
make server        # bun install → build web + server → node server/dist/index.js
```

Open **http://localhost:8080**, then choose **API** or **Device** in the header.

Smoke test:

```bash
curl -X POST http://127.0.0.1:8080/ingest -H 'Content-Type: application/json' \
  -d '{"url":"https://api.example.com/v1/orders","method":"GET","status":200,"respBody":"{\"ok\":true}","ms":78}'
```

---

## Getting traffic into the inspector

| Option | What you see | App change | Best for |
| :--- | :--- | :--- | :--- |
| **1. In-app interceptor → `/ingest`** | Everything, HTTPS included (the app sends plaintext it already has) | One interceptor | Your own app, any platform |
| **2. HTTP proxy on `:8080`** | HTTP: full headers and bodies, SSE / NDJSON live. HTTPS: host, timing, size only | None | Quick checks, third-party apps |
| **3. Android Remote Agent** | Phone traffic via a local VPN (host from SNI/DNS, timing, size), plus full transactions from apps that POST to `127.0.0.1:8899` on the phone | None (optional bridge call) | Debugging on a real device |

### 1. In-app interceptor

With the list empty, the **API** view shows a setup guide. The **⋯ → Connect your app** menu opens it at any time.

1. Pick where the app runs. The ingest URL changes with it:

   | Environment | Ingest URL |
   | :--- | :--- |
   | Android emulator | `http://10.0.2.2:8080/ingest` |
   | iOS simulator | `http://127.0.0.1:8080/ingest` |
   | Phone over USB | `http://127.0.0.1:8080/ingest` after `adb reverse tcp:8080 tcp:8080` |
   | Phone over Wi-Fi | `http://<your LAN IP>:8080/ingest` |

2. Copy the interceptor for your stack: **Flutter** (Dio), **Android** (OkHttp), **iOS** (Alamofire `EventMonitor`) or **React Native** (axios). The generated code already contains the URL you picked.
3. Click **Send test** to check that the relay is reachable.

Plain HTTP to a LAN IP needs a cleartext exception in debug builds (Android `network_security_config`, iOS ATS `NSAllowsLocalNetworking`).

### 2. HTTP proxy

Set the phone's Wi-Fi proxy (or the emulator's, see the guide's **Proxy** tab) to `<your LAN IP>:8080`. Absolute-form requests are proxied and recorded. `CONNECT` tunnels are recorded as metadata only, since the payload is encrypted.

---

## Ingest API

`POST /ingest` (alias `POST /api/log`) takes one JSON object or an array of them. It returns `{"ok":true,"count":N}`.

| Field (aliases) | Type | Notes |
| :--- | :--- | :--- |
| `url` (`uri`, `path`, `endpoint`) | string | Required. Absolute URL preferred; `host/path` and `/path` also accepted. |
| `method` | string | Default `GET`. |
| `reqHeaders` (`requestHeaders`, `headers`) | object or `[name, value][]` | |
| `reqBody` (`requestBody`, `body`) | string or JSON | Objects are stringified. |
| `reqBodyEnc` | `"base64"` | Set for binary request bodies. |
| `status` (`statusCode`, `code`) | number | **Response fields are read only when this is present.** |
| `respHeaders` (`resHeaders`, `responseHeaders`) | object or `[name, value][]` | |
| `respBody` (`resBody`, `responseBody`, `response`) | string or JSON | |
| `respBodyEnc` (`resBodyEnc`) | `"base64"` | Required for images, files, protobuf, anything non-UTF-8. |
| `ctype` | string | Overrides the response `Content-Type` for picking a viewer. |
| `ms` (`durationMs`, `duration`) | number | Duration in ms. |
| `t` (`time`, `timestamp`) | number | Start time, epoch ms. Default `now - ms`. |
| `app` | string | Shown in the list; enables the per-app filter. |
| `id` | string | Reuse an id to update an existing row. |
| `messages` | `{dir, data, t}[]` | WebSocket frames. `dir` is `send` or `recv`. A `ws://` / `wss://` URL marks the row as WebSocket. |

```json
{
  "url": "https://api.example.com/v1/avatar.png",
  "method": "GET",
  "status": 200,
  "respHeaders": { "Content-Type": "image/png" },
  "respBody": "iVBORw0KGgo…",
  "respBodyEnc": "base64",
  "ms": 42,
  "app": "Shop (debug)"
}
```

---

## Android remote control

1. Build and install the agent:
   - USB: `make run` (sets up `adb reverse`, builds, installs and launches **Remote Agent**).
   - Otherwise: `make apk`, then install `android/app/build/outputs/apk/debug/app-debug.apk`.
2. In the app, set **Relay server**:

   | Phone | Value |
   | :--- | :--- |
   | Emulator or USB | `127.0.0.1:7000` (raw TCP over `adb reverse`) |
   | Same Wi-Fi | `<your LAN IP>:7000` |
   | Anywhere | A public domain from `make tunnel-cf` / `make tunnel` / `make tunnel-ssh`. The agent switches to `wss://<domain>/device`. |

3. Turn on **Remote control** (Accessibility service) and tap **Start sharing**. Accept the screen-capture prompt and, the first time, the VPN prompt that enables traffic capture.
4. The app shows a 9-digit session code. In the dashboard, open **Device** and enter it.

Input: click to tap, drag to swipe, wheel to scroll, right-click for Back, type to enter text. The buttons under the screen send Home, Recents, Notifications, Lock and Wake. **Network** in the header opens the phone's traffic.

Without the Accessibility service the session is view-only. The header shows `· view only (control is off)`.

---

## Using the dashboard

**Filter** (search box, **?** for help). Combine terms with spaces:

| Query | Matches |
| :--- | :--- |
| `login` | text in the URL, headers or body |
| `status:4xx` | status class (`2xx`, `5xx`, `err`…) |
| `method:post`, `host:api`, `type:json` | method, host, content type |
| `ms:>500`, `size:>50kb` | slower than 500 ms, larger than 50 KB |
| `slow` | ≥ 800 ms |

The chips filter by **All / Pinned / Errors / HTTP / HTTPS / WS** (and **DNS** in Device mode).

**Details**: click a row. Tabs are **General / Request / Response** (plus **WebSocket**). Headers sit on the left, the body on the right, with a draggable divider.

**Body viewers**: JSON tree (lossless: large integers keep every digit), raw, SSE events, NDJSON lines, image / SVG / PDF / audio / video / sandboxed HTML preview, XML, form table, hex. Search in the body works in every view and expands collapsed JSON to show matches. Streaming responses update live.

**Actions**:
- Right-click a row: copy URL / cURL / body, **Resend**, **Edit and resend**, **Pin**, filter by host or app.
- **cURL** in the toolbar runs a pasted cURL command through the relay (no CORS), or imports it into the list without sending.
- **⋯**: export HAR, open the setup guide, dock the panel (top / bottom / left / right) and place the details pane.
- The pause button freezes the list; new rows are buffered.

**Keyboard**: `↑` / `↓` move through rows, `Esc` closes the details pane, `Enter` / `Shift+Enter` step through body search hits.

Layout choices (dock, sizes, preferred body view per type) are saved in `localStorage`.

---

## Relay reference

### HTTP (`HTTP_PORT`, default 8080)

| Endpoint | Description |
| :--- | :--- |
| `POST /ingest`, `POST /api/log` | Record flows (see [Ingest API](#ingest-api)). |
| `POST /clear` | Clear the replay history kept for new viewers. |
| `GET /api/info`, `GET /info` | `{port, devicePort, ips[], primaryIp, hostname}`. Used by the setup guide. |
| `POST /exec` | Perform `{method, url, headers, body}` from the relay. Returns status, headers, body (base64 when binary), `ms`, `ttfb`. |
| absolute-form request / `CONNECT` | Forward proxy. |
| `GET /*` | Dashboard from `web/dist` with SPA fallback. |
| `WS /ws?mode=debug` | Dashboard feed for the API view: `{type:"api", flow}` messages. The last 100 flows are replayed on connect. |
| `WS /ws?code=<9 digits>` | Device session: binary video frames, `status` / `meta` / `api` JSON. Control JSON goes the other way (`down`, `move`, `up`, `gesture`, `key`, `type`, `keyframe`; ≤ 4 KB). Close codes: `4404` unknown code, `4429` too many attempts, `4410` session ended. |
| `WS /device` | Agent transport through a tunnel. Same framing as TCP. |

### Device protocol (`DEVICE_PORT`, default 7000, or `WS /device`)

Every frame, in both directions: `u8 type | u32 BE length | payload`, max 8 MB. Must match `android/…/Protocol.kt`.

| Type | Dir | Payload |
| :--- | :--- | :--- |
| `0x01 HELLO` | device → relay | JSON `{deviceId, model, sdk, control}` |
| `0x02 SESSION` | relay → device | JSON `{code}` |
| `0x03 HEARTBEAT` | device → relay | JSON `{control}` every 5 s; 30 s idle closes TCP |
| `0x10 VIDEO` | device → relay | `u8 flags (1=config, 2=key) | u64 ptsUs | H.264 Annex-B` |
| `0x11 META` | device → relay | JSON `{width, height}` |
| `0x20 CONTROL` | relay → device | Control JSON from a viewer |
| `0x21 VIEWERS` | relay → device | JSON `{count}` |
| `0x22 KEYFRAME` | relay → device | empty; request an IDR frame |
| `0x30 APILOG` | device → relay | JSON flow record |

A device that reconnects within 10 minutes keeps its session code (keyed by `deviceId`).

### Configuration

| Variable | Default | Used by |
| :--- | :--- | :--- |
| `HTTP_PORT` | `8080` | Relay HTTP / WS port; Vite dev proxy target |
| `DEVICE_PORT` | `7000` | Relay TCP port for agents |
| `WEB_DIST` | `web/dist` | Directory the relay serves the dashboard from |
| `RELAY_URL` | `http://localhost:$HTTP_PORT` | Vite dev proxy target, to develop the UI against a remote relay |

`make server HTTP_PORT=9090 DEVICE_PORT=7100` passes them through.

---

## Development

```bash
make dev           # relay (tsx watch) + Vite, side by side
```

| URL | Serves |
| :--- | :--- |
| http://localhost:5173 | Dashboard with hot reload. Vite proxies `/ws`, `/ingest`, `/exec`, `/clear`, `/api` to the relay. |
| http://localhost:8080 | Relay. Apps and agents keep pointing here. It serves the last **built** dashboard. |

```
server/src/
  index.ts        HTTP server, upgrade routing (/ws, /device), TCP listener
  config.ts       ports, limits
  protocol/       wire types shared with the dashboard (type-only)
  device/         frame codec, sessions, TCP transport
  debug/          /ingest normalisation, live feed + replay history
  http/           routes, forward proxy, /exec, static files
  ws/             viewer and device WebSocket endpoints
web/src/
  App.tsx, Header.tsx
  net/            network panel: toolbar, list, details, context menu
  body/           body viewer, JSON tree
  lib/            pure logic: body analysis, filters, cURL parse, HAR, formatting
  store/          zustand stores (flows, layout, UI)
  remote/         device session, WebCodecs video pipe, input
  guide/          setup guide and interceptor snippets
  modals/, hooks/, styles/
android/app/src/main/java/com/remotedevice/agent/
  ScreenShareService, VideoEncoder, RelayClient, Protocol, ControlService
  vpn/            CaptureVpnService (traffic metadata), InspectorBridge (127.0.0.1:8899)
```

| Command | |
| :--- | :--- |
| `bun run typecheck` | `tsc --noEmit` in both workspaces (`noUnusedLocals` / `noUnusedParameters` on) |
| `bun run build` | `web/dist` then `server/dist` |
| `bun run start` | Run the built relay |

Conventions:
- Wire types live in `server/src/protocol/flow.ts`; change them there and both sides fail to compile until they agree.
- The relay has a single runtime dependency (`ws`). Keep it small.
- Device protocol changes need matching edits in `server/src/device/protocol.ts` and `Protocol.kt`.

### Make targets

| Command | |
| :--- | :--- |
| `make server` | Install, build, run on `:8080` / `:7000` |
| `make dev` | Develop with hot reload (`:5173`) |
| `make apk` | Build the debug APK |
| `make run` | `adb reverse`, reinstall and launch the agent |
| `make reinstall` / `make reverse` / `make logcat` | Reinstall, port-forward `:7000`, agent logs |
| `make tunnel-cf` / `make tunnel` / `make tunnel-ssh` | Expose `:8080` over HTTPS (Cloudflare / ngrok / localhost.run) |

---

## Limits

| Limit | Value | Where |
| :--- | :--- | :--- |
| JSON body for `/ingest`, `/exec` | 256 MB | `server/src/config.ts` |
| Device frame | 8 MB | `protocol.ts`, `Protocol.kt` |
| Body via the on-device bridge | 4 MB | `InspectorBridge.kt` |
| Replay history for new viewers | 100 flows | `config.ts` |
| Rows kept in the dashboard | 800 per mode (pinned rows kept) | `web/src/store/net.ts` |
| `/exec` timeout | 25 s | `config.ts` |
| Wrong session codes | 20 per IP per 10 min | `ws/viewer.ts` |

---

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Nothing shows up from the app | Click **Send test** in the guide. Check the ingest URL for your environment, `adb reverse` for USB, and the cleartext exception for plain HTTP. |
| Old UI at `:8080` during `make dev` | `:8080` serves the last build. Use `:5173`, or run `make server` to rebuild. |
| `bun install` / `bun upgrade` fails with `SELF_SIGNED_CERT_IN_CHAIN` | Corporate TLS proxy. Bun doesn't read the macOS keychain: export it with `security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > ~/ca.pem` and set `NODE_EXTRA_CA_CERTS=~/ca.pem`. |
| "This browser doesn't support WebCodecs" | Use recent Chrome, Edge or Safari, over `https://` or `localhost` (secure context required). |
| Device is view-only | Turn on the **Remote control** Accessibility service on the phone. |
| Image body shows "corrupted" note | The client sent binary as text. Send `respBodyEnc: "base64"`. |

---

## Security

The relay is a development tool. Run it on a trusted network.

- `/exec` and the forward proxy fetch any URL the relay can reach.
- `/ingest` and the API feed have no authentication; anyone who can reach `:8080` can read and write flows.
- Device sessions are protected only by the 9-digit code (rate-limited per IP). Remote control works only while the phone owner is actively sharing, and stops from the notification.
- When exposing the relay through a tunnel, remember all of the above becomes public.
