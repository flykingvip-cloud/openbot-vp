# Capture notes — Stage 2.3

AVD: `OpenBot_API34`

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd apps/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk

# A + C — steward only, full 对话 Tab frame
adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity --ez ai.openbot.app.extra.SHOW_COMPANION true
adb exec-out screencap -p > docs/evidence/stage23-chat-agent-strip/A-strip-to-daibai.png
adb exec-out screencap -p > docs/evidence/stage23-chat-agent-strip/C-chat-tab-full.png

# B — switch assistant (debug demo roster when offline)
adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.SHOW_COMPANION true \
  --ez ai.openbot.app.extra.DEMO_AGENT_STRIP true
# Tap 市场助手 chip, then:
adb exec-out screencap -p > docs/evidence/stage23-chat-agent-strip/B-strip-select-other.png
```

`DEMO_AGENT_STRIP` is debug-only evidence seeding (大白管家 + 市场助手). Release builds ignore it; production roster is `agents.list`.
