# Capture notes — Stage 2.6 chat chrome cleanup

AVD: `OpenBot_API34` (emulator-5554)

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || echo /usr/local/Cellar/openjdk@17/17.0.17/libexec/openjdk.jdk/Contents/Home)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd apps/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk

# A — full chat tab chrome clean (strip + 打开成果 retained)
adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.SHOW_COMPANION true \
  --ez ai.openbot.app.extra.DEMO_DELIVERABLE true
adb exec-out screencap -p > docs/evidence/stage26-chat-chrome-cleanup/A-chat-tab-chrome-clean.png

# B — empty hint + pull-to-refresh reconnect frame (offline)
adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.SHOW_COMPANION true
adb exec-out screencap -p > docs/evidence/stage26-chat-chrome-cleanup/B-empty-pull-hint.png
# Swipe down on message list to show Material3 PullToRefresh indicator
adb shell input swipe 540 700 540 1400 600
adb exec-out screencap -p > docs/evidence/stage26-chat-chrome-cleanup/B-pull-to-refresh-frame.png
```

## DEMO disclosure

| Extra | Role |
| --- | --- |
| `ai.openbot.app.extra.SHOW_COMPANION` | Skip onboarding into four-tab companion shell (existing debug path). |
| `ai.openbot.app.extra.DEMO_DELIVERABLE` | Debug-only seed for Evidence A: table + 「打开成果」 without gateway (stage 2.5). |

Release builds ignore DEMO extras. Pull-to-reconnect uses real `refreshGatewayConnection()` / trusted endpoint resolve; offline AVD cannot complete a live gateway handshake — indicator + hint are the disclosed DEMO evidence for B.

## Verify

- UI dump A: no `Thinking` / `Abort` / `Refresh` / `离线` chip / `对话错误`; has `打开成果`, strip, composer.
- Empty hint: `网关未连接。下拉可尝试重新连接。` (not 「请先在我的→连接网关」).
- Unit: `ai.openbot.app.gateway.GatewayReconnectTest`
- `:app:assembleDebug` OK
