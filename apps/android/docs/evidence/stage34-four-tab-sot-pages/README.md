# Stage 3.4 — Four-tab SoT pages (incl. secondary)

Stacked on `app/stage33-composer-web-parity` (PR #279). Visual/IA align Compose four-tab +
secondary sheets/pages to HTML SoT (`Desktop/openbot-four-tab-frontend-preview/index.html`).
Logic still reuses Web flows (no new systems).

## Per-surface gap → after

| Surface | Gap (before / stage33) | After (this PR) |
| --- | --- | --- |
| **对话 · Agent strip** | Pink selected chips; TO: stage header between strip & messages | HTML `.agent-chip`: 44dp icon tile + name under; active blue border; edge-to-edge strip + hairline; **TO: header removed** (HTML has none) |
| **对话 · Messages** | USER/ASSISTANT chrome; user soft-blue bordered bubble; 90% width / 12dp radius | No role chrome; user solid `--blue` white text; assistant white + `#EEF0F3` border; 14dp / ~78% width |
| **任务 · List** | Separate per-row cards; orange「待接受」; Accepted demo | Single `.task-card` with row dividers; `.badge.wait` blue / `.run` green; demo #2 →「进行中」 |
| **任务 · Detail** | Close-X header; vertical meta; optional single action | Back circle +「任务详情」; horizontal 截止/来源/组织; desc text; always 接受+完成 (enabled via Web canAccept/canComplete) |
| **任务 · Create** | Reduced cron sheet (kept) | Unchanged reduced `cron.add` (intentional vs HTML multi-step wizard) |
| **知识 · Tree** | Favorites long-press hint noise | Tree chrome kept; section rails 收藏/个人/团队/企业 |
| **知识 · Fullscreen** | Left rail (collapsed 28dp / expanded 200dp) | **No left rail** — HTML lock「统一白底正文，无左侧窄轨」; stub doc renders 1./2. sections |
| **我的 · Hub** | Separate nav cards per row; sheet titles「账号安全」「工作台偏好」 | HTML `.group` single card + dividers (账号与安全 / 更多 / 本机能力); sheet titles「安全」「偏好」 |
| **我的 · Secondary** | Account / Auth / Device sheets present | Kept Web-backed sheets; grouped hub entry |

## Intentional remaining diffs

| Item | Why |
| --- | --- |
| Agent strip drag-reorder +「+」add chip | Production Web does not persist strip order; create flows open via 我的→更多 |
| Mic → in-composer voice bubble | Production Web chat mic disabled; TalkMode path via mic → VoiceTabScreen |
| Full cron create wizard / 任务成果预览 | Web-only multi-step; phone keeps reduced `cron.add` |
| Knowledge create/rename/⋯ menus | Would invent phone-only write UX |
| Me identity OAuth/WeChat wizards | Open Employee Shell / Web `#operational-identity` |
| Bottom tab rounded chrome | Material companion shell; labels/icons already SoT-aligned |
| Offline DEMO banners | Debug-only evidence seeds when gateway offline |

## Build / emulator

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
cd apps/android
./gradlew :app:assembleDebug
adb -s emulator-5554 install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk
adb -s emulator-5554 shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.DEMO_TASKS true \
  --ez ai.openbot.app.extra.DEMO_KNOWLEDGE true \
  --ez ai.openbot.app.extra.DEMO_ME true \
  --ez ai.openbot.app.extra.DEMO_AGENT_STRIP true \
  --ez ai.openbot.app.extra.DEMO_DELIVERABLE true
```

- Emulator: `OpenBot_API34` / `emulator-5554`
- Package: `ai.openbot.app` `1.0.0`
- Installed: 2026-10-02 Asia/Shanghai

## Screenshots

- `before/` — stage33 live caps
- `after/01-chat.png` — strip + message presentation + composer
- `after/02-tasks.png` / `02b-task-detail.png` / `02c-task-create.png`
- `after/03-knowledge.png` / `03b-knowledge-fullscreen.png` (no left rail)
- `after/04-me.png` / `04b-me-device.png` / `04c-me-more.png` / `04d-me-account-info.png` / `04e-me-auth.png`
