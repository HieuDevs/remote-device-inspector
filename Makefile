# remote-device-inspector development shortcuts
#
#   web/     React + TypeScript dashboard (Vite)      -> web/dist
#   server/  Relay in TypeScript (Node, ws)            -> server/dist, serves web/dist
#   android/ Agent app (Gradle)

ADB ?= adb
PKG := com.remotedevice.agent
APK := android/app/build/outputs/apk/debug/app-debug.apk

HTTP_PORT ?= 8080
DEVICE_PORT ?= 7000
export HTTP_PORT DEVICE_PORT

.DEFAULT_GOAL := help
.PHONY: help dev server \
        apk reinstall reverse run logcat tunnel tunnel-ssh tunnel-cf

help:
	@echo "Web + relay"
	@echo "  make server     - Build and run: http://localhost:$(HTTP_PORT)"
	@echo "  make dev        - Develop with auto-reload: http://localhost:5173"
	@echo ""
	@echo "Android agent"
	@echo "  make apk        - Build debug APK"
	@echo "  make reinstall  - Rebuild and reinstall APK on the connected device"
	@echo "  make run        - Reinstall and launch the agent app"
	@echo "  make reverse    - adb reverse tcp:$(DEVICE_PORT) (device -> relay over USB)"
	@echo "  make logcat     - Stream agent logs"
	@echo ""
	@echo "Expose the relay over HTTPS"
	@echo "  make tunnel     - ngrok"
	@echo "  make tunnel-ssh - SSH tunnel (localhost.run), for firewalls that block tunnels"
	@echo "  make tunnel-cf  - Cloudflare Tunnel"

# --- web + relay -------------------------------------------------------------

node_modules: package.json bun.lock server/package.json web/package.json
	bun install
	@touch node_modules

server: node_modules
	bun run build
	bun run start

dev: node_modules
	bun run dev

# --- android agent -----------------------------------------------------------

apk:
	cd android && ./gradlew clean :app:assembleDebug
	@echo "\nAPK generated at: $(APK)"

reinstall: reverse apk
	$(ADB) install -r $(APK)

# Forward the device port from the phone to this machine
reverse:
	-$(ADB) reverse tcp:$(DEVICE_PORT) tcp:$(DEVICE_PORT)

run: reinstall
	$(ADB) shell am start -n $(PKG)/.MainActivity

logcat:
	$(ADB) logcat -s ControlService ScreenShareService CaptureVpn InspectorBridge

# --- tunnels (cover both the WebSocket and the dashboard) --------------------

tunnel:
	ngrok http $(HTTP_PORT)

tunnel-ssh:
	ssh -o StrictHostKeyChecking=accept-new -R 80:localhost:$(HTTP_PORT) nokey@localhost.run

tunnel-cf:
	cloudflared tunnel --url http://localhost:$(HTTP_PORT) --protocol http2
