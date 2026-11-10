# Device Inspector

[English](README.md) · **Tiếng Việt**

Relay tự host kèm dashboard web, dành cho kỹ sư mobile:

- **Soi API**: xem mọi request HTTP / WebSocket app gửi đi, đủ headers và body. JSON, Server-Sent Events, NDJSON, ảnh, PDF, media, HTML, XML và nhị phân đều có trình xem phù hợp. Body không bao giờ bị cắt.
- **Điều khiển Android từ xa**: stream màn hình điện thoại lên trình duyệt (H.264 phần cứng, giải mã bằng WebCodecs), chạm, vuốt và gõ phím trực tiếp. Traffic mạng của điện thoại hiện ngay cạnh màn hình.

Không cần root, không cài CA, không MITM toàn hệ thống. App tự gửi traffic của nó lên, hoặc bạn cho traffic đi qua HTTP proxy của relay.

---

## Mục lục

- [Kiến trúc](#kiến-trúc)
- [Chạy nhanh](#chạy-nhanh)
- [Đưa traffic vào inspector](#đưa-traffic-vào-inspector)
- [Ingest API](#ingest-api)
- [Điều khiển Android](#điều-khiển-android)
- [Dùng dashboard](#dùng-dashboard)
- [Tham chiếu relay](#tham-chiếu-relay)
- [Phát triển](#phát-triển)
- [Giới hạn](#giới-hạn)
- [Xử lý sự cố](#xử-lý-sự-cố)
- [Bảo mật](#bảo-mật)

---

## Kiến trúc

```
 ┌──────────────────────┐   POST /ingest (JSON)    ┌──────────────────────────┐   WebSocket /ws   ┌───────────────┐
 │ App của bạn          │ ───────────────────────▶ │                          │ ◀───────────────▶ │  Dashboard    │
 │ (interceptor Dio/    │   hoặc HTTP proxy :8080  │   Relay (Node, TS)       │                   │  React + Vite │
 │  OkHttp/Alamofire/…) │ ───────────────────────▶ │   :8080  HTTP + WS       │                   │  (trình duyệt)│
 └──────────────────────┘                          │   :7000  TCP cho device  │                   └───────────────┘
 ┌──────────────────────┐   TCP đóng khung :7000   │                          │
 │ Android Remote Agent │ ───────────────────────▶ │   session, proxy,        │
 │ (màn hình, input,VPN)│   hoặc wss://…/device    │   ingest, /exec          │
 └──────────────────────┘                          └──────────────────────────┘
```

- Mọi client đều **chủ động kết nối ra** relay, nên điện thoại và trình duyệt đều không cần IP public.
- Relay không giải mã video. Nó chỉ chuyển gói H.264 từ device tới viewer, và JSON điều khiển từ viewer về device.
- `server/src/protocol/flow.ts` chứa các kiểu dùng chung giữa relay và dashboard (chỉ có type, import qua alias `@proto`).

| Thư mục | Công nghệ |
| :--- | :--- |
| `server/` | Relay: Node ≥ 20.19, TypeScript, `ws` |
| `web/` | Dashboard: React 19, TypeScript, Vite, zustand |
| `android/` | Remote Agent: Kotlin, minSdk 26 (Android 8.0), MediaProjection, AccessibilityService, VpnService |

---

## Chạy nhanh

Yêu cầu: [Bun](https://bun.com) ≥ 1.4 (quản lý package và chạy script) và Node.js ≥ 20.19 (runtime).

```bash
make server        # bun install → build web + server → node server/dist/index.js
```

Mở **http://localhost:8080**, chọn **API** hoặc **Device** trên header.

Thử nhanh:

```bash
curl -X POST http://127.0.0.1:8080/ingest -H 'Content-Type: application/json' \
  -d '{"url":"https://api.example.com/v1/orders","method":"GET","status":200,"respBody":"{\"ok\":true}","ms":78}'
```

---

## Đưa traffic vào inspector

| Cách | Thấy được gì | Sửa app | Phù hợp khi |
| :--- | :--- | :--- | :--- |
| **1. Interceptor trong app → `/ingest`** | Tất cả, kể cả HTTPS (app gửi plaintext nó đang có) | Thêm 1 interceptor | App của bạn, mọi nền tảng |
| **2. HTTP proxy ở `:8080`** | HTTP: đủ headers và body, SSE / NDJSON cập nhật trực tiếp. HTTPS: chỉ host, thời gian, dung lượng | Không | Kiểm tra nhanh, app bên thứ ba |
| **3. Android Remote Agent** | Traffic của máy qua VPN cục bộ (host từ SNI/DNS, thời gian, dung lượng), cộng transaction đầy đủ từ app nào POST tới `127.0.0.1:8899` trên máy | Không (gọi bridge là tuỳ chọn) | Debug trên máy thật |

### 1. Interceptor trong app

Khi danh sách trống, màn **API** hiện sẵn hướng dẫn. Lúc nào cũng mở lại được qua **⋯ → Connect your app**.

1. Chọn nơi app chạy. Ingest URL đổi theo:

   | Môi trường | Ingest URL |
   | :--- | :--- |
   | Android emulator | `http://10.0.2.2:8080/ingest` |
   | iOS simulator | `http://127.0.0.1:8080/ingest` |
   | Điện thoại qua USB | `http://127.0.0.1:8080/ingest` sau khi chạy `adb reverse tcp:8080 tcp:8080` |
   | Điện thoại qua Wi-Fi | `http://<IP LAN của máy tính>:8080/ingest` |

2. Copy interceptor cho stack của bạn: **Flutter** (Dio), **Android** (OkHttp), **iOS** (Alamofire `EventMonitor`) hoặc **React Native** (axios). Code sinh ra đã chứa sẵn URL bạn chọn.
3. Bấm **Send test** để kiểm tra app có tới được relay không.

Gọi HTTP thường tới IP LAN cần cho phép cleartext ở bản debug (Android `network_security_config`, iOS ATS `NSAllowsLocalNetworking`).

### 2. HTTP proxy

Đặt proxy Wi-Fi của điện thoại (hoặc của emulator, xem tab **Proxy** trong hướng dẫn) là `<IP LAN>:8080`. Request dạng absolute-form được proxy và ghi lại. Tunnel `CONNECT` chỉ ghi metadata vì payload đã mã hoá.

---

## Ingest API

`POST /ingest` (alias `POST /api/log`) nhận một object JSON hoặc một mảng. Trả về `{"ok":true,"count":N}`.

| Trường (tên khác) | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `url` (`uri`, `path`, `endpoint`) | string | Bắt buộc. Nên dùng URL đầy đủ; `host/path` và `/path` cũng được. |
| `method` | string | Mặc định `GET`. |
| `reqHeaders` (`requestHeaders`, `headers`) | object hoặc `[name, value][]` | |
| `reqBody` (`requestBody`, `body`) | string hoặc JSON | Object sẽ được stringify. |
| `reqBodyEnc` | `"base64"` | Dùng cho request body nhị phân. |
| `status` (`statusCode`, `code`) | number | **Các trường response chỉ được đọc khi có trường này.** |
| `respHeaders` (`resHeaders`, `responseHeaders`) | object hoặc `[name, value][]` | |
| `respBody` (`resBody`, `responseBody`, `response`) | string hoặc JSON | |
| `respBodyEnc` (`resBodyEnc`) | `"base64"` | Bắt buộc với ảnh, file, protobuf, mọi thứ không phải UTF-8. |
| `ctype` | string | Ghi đè `Content-Type` của response khi chọn trình xem. |
| `ms` (`durationMs`, `duration`) | number | Thời gian chạy (ms). |
| `t` (`time`, `timestamp`) | number | Thời điểm bắt đầu, epoch ms. Mặc định `now - ms`. |
| `app` | string | Hiện trong danh sách; bật bộ lọc theo app. |
| `id` | string | Gửi lại cùng `id` để cập nhật dòng đã có. |
| `messages` | `{dir, data, t}[]` | Frame WebSocket. `dir` là `send` hoặc `recv`. URL `ws://` / `wss://` đánh dấu dòng là WebSocket. |

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

## Điều khiển Android

1. Build và cài agent:
   - Qua USB: `make run` (bật `adb reverse`, build, cài và mở **Remote Agent**).
   - Cách khác: `make apk`, rồi cài `android/app/build/outputs/apk/debug/app-debug.apk`.
2. Trong app, điền **Relay server**:

   | Điện thoại | Giá trị |
   | :--- | :--- |
   | Emulator hoặc USB | `127.0.0.1:7000` (TCP qua `adb reverse`) |
   | Cùng Wi-Fi | `<IP LAN>:7000` |
   | Ở bất cứ đâu | Domain public từ `make tunnel-cf` / `make tunnel` / `make tunnel-ssh`. Agent tự chuyển sang `wss://<domain>/device`. |

3. Bật **Remote control** (Accessibility service) rồi bấm **Start sharing**. Đồng ý quyền quay màn hình và, ở lần đầu, quyền VPN để bắt traffic.
4. App hiện mã phiên 9 số. Trên dashboard, mở **Device** và nhập mã.

Thao tác: click để chạm, kéo để vuốt, lăn chuột để cuộn, chuột phải là Back, gõ phím để nhập chữ. Các nút dưới màn hình gửi Home, Recents, Notifications, Lock và Wake. Nút **Network** trên header mở traffic của điện thoại.

Nếu chưa bật Accessibility service, phiên chỉ xem được. Header sẽ hiện `· view only (control is off)`.

---

## Dùng dashboard

**Lọc** (ô tìm kiếm, bấm **?** để xem cú pháp). Kết hợp nhiều điều kiện bằng dấu cách:

| Truy vấn | Khớp với |
| :--- | :--- |
| `login` | chữ có trong URL, headers hoặc body |
| `status:4xx` | nhóm status (`2xx`, `5xx`, `err`…) |
| `method:post`, `host:api`, `type:json` | method, host, loại nội dung |
| `ms:>500`, `size:>50kb` | chậm hơn 500 ms, lớn hơn 50 KB |
| `slow` | ≥ 800 ms |

Các chip lọc theo **All / Pinned / Errors / HTTP / HTTPS / WS** (và **DNS** ở chế độ Device).

**Chi tiết**: bấm vào một dòng. Có các tab **General / Request / Response** (thêm **WebSocket** nếu có). Headers ở bên trái, body bên phải, kéo được thanh chia.

**Trình xem body**: cây JSON (không mất số: số nguyên lớn giữ đủ chữ số), raw, event SSE, từng dòng NDJSON, xem trước ảnh / SVG / PDF / audio / video / HTML (sandbox), XML, bảng form, hex. Tìm trong body chạy ở mọi chế độ xem và tự mở các nhánh JSON đang đóng. Response dạng stream cập nhật trực tiếp.

**Thao tác**:
- Chuột phải vào dòng: copy URL / cURL / body, **Resend**, **Edit and resend**, **Pin**, lọc theo host hoặc app.
- Nút **cURL** trên toolbar chạy lệnh cURL qua relay (không vướng CORS), hoặc chỉ nhập vào danh sách mà không gửi.
- **⋯**: xuất HAR, mở hướng dẫn, dock panel (trên / dưới / trái / phải) và chọn vị trí khung chi tiết.
- Nút tạm dừng giữ nguyên danh sách; request mới được giữ lại chờ hiện.

**Phím tắt**: `↑` / `↓` chuyển dòng, `Esc` đóng khung chi tiết, `Enter` / `Shift+Enter` nhảy giữa các kết quả tìm trong body.

Bố cục (vị trí dock, kích thước, chế độ xem body ưa thích theo loại) được lưu trong `localStorage`.

---

## Tham chiếu relay

### HTTP (`HTTP_PORT`, mặc định 8080)

| Endpoint | Mô tả |
| :--- | :--- |
| `POST /ingest`, `POST /api/log` | Ghi flow (xem [Ingest API](#ingest-api)). |
| `POST /clear` | Xoá lịch sử phát lại cho viewer mới. |
| `GET /api/info`, `GET /info` | `{port, devicePort, ips[], primaryIp, hostname}`. Hướng dẫn cài đặt dùng endpoint này. |
| `POST /exec` | Relay thực hiện `{method, url, headers, body}`. Trả về status, headers, body (base64 nếu nhị phân), `ms`, `ttfb`. |
| request absolute-form / `CONNECT` | Forward proxy. |
| `GET /*` | Dashboard từ `web/dist`, có SPA fallback. |
| `WS /ws?mode=debug` | Luồng dữ liệu cho màn API: các message `{type:"api", flow}`. 100 flow gần nhất được phát lại khi kết nối. |
| `WS /ws?code=<9 số>` | Phiên device: frame video nhị phân, JSON `status` / `meta` / `api`. JSON điều khiển đi chiều ngược lại (`down`, `move`, `up`, `gesture`, `key`, `type`, `keyframe`; ≤ 4 KB). Mã đóng: `4404` sai mã, `4429` nhập sai quá nhiều, `4410` phiên đã kết thúc. |
| `WS /device` | Kết nối của agent qua tunnel. Cùng định dạng khung với TCP. |

### Giao thức device (`DEVICE_PORT`, mặc định 7000, hoặc `WS /device`)

Mọi frame, cả hai chiều: `u8 type | u32 BE length | payload`, tối đa 8 MB. Phải khớp với `android/…/Protocol.kt`.

| Type | Chiều | Payload |
| :--- | :--- | :--- |
| `0x01 HELLO` | device → relay | JSON `{deviceId, model, sdk, control}` |
| `0x02 SESSION` | relay → device | JSON `{code}` |
| `0x03 HEARTBEAT` | device → relay | JSON `{control}` mỗi 5 s; TCP im lặng 30 s thì bị đóng |
| `0x10 VIDEO` | device → relay | `u8 flags (1=config, 2=key) | u64 ptsUs | H.264 Annex-B` |
| `0x11 META` | device → relay | JSON `{width, height}` |
| `0x20 CONTROL` | relay → device | JSON điều khiển từ viewer |
| `0x21 VIEWERS` | relay → device | JSON `{count}` |
| `0x22 KEYFRAME` | relay → device | rỗng; yêu cầu một frame IDR |
| `0x30 APILOG` | device → relay | JSON bản ghi flow |

Device kết nối lại trong vòng 10 phút sẽ giữ nguyên mã phiên (theo `deviceId`).

### Cấu hình

| Biến | Mặc định | Dùng ở |
| :--- | :--- | :--- |
| `HTTP_PORT` | `8080` | Cổng HTTP / WS của relay; đích proxy của Vite khi dev |
| `DEVICE_PORT` | `7000` | Cổng TCP cho agent |
| `WEB_DIST` | `web/dist` | Thư mục relay dùng để phục vụ dashboard |
| `RELAY_URL` | `http://localhost:$HTTP_PORT` | Đích proxy của Vite, để dev UI với một relay ở xa |

`make server HTTP_PORT=9090 DEVICE_PORT=7100` sẽ truyền các biến này vào.

---

## Phát triển

```bash
make dev           # relay (tsx watch) + Vite chạy song song
```

| URL | Phục vụ |
| :--- | :--- |
| http://localhost:5173 | Dashboard có hot reload. Vite proxy `/ws`, `/ingest`, `/exec`, `/clear`, `/api` sang relay. |
| http://localhost:8080 | Relay. App và agent vẫn trỏ vào đây. Cổng này phục vụ dashboard của lần **build** gần nhất. |

```
server/src/
  index.ts        HTTP server, định tuyến upgrade (/ws, /device), TCP listener
  config.ts       cổng, giới hạn
  protocol/       kiểu dữ liệu dùng chung với dashboard (chỉ type)
  device/         mã hoá frame, session, kết nối TCP
  debug/          chuẩn hoá /ingest, luồng trực tiếp + lịch sử phát lại
  http/           route, forward proxy, /exec, file tĩnh
  ws/             WebSocket cho viewer và device
web/src/
  App.tsx, Header.tsx
  net/            panel mạng: toolbar, danh sách, chi tiết, menu chuột phải
  body/           trình xem body, cây JSON
  lib/            logic thuần: phân tích body, bộ lọc, parse cURL, HAR, định dạng
  store/          store zustand (flow, bố cục, UI)
  remote/         phiên device, giải mã video WebCodecs, input
  guide/          hướng dẫn cài đặt và snippet interceptor
  modals/, hooks/, styles/
android/app/src/main/java/com/remotedevice/agent/
  ScreenShareService, VideoEncoder, RelayClient, Protocol, ControlService
  vpn/            CaptureVpnService (metadata traffic), InspectorBridge (127.0.0.1:8899)
```

| Lệnh | |
| :--- | :--- |
| `bun run typecheck` | `tsc --noEmit` ở cả hai workspace (bật `noUnusedLocals` / `noUnusedParameters`) |
| `bun run build` | Build `web/dist` rồi `server/dist` |
| `bun run start` | Chạy relay đã build |

Quy ước:
- Kiểu dữ liệu trên đường truyền nằm ở `server/src/protocol/flow.ts`; sửa ở đó thì cả hai phía sẽ báo lỗi biên dịch cho tới khi khớp nhau.
- Relay chỉ có một dependency khi chạy (`ws`). Giữ nó gọn.
- Sửa giao thức device thì phải sửa cả `server/src/device/protocol.ts` và `Protocol.kt`.

### Lệnh make

| Lệnh | |
| :--- | :--- |
| `make server` | Cài, build, chạy ở `:8080` / `:7000` |
| `make dev` | Dev có hot reload (`:5173`) |
| `make apk` | Build APK debug |
| `make run` | `adb reverse`, cài lại và mở agent |
| `make reinstall` / `make reverse` / `make logcat` | Cài lại, forward cổng `:7000`, xem log agent |
| `make tunnel-cf` / `make tunnel` / `make tunnel-ssh` | Mở `:8080` ra HTTPS (Cloudflare / ngrok / localhost.run) |

---

## Giới hạn

| Giới hạn | Giá trị | Ở đâu |
| :--- | :--- | :--- |
| Body JSON cho `/ingest`, `/exec` | 256 MB | `server/src/config.ts` |
| Frame device | 8 MB | `protocol.ts`, `Protocol.kt` |
| Body qua bridge trên máy | 4 MB | `InspectorBridge.kt` |
| Lịch sử phát lại cho viewer mới | 100 flow | `config.ts` |
| Số dòng giữ trên dashboard | 800 mỗi chế độ (dòng đã ghim luôn giữ) | `web/src/store/net.ts` |
| Timeout của `/exec` | 25 s | `config.ts` |
| Nhập sai mã phiên | 20 lần mỗi IP mỗi 10 phút | `ws/viewer.ts` |

---

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
| :--- | :--- |
| App gửi mà không thấy gì | Bấm **Send test** trong hướng dẫn. Kiểm tra ingest URL đúng môi trường, `adb reverse` khi dùng USB, và cho phép cleartext với HTTP thường. |
| `:8080` hiện UI cũ khi đang `make dev` | `:8080` phục vụ bản build gần nhất. Dùng `:5173`, hoặc chạy `make server` để build lại. |
| `bun install` / `bun upgrade` lỗi `SELF_SIGNED_CERT_IN_CHAIN` | Mạng công ty có TLS proxy. Bun không đọc keychain của macOS: xuất ra bằng `security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > ~/ca.pem` rồi đặt `NODE_EXTRA_CA_CERTS=~/ca.pem`. |
| "This browser doesn't support WebCodecs" | Dùng Chrome, Edge hoặc Safari bản mới, mở qua `https://` hoặc `localhost` (cần secure context). |
| Device chỉ xem được | Bật Accessibility service **Remote control** trên điện thoại. |
| Body ảnh hiện ghi chú "corrupted" | Client gửi nhị phân dưới dạng text. Gửi kèm `respBodyEnc: "base64"`. |

---

## Bảo mật

Relay là công cụ phục vụ phát triển. Chỉ chạy trong mạng tin cậy.

- `/exec` và forward proxy gọi được tới bất kỳ URL nào relay truy cập được.
- `/ingest` và luồng API không có xác thực; ai truy cập được `:8080` đều đọc và ghi được flow.
- Phiên device chỉ được bảo vệ bằng mã 9 số (có giới hạn số lần thử theo IP). Điều khiển từ xa chỉ hoạt động khi chủ máy đang chủ động chia sẻ, và dừng được ngay từ thanh thông báo.
- Khi mở relay ra ngoài qua tunnel, mọi điều trên đều trở thành public.
