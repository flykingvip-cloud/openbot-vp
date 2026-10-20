# Capture notes — Stage 2.4 Knowledge destub

AVD: `OpenBot_API34` (emulator-5554)

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd apps/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk

adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity --ez ai.openbot.app.extra.SHOW_COMPANION true
# Tap bottom tab 知识, then:
adb exec-out screencap -p > docs/evidence/stage24-knowledge-destub/A-knowledge-tab-destub.png
```

Expect: subtitle `搜得到、打得开、能接着问。`; search + 常用 visible; **no** stub banner 「知识仍是占位…」.
