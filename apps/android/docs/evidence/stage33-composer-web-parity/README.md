# Stage 3.3 — Composer Web parity (attach / voice / send→stop)

Stacked on Stage 3.2 (`app/stage32-four-tab-sot-visual` / PR #278).

## Web files mirrored

| Feature | Web source | Android reuse |
| --- | --- | --- |
| Attach accept + size | `ui/src/ui/views/chat.ts` (`CHAT_ATTACHMENT_ACCEPT`, 10/25MB) | `ChatAttachments.kt` |
| Attach transport | `ui/src/ui/controllers/chat.ts` `chat.send` `attachments[]` (`type`/`mimeType`/`fileName`/`content`) | `ChatController.sendMessage` |
| Attach progress copy | `formatAttachmentStatus` in `views/chat.ts` | capsule「上传中 / 已添加，待发送 / 失败」 |
| Abort | `app-chat.ts` `handleAbortChat` → `chat.abort` | composer stop → `viewModel.abortChat()` → `chat.abort` |
| Voice | Web composer mic **disabled** (no `@click`); Talk/voice is separate | mic opens same `VoiceTabScreen` (MicCapture → `chat.send` + TalkMode TTS) |

## Before → after

| Feature | Before | After |
| --- | --- | --- |
| **附件添加** | `image/*` only; no reading capsule | Web MIME set + size caps; reading/ready/failed capsules; remove; send with message via `chat.send` |
| **语音输入** | Dead affordance (`onMicClick = null`) | Mic → Voice overlay = 我的→语音 path (not a parallel STT stack) |
| **发送后暂停** | Already stop square + `chat.abort` (Stage 2.7) | Verified unchanged; busy → white stop square → `chat.abort` |

## Intentional remaining

- Web still has no chat-composer voice-bubble recording path; Android does not invent one.
- Asset version / duplicate-hash reuse store from Web chat.ts is desktop-only (not ported).

## Verify

```bash
cd apps/android
./gradlew :app:compileDebugKotlin :app:testDebugUnitTest \
  --tests ai.openbot.app.ui.chat.ChatAttachmentsTest
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
```

## Evidence (emulator-5554)

- `after-composer.png` — composer shows 添加附件 / 语音输入 / 发送 (mic enabled)
- `after-mic-voice-overlay.png` — mic opens VoiceTabScreen「语音对话」(TalkMode/MicCapture path)

