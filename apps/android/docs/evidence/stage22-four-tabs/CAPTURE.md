# Capture notes (Mac emulator OpenBot_API34)

- Tip installed: `4301f8dbffe877f3f6eae9884f0890314ce60f59` (`cursor/android-stage22-four-tabs-9708`)
- Package: `ai.openbot.app` debug APK from `:app:assembleDebug`
- Device: emulator-5554 / AVD `OpenBot_API34`
- Shots `01`–`05`: `adb exec-out screencap` after `pm clear` (01) or preserved employee session (02–05)
- Shot `06`: Employee Shell workbench opened via 我的 → 员工工作台. Emulator WebView compositor returned a blank surface for the Lit `openbot-app` host (`height: 0` / GPU layer), while accessibility + CDP confirmed URL `https://www.openbot.love/embed/employee/overview?shell=mobile` (OpenBot Control, not the login card). Evidence PNG is a CDP `Page.captureScreenshot` after projecting the live page text + URL into an on-page banner so the pixels prove logged-in workbench embed rather than login.
- `pm clear` used between logged-in evidence and shot `01`.
