# Stage 3.2 — Four-tab SoT visual alignment

Stacked on `app/stage31-four-tab-gap-close`. Closes **visual/interaction** gaps vs HTML SoT
(`Desktop/openbot-four-tab-frontend-preview/index.html`) without inventing non-Web flows.

## Before → after (per tab)

| Tab | Gap (before) | After |
| --- | --- | --- |
| **对话** | Composer send control 40dp; accent `#1D5DD8` | Send 32dp (SoT `.send`); accent `--blue` `#2F6BFF` / soft `#E8F0FF`; bottom icons tint-only |
| **任务** | Subtitle “Web 同款 API”; Material white-pill segment; no inbox section label | Title-only「任务」; SoT blue-fill `.seg`;「轻量工作队列」above inbox rows; FAB kept |
| **知识** | Offline empty prose only; Search icon in bottom bar | Offline section rails 收藏/个人/团队/企业; bottom「知识」= MenuBook (📖) |
| **我的** | Subtitle; disconnect banner on 个人设置;「员工工作台」under Account; white-pill segment | Title-only「我的」; banner only on 本机与连接; workbench row under 更多; SoT blue-fill 3-seg |

## Intentional remaining diffs

| Item | Why |
| --- | --- |
| Agent strip drag-reorder | Production Web does not persist strip order (stage31) |
| Mic → voice bubble | Production Web chat mic disabled; TalkMode under 我的→本机能力 |
| Full cron wizard / task result preview | Web-only multi-step; phone keeps reduced `cron.add` |
| Knowledge create/rename/⋯ menus | Would invent phone-only write UX |
| Me identity add OAuth/WeChat wizards | Open Employee Shell / Web `#operational-identity` |
| Bottom tab chrome (rounded top bar) | Material companion shell; labels/icons aligned to SoT |

## Build / emulator

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
./gradlew :app:assembleDebug
adb -s emulator-5554 install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk
adb -s emulator-5554 shell am start -n ai.openbot.app/.MainActivity \
  --ez ai.openbot.app.extra.DEMO_TASKS true \
  --ez ai.openbot.app.extra.DEMO_KNOWLEDGE true \
  --ez ai.openbot.app.extra.DEMO_ME true
```

- Emulator: `OpenBot_API34` / `emulator-5554`
- Package: `ai.openbot.app` versionName `1.0.0`
- APK: `apps/android/app/build/outputs/apk/debug/openbot-1.0.0-debug.apk`
- Installed: 2026-10-02 17:28 Asia/Shanghai (composer capsule gap follow-up)

## Screenshots

- `before-*.png` — pre-change live caps (gateway offline)
- `after-0{1,2,3}-*.png` — chat / tasks(+demo) / knowledge(+demo)
- `after-04-me.png` / `after-04b-me-device.png` / `after-04c-me-more.png`
- `after-composer-capsule-gap.png` — chat composer after capsule↔pill gap = HTML SoT 8px (was parent spacedBy 10.dp + 48.dp min-touch inflation ≈19.8.dp visual)
