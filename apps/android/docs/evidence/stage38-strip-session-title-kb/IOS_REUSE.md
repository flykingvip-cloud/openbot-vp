# iOS reuse plan — Android four-tab design system (Stage 3.8 tip)

**Date:** 2026-10-02 (Asia/Shanghai)  
**Android tip:** `app/stage38-strip-session-title-kb` @ `4bbeeb9cb` (PR #285, stacked on #272–#284)  
**Canonical checkout:** `/Users/daniel/AI VP/openbot-app-stage38-strip-session-title-kb`  
**Do not merge to `main` unless explicitly asked.**

---

## 1. Sources of truth (SoT)

| Layer | Path / artifact | Role |
| --- | --- | --- |
| **Visual + IA SoT** | `/Users/daniel/AI VP/openbot-four-tab-frontend-preview/` (synced from Desktop) | Interactive HTML phone frame; IMPLEMENT checklist in `README.md` / `SUMMARY.zh-CN.md` |
| **Android implementation** | `apps/android/…` on stage38 tip | Native Compose reference for parity |
| **Tokens** | `apps/android/app/src/main/java/ai/openbot/app/ui/MobileUiTokens.kt` | Colors, type scale, gutters, gradient |
| **Page chrome** | `MobilePageComponents.kt` (`MobilePageHeader` ≈ HTML `.module-title`) | Module titles 任务 / 知识 / 我的 |
| **Four-tab shell** | `PostOnboardingTabs.kt` | Bottom tabbar 对话 / 任务 / 知识 / 我的 |
| **Web employee UI** | `ui/src/ui/ports/employee/…` | Behavioral SoT for Me hub, tasks center, knowledge, bot workspace |
| **Shared Swift kit (today)** | `apps/shared/OpenBotKit` (`OpenBotChatUI`, `OpenBotProtocol`) | Chat VM/transport/markdown — **not** yet four-tab shell |
| **iOS app (today)** | `apps/ios/Sources/RootTabs.swift` | Legacy tabs: Screen / Voice / Settings — **replace IA**, keep capability modules |

**Rule:** Preview HTML may contain **演示超集**. Android + iOS only implement the **IMPLEMENT** rows (see preview README). Do not treat preview-only demos as required.

---

## 2. Module map（四 Tab）

| Tab | Android (Compose) | Web / Gateway SoT | iOS target (SwiftUI) |
| --- | --- | --- | --- |
| **对话** | `ChatSheet` / `ui/chat/*` — Agent Strip, knowledge capsule, attach capsules, composer send→stop, deliverable footer | `agents.list` roster; `chat.send` / `chat.abort`; `switchChatSession`; `context.scope.sources.catalog` → `knowledge.base.*` | New `ChatTab` hosting OpenBotKit `ChatView` + strip + composer chrome; mic → existing Voice/TalkMode path (not in-bubble STT) |
| **任务** | `MobileTasksScreen` + `TasksWebModels` — 定时任务 \| 待我处理 | `cron.list` / `cron.add` / `cron.update` / `cron.run`; `task.list` / `task.accept` / `task.complete` | `TasksTab`: segmented control + lists + accept/complete; **no** task-result “打开全文” card (preview 超集) |
| **知识** | `MobileKnowledgeScreen` + `KnowledgeBrowserModels` — title「我的知识库」then search, tree, fullscreen doc | `knowledge.search`; `knowledge.document.preview`; tree from vault/knowledge APIs | `KnowledgeTab`: header + search below; tree; fullscreen reader (no left rail) |
| **我的** | `MeTabScreen` + `MeHubModels` — Hub 个人设置｜本机与连接｜更多; tertiary sheets keep「我的」kicker + tabbar | `agents.list`; `robot.workspace.get` / `updateIdentity`; `collaboration.spaces.*`; `device.pair.list`; `user-operational-identity.list`; `enterprise-operational-identity.access.list-for-seat`; reduced `agents.create` / `workspaces.create` | `MeTab`: three hub segments; Connect/Settings reuse; bot workspace tabs; create bots/groups under **更多** (not strip「+」) |

Legacy iOS Screen / Voice / Settings capabilities map under **我的 → 本机与连接** (and Voice entry from chat mic / Me), not as root tabs.

---

## 3. Web / Gateway APIs to share (parity with Android)

Keep **one RPC contract** via existing gateway clients (`OpenBotProtocol` / iOS Gateway session), same method names as Android:

**Chat**
- `chat.send`, `chat.abort`
- Session switch (client-side sessionKey + history load; Android `switchChatSession`)
- `agents.list` (strip roster; steward first)
- Context scope: `context.scope.sources.catalog` → fallback `knowledge.base.list` + `knowledge.base.sources.list`

**Tasks**
- `task.list`, `task.accept`, `task.complete`
- `cron.list`, `cron.add`, `cron.update`, `cron.run`

**Knowledge**
- `knowledge.search`, `knowledge.document.preview`
- Vault sync (optional later): `knowledge.vault-sync.*`

**Me**
- `agents.list`, `agents.create` (reduced; Web wizard on failure)
- `robot.workspace.get`, `robot.workspace.updateIdentity` (+ related workspace tab RPCs)
- `collaboration.spaces.list`, `collaboration.spaces.members.update`
- `device.pair.list`
- `user-operational-identity.list`, `enterprise-operational-identity.access.list-for-seat`
- `employee-model-access.summary` (placeholder OK)
- `workspaces.create`, `robots.bind-workspace` (create-bot path)

Do **not** invent iOS-only endpoints; prefer Web employee controllers as behavioral SoT.

---

## 4. Tokens & components to port (Compose → SwiftUI)

### Design tokens → `OpenBotMobileTokens` (new, shared or iOS-local)

From `MobileUiTokens.kt` (mirror HTML CSS vars where present):

| Token | Value | Notes |
| --- | --- | --- |
| page gutter / vertical | 20 / 16 pt | `mobilePageGutter` / `mobilePageVertical` |
| background gradient | `#FFF → #F7F8FA → #EFF1F5` | vertical |
| surface / strong | `#F6F7FA` / `#ECEEF3` | |
| border / strong | `#E5E7EC` / `#D6DAE2` | |
| text / secondary / tertiary | `#17181C` / `#5D6472` / `#99A0AE` | |
| accent / soft | `#2F6BFF` / `#E8F0FF` | SoT `--blue` |
| success / warning / danger (+ soft) | as Android | |
| type | Manrope 400–700; title1 24sb, title2 20sb, headline 16sb, body 15m, callout 14m, caption1/2 12/11 | Bundle Manrope or SF Pro fallback with same sizes/weights |
| module title | Bold title1 ≈ HTML `.module-title` 26/700 | Note: Android uses `MobilePageHeader` |

### Components to port (behavioral + visual)

| Android | iOS SwiftUI sketch | Share? |
| --- | --- | --- |
| `PostOnboardingTabs` | New `EmployeeRootTabs` | Platform chrome |
| `AgentStripViews` / `AgentStripNav` | `AgentStripView` + nav model | Logic can live in OpenBotKit; UI platform |
| `ChatComposer` (attach / knowledge capsule / stop square) | Extend `OpenBotChatUI.ChatComposer` | Prefer shared kit |
| `KnowledgeCapsuleViews` | Capsule + source sheet | Platform UI |
| `DeliverableFooter` | Chat footer「打开成果」 | Platform UI |
| `MobileTasksScreen` segments | `TasksSegmentedView` | Platform |
| `MobileKnowledgeScreen` | `KnowledgeBrowserView` | Platform |
| `MeTabScreen` hub + `MeSubScaffold` | Hub + tertiary nav (circular back/+, kicker「我的」) | Platform |
| `MobilePageHeader` | `ModuleTitle` | Tiny shared style |
| `OpenBotTheme` | Light companion theme wrapping tokens | Platform |

**Reuse as-is from OpenBotKit today:** `ChatViewModel`, transport, sessions, markdown/parser — re-skin with new tokens; do not fork a second chat stack.

---

## 5. Recommended iOS first slices

1. **Tokens + `EmployeeRootTabs` shell** — four tabs empty/stub; retire Screen/Voice/Settings as root (relocate under Me / Voice entry points).
2. **对话 chrome** — Agent Strip → `switchChatSession`; composer send→stop (`chat.abort`); pink knowledge capsule + attach capsules; steward-first strip; **no** TO: header; **no** strip「+」.
3. **任务 R1** — 定时任务 \| 待我处理 lists + accept/complete (read/write parity with Android stage28/30 Me-aligned tasks).
4. **知识 R1** — title above search; tree + search results; document preview fullscreen.
5. **我的 Hub** — three segments; Connect + device pair list; **更多** create bot/group; bot workspace tabs via `robot.workspace.*`.
6. **Polish** — Me tertiary kicker+tabbar context; module title unification; DEMO flags only for offline QA.

Keep Voice/TalkMode as the mic path (Android stage33 decision).

---

## 6. What NOT to copy (discarded / 超集)

| Do not port | Why |
| --- | --- |
| **`app/stage30-tabs-shell-bodies` Employee Shell WebView embeds** as the main Tasks/Knowledge/Me body | Parallel / discarded route: tab content was `/embed/employee/…?shell=mobile` via `TabShellEmbedHost`. Canonical path is **native Compose/SwiftUI + HTML SoT**, not Shell embed. Keep Shell only if a future explicit embed feature is requested. |
| Preview 超集: in-chat playable voice bubbles | Web chat mic disabled; TalkMode is separate |
| Strip drag-reorder persistence | Web does not persist strip order |
| Strip「+」create wizard | Create lives under 我的→更多 |
| Task detail「任务成果」+「打开全文」 | Not in Web assigned-tasks; Android intentional gap |
| Merging four-tab stack to `main` | Stacked PRs only until product asks |
| Copying Android DEMO strip seed logic into production iOS | DEMO flags for offline QA only |

Historical worktree (frozen embed experiment): `/Users/daniel/AI VP/openbot-app-stage30-tabs-shell-bodies` @ `app/stage30-tabs-shell-bodies`.

---

## 7. Shared vs platform-specific

| Shared (prefer `apps/shared/OpenBotKit`) | Platform-specific |
| --- | --- |
| RPC method names + DTOs / decode | Tab bar, navigation, sheets |
| Chat session model, send/abort, markdown | Compose vs SwiftUI layout |
| Token **values** (JSON or Swift+Kotlin twin files) generated from one table | Fonts packaging, haptics, permissions |
| Agent-strip roster mapping from `agents.list` | Pixel polish, safe areas |
| Tasks/Knowledge/Me **read models** mirroring Web TS | Camera/Screen/EventKit modules under 本机与连接 |

Suggested artifact: `design/mobile-tokens.json` (or doc table above) consumed by Android constants + Swift `OpenBotMobileTokens` — avoid drifting hex values.

---

## 8. Pointers

- Android evidence: `apps/android/docs/evidence/stage38-strip-session-title-kb/README.md`
- Preview: `/Users/daniel/AI VP/openbot-four-tab-frontend-preview/` · Desktop twin still at `/Users/daniel/Desktop/openbot-four-tab-frontend-preview/`
- Old stage26 folder pointer: `/Users/daniel/AI VP/openbot-app-stage26-chat-chrome-cleanup/MOVED.md`
- Top-level copy of this plan: `/Users/daniel/AI VP/openbot-four-tab-ios-reuse.md`

---

## 9. Independent iOS expert review (2026-10-02 CST)

**Verdict:** Plan is **directionally solid** and correctly rejects stage30 WebView-as-tab-body. Slice order is mostly right, but several platform risks need explicit handling before deeper slices. Treat Android Compose as a **behavioral/IA reference**, not a line-by-line port.

### What's solid

1. **SoT hierarchy** — HTML IMPLEMENT rows + Web RPCs + Android as parity reference is the right stack. Explicit discard of stage30 `TabShellEmbedHost` / Employee Shell full-tab embeds prevents a second dead end.
2. **OpenBotKit reuse** — Keep `OpenClawChatView` / `OpenClawChatViewModel` / `IOSGatewayChatTransport`; re-skin, don't fork. Matches how Android kept one chat stack.
3. **IA map** — 对话/任务/知识/我的 labels match SoT; legacy Screen/Voice/Settings → **我的→本机与连接** is correct for companion productization.
4. **RPC contract** — One gateway method table shared with Android/Web avoids iOS-only endpoints and DEMO seed drift.
5. **Slice 1 first** — Tokens + shell before chat chrome is the only sane bootstrap on iOS (current post-auth path is full Employee Shell WebView).

### What's risky / wrong-to-copy

| Risk | Detail | Correction |
| --- | --- | --- |
| **Compose ≠ SwiftUI** | `Scaffold` + `WindowInsets` + `rememberSaveable` do not map 1:1. System `TabView` will **not** match SoT (64pt bar, accent `#2F6BFF`, rounded top surface on Android). | Prefer **custom bottom bar** (Android `BottomTabBar` pattern) over `TabView`. Use `safeAreaPadding` / home-indicator insets explicitly. |
| **Navigation model** | Android uses Compose sheets + `MeSubScaffold` kicker. iOS needs `NavigationStack` + sheet/`fullScreenCover` and a clear rule for when the **root tab bar stays visible** (SoT keeps tabbar on Me secondary). | Slice 1: sheets OK. Slice 5+: tertiary pages must keep 「我的」kicker **and** bottom tabbar (HTML `.phone` behavior). |
| **Session lifecycle** | Today `RootView` → `EmployeeWorkspaceView` (WKWebView). Native four-tab must own post-auth without clearing platform cookies on shell load failure (existing Employee Shell lesson). Chat VM must **survive tab switches**. | Primary shell = native `EmployeeRootTabs`. Optional Shell only under 我的→更多. Keep Chat mounted (opacity) or hoist VM. |
| **OpenBotKit gap** | Kit has chat UI/theme from macOS companion era — **not** Agent Strip, knowledge capsule, send→stop square, deliverable footer. | Slice 2 extends kit / app chrome; do not invent parallel `ChatSheet2`. |
| **RootTabs confusion** | `RootTabs` (Screen/Voice/Settings) is legacy + smoke-test only; `RootCanvas` is the node canvas, not four-tab. | Don't "upgrade" `RootTabs` in place — add `EmployeeRootTabs` and point post-auth at it. Keep `RootTabs` for smoke/legacy. |
| **Fonts** | Android bundles Manrope. iOS Info.plist + `UIAppFonts` + xcodegen resources needed. Fixed 24pt `.system` ignores Dynamic Type if overused. | Slice 1: SF Pro size/weight fallback. Later: bundle Manrope + prefer scalable styles / `@ScaledMetric` for gutters where SoT allows. |
| **Keyboard × tab bar** | Android hides bar when Chat + IME. iOS must mirror or composer sits under bar. | Listen to keyboard notifications; hide custom bar on Chat when keyboard visible. |
| **Auth vs gateway** | Cloud sign-in ≠ gateway node connect. Four-tab Tasks/Knowledge still need gateway RPCs; Me must surface connect affordance (Android gates on `isConnected`). | Don't assume WebView session covers node chat; keep `CloudConnectionApplier` + Settings under 本机与连接. |

### Slice-order corrections

| Plan | Expert adjust |
| --- | --- |
| 1 Tokens + shell | **Keep** — also **swap post-auth primary** from Employee Shell WebView → native four-tab in the same slice (otherwise shell is dead code behind WebView). |
| 2 对话 chrome | Keep, but land **Agent Strip session switch** before capsule polish; mic → TalkMode (not in-bubble). |
| 3 任务 R1 | Keep; share decode models with Web TS names (`TasksWebModels` twin in OpenBotKit or app). |
| 4 知识 R1 | Keep; title **above** search (stage38 Android). |
| 5 我的 Hub | Move **Connect / device.pair** earlier if chat is unusable offline — or ensure slice 1 Me already opens Settings. |
| 6 Polish | Add **`design/mobile-tokens.json`** before large visual polish to stop hex drift. |
| — | **Do not** schedule a "port stage30 embeds then replace" interim. |

### Platform constraints checklist

- **Safe Area:** Top content under status bar; tab bar above home indicator; Chat composer respects keyboard safe area (OpenBotKit already partly handles).
- **Dynamic Type:** Module titles can grow; tab labels at caption2 need truncation tests at XXXL.
- **TabView vs custom:** Custom bar to match SoT/Android; avoid UITabBar appearance hacks.
- **Light companion:** Tokens are light-first (HTML has a dark theme demo — not required for IMPLEMENT).
- **No merge `main` / no force-push:** Stack iOS PR on stage38 tip or retarget to `main` with iOS-only commits; Android stack stays separate.

---

## 10. Slice 1 landed — `app/stage39-ios-four-tab-shell`

**Branch:** `app/stage39-ios-four-tab-shell` (from stage38 @ `4bbeeb9cb`)  
**Evidence:** `apps/ios/docs/evidence/stage39-ios-four-tab-shell/README.md`

### What shipped

| Item | Path / note |
| --- | --- |
| Tokens | `apps/ios/Sources/MobileUI/OpenBotMobileTokens.swift` (Android hex twin; SF Pro fallback) |
| Module title + SoT seg | `MobilePageComponents.swift` (`ModuleTitle`, `SoTSegmentedControl`) |
| Four-tab shell | `EmployeeRootTabs.swift` — custom bar 对话/任务/知识/我的; keyboard hides bar on Chat |
| Chat | `ChatTabView.swift` — OpenBotKit `OpenClawChatView` + existing transport; kept mounted across tabs |
| Tasks / Knowledge | `TasksTabStub.swift`, `KnowledgeTabStub.swift` — IA stubs only |
| Me hub | `MeTabShell.swift` — segments; **本机与连接** sheets → Settings / Voice / Screen; **更多** optional Employee Shell |
| Post-auth wire | `RootView.swift` → `EmployeeRootTabs` (Employee Shell no longer primary) |
| Smoke | `SwiftUIRenderSmokeTests.employeeRootTabsBuildAViewHierarchy` |
| Lint inputs | `SwiftSources.input.xcfilelist` +7 MobileUI files |

### Partial / deferred

- Manrope font bundling → later polish
- Me tertiary kicker + persistent tabbar on pushed pages → slice 5
- Chat Agent Strip / capsules / send→stop → slice 2
- `design/mobile-tokens.json` shared artifact → before visual polish
- Legacy `RootTabs` / `RootCanvas` remain for manual-setup + smoke

### Build

- `xcodegen generate`: OK
- `xcodebuild` Simulator: **blocked** — iOS 26.5 runtime/platform not installed on this Mac (Xcode 26.6 present). See `apps/ios/docs/evidence/stage39-ios-four-tab-shell/README.md`.

---

## Multi-platform sharing (Stage 43)

Canonical architecture draft (zh-CN primary):

- `docs/architecture/multiplatform-sharing.zh-CN.md`
- English stub: `docs/architecture/multiplatform-sharing.md`
- AI VP easy-read copy: `/Users/daniel/AI VP/多端共享机制-草案.md` (synced from repo doc)
- Related workspace note: `/Users/daniel/AI VP/openbot-four-tab-ios-reuse.md`

Covers: established contract + visual SoT + parallel native shells; non-goals (no shared UI kit yet, no WebView-as-tab); next slices (tokens package, acceptance matrix, Mac/Windows path decision). Branch: `app/stage43-multiplatform-sharing` (base stage42). Do not merge `main` unless asked.

---

## Stage 40 naming (2026-10-02)

iOS Xcode shell renamed **OpenClaw → OpenBot** on `app/stage40-ios-rename-openbot` (new PR). Use:

- Project: `apps/ios/OpenBot.xcodeproj`
- Scheme / target: `OpenBot`
- Evidence: `apps/ios/docs/evidence/stage40-ios-rename-openbot/README.md`

Shared kit `OpenClaw*` protocol type prefixes remain until a dedicated kit rename. Do not merge to `main` unless asked.
