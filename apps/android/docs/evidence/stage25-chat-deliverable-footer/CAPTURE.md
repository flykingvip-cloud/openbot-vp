# Capture notes — Stage 2.5 chat deliverable footer

AVD: `OpenBot_API34` (emulator-5554)

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd apps/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk

# B — table + footer + 打开成果 (url fixture)
adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.SHOW_COMPANION true \
  --ez ai.openbot.app.extra.DEMO_DELIVERABLE true
adb exec-out screencap -p > docs/evidence/stage25-chat-deliverable-footer/B-avd-table-footer.png

# C — tap 打开成果 → Custom Tabs / Chrome (example.com)
# (tap button bounds from uiautomator; first Chrome FRE: Use without an account)
adb shell input tap 811 1528
# after FRE dismiss:
adb exec-out screencap -p > docs/evidence/stage25-chat-deliverable-footer/C-tap-open-url.png

# C-alt — file-only disabled CTA
adb shell am force-stop ai.openbot.app
adb shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.SHOW_COMPANION true \
  --ez ai.openbot.app.extra.DEMO_DELIVERABLE_FILE true
adb exec-out screencap -p > docs/evidence/stage25-chat-deliverable-footer/C-alt-disabled-file.png
```

## DEMO disclosure

| Extra | Role |
| --- | --- |
| `ai.openbot.app.extra.DEMO_DELIVERABLE` | Debug-only seed: IMG_1711-style markdown table + tagged envelope `url=https://example.com/openbot-demo-deliverable`. |
| `ai.openbot.app.extra.DEMO_DELIVERABLE_FILE` | Debug-only seed: located `file=output/speech-outline.md` only → disabled CTA + unavailable copy. |

Release builds ignore both extras. Production footers only appear for assistant text that contains a declared located `<<DELIVERABLE>>` envelope. No new gateway RPC.
