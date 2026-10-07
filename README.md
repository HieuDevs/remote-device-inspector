# Device Inspector

See your mobile app's API traffic and control an Android phone from the browser.

- **API view**: every request your app makes (headers, body, timing), with JSON, Server-Sent Events, images and binary rendered properly. Add one interceptor to the app; no certificates or system proxy needed.
- **Device view**: the phone's screen streamed live (hardware H.264 → WebCodecs). Click, drag, scroll and type to control it.

Requires **[Bun](https://bun.com) 1.4+** (package manager) and **Node.js 20.19+** (runtime). The Android agent needs Android 8.0+.

---

## Quick start

```bash
make server
```

Open **http://localhost:8080** and choose **API** or **Device**.

---

## Inspect your app's API

1. Open **API**. With no requests yet, the page shows the setup guide.
2. Pick where the app runs (Android emulator, iOS simulator, phone over USB or Wi-Fi). The guide shows the ingest URL and a **Send test** button to test it.
3. Copy the interceptor for your stack: Flutter (Dio), Android (OkHttp), iOS (Alamofire) or React Native (axios). The code already contains the right URL.

### Without changing the app

Set the phone's HTTP proxy to your computer's IP and port `8080`. Plain HTTP requests show full headers and bodies. HTTPS requests only show host, timing and size.

### Ingest format

`POST /ingest` accepts one JSON object or an array of them:

| Field | Notes |
| :--- | :--- |
| `url` | Required. |
| `method` | Default `GET`. |
| `status` / `statusCode` | |
| `reqHeaders`, `reqBody` | Headers as an object or `[name, value]` pairs. |
| `respHeaders` / `resHeaders`, `respBody` / `resBody` | |
| `respBodyEnc: "base64"` | For binary bodies (images, files). Same for `reqBodyEnc`. |
| `durationMs` / `ms`, `time` / `t` | Duration and start time (epoch ms). |
| `app` | Name shown in the list. |
| `messages` | WebSocket frames: `[{ "dir": "send" \| "recv", "data": …, "t": … }]`. |

```bash
curl -X POST http://127.0.0.1:8080/ingest -H 'Content-Type: application/json' \
  -d '{"url":"https://api.example.com/v1/orders","method":"GET","status":200,"resBody":"{\"ok\":true}","durationMs":78}'
```

---

## Control an Android phone

1. Connect the phone over USB and run `make run` (builds, installs and opens the **Remote Agent** app). For a phone elsewhere, build with `make apk` and send it `android/app/build/outputs/apk/debug/app-debug.apk`.
2. In the app, set **Relay server**:
   - USB or emulator: `127.0.0.1:7000` (`make run` sets up `adb reverse`).
   - Same Wi-Fi: `<your computer's IP>:7000`.
   - Remote: expose the relay with `make tunnel-cf` (or `make tunnel` / `make tunnel-ssh`) and enter that domain.
3. Turn on **Remote control** (Accessibility) and tap **Start sharing**. The app shows a 9-digit session code.
4. In the browser, open **Device** and enter the code.

Click to tap, drag to swipe, scroll to scroll, right-click for Back, type to enter text. **Network** shows the phone's own network requests.

---

## Using the dashboard

- **Filter**: type in the search box. Click **?** next to it for the syntax: `status:4xx`, `method:post`, `host:api`, `type:json`, `ms:>500`, `size:>50kb`, `slow`.
- **Request details**: click a row. Response bodies get the right view for their type: JSON tree, SSE events, NDJSON lines, image/PDF/audio/video preview, HTML preview, XML, form table or hex. Bodies are never cut; search works in every view.
- **Replay**: **Resend**, or the pencil to edit first. **cURL** in the toolbar runs or imports any cURL command.
- **⋯ menu**: export HAR, open the setup guide, move the panel and the detail pane.
- **Keyboard**: ↑ / ↓ to move through requests, Esc to close the detail.

---

## Development

```bash
make dev
```

Opens the dashboard at **http://localhost:5173** with hot reload. The relay restarts on changes and still listens on `8080`, so apps keep sending there.

```
server/src/    Relay (TypeScript, Node)
  protocol/    Types shared with the dashboard
  device/      Agent protocol and sessions
  debug/       /ingest and the live feed
  http/        Routes, forward proxy, cURL runner, static files
  ws/          WebSocket endpoints (/ws dashboard, /device agent)
web/src/       Dashboard (React + TypeScript + Vite)
android/       Remote Agent app
```

Other checks: `bun run typecheck`, `bun run build`.

---

## Commands

| Command | |
| :--- | :--- |
| `make server` | Build and run. Dashboard and API on `:8080`, agent connections on `:7000`. |
| `make dev` | Develop with hot reload (`:5173`). |
| `make apk` | Build the agent APK. |
| `make run` | Build, install and open the agent on a USB-connected phone. |
| `make reinstall` / `make reverse` / `make logcat` | Reinstall the APK, set up `adb reverse`, show agent logs. |
| `make tunnel-cf` / `make tunnel` / `make tunnel-ssh` | Expose the relay over HTTPS (Cloudflare / ngrok / localhost.run). |

Ports: `make server HTTP_PORT=9090 DEVICE_PORT=7100`.

> `/exec` (cURL runner) and the forward proxy fetch any URL the relay can reach. Run the relay on a trusted network.
