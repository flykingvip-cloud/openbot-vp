# Stage 46 — iOS chat chrome (Track A1)

Date: 2026-10-03 (Asia/Shanghai). Branch `app/stage46-ios-chat-chrome` from `app/stage45-acceptance-and-desktop-adr` @ `906091589fff78be94dc5242570141d9b68af8fb`.

Native SwiftUI only. `ChatTabView` still owns one `OpenBotChatViewModel` and embeds `OpenBotChatView`. No WebView tab body, no second chat stack, no `RootTabs` patch.

## Landed

- Agent strip (`ChatAgentStripView` + `AgentStripNav`). Roster is `agents.list` (via `NodeAppModel.refreshGatewayOverviewIfConnected` / `gatewayAgents`) plus `sessions.list` on the existing chat transport. Empty agents still seed 大白管家 / `main`. 管家 is first and pinned; assistants follow, then space/group sessions. Tap calls the existing `OpenBotChatViewModel.switchSession(to:)` (the iOS name of Android `switchChatSession`): it sets the session key and reloads history. No new gateway method.
- No `TO:` header. Mobile chat passes `showsSessionSwitcher: false` (the desktop `SessionSwitcherBar` stays off).
- No strip plus. Create stays under 我的 → 更多. Strip drag-reorder persist is not implemented (calibrated ignore).
- Composer (`MobileCompanionComposer`) replaces send with a stop square while `pendingRunCount > 0` and calls the existing `OpenBotChatViewModel.abort()` → `chat.abort`.
- Pink 知识库 capsule and attachment capsules. Catalog load tries `context.scope.sources.catalog`, then `knowledge.base.list` + `knowledge.base.sources.list`. Explicit picks are sent as `chat.send` `contextScope` `{ mode: focused, lifetime: turn, sources }` and cleared after the turn, matching Android auto+turn. Empty selection omits `contextScope`.
- Attach uses the existing composer attachment loader (`addImageAttachment`). Images stay `type: image`; other files are `type: file` on `chat.send` (the transport already accepts `image` | `file`). There is no separate reading/progress state on the shared model.
- Mic calls `TalkModeManager.setTalkEnabled` and presents `TalkOrbOverlay`. It does not start in-bubble STT. In-bubble voice playback is not implemented (calibrated ignore).

## Not done, and why

- Full Web/Android context-scope tree (expand, deep/group/conversation presets, tri-state checks) is not ported. The sheet is a flat list of knowledge / file / folder / api rows. Presets would be a guess beyond the explicit `focused` + `turn` path already used by Android when the user picks sources.
- macOS `WebChatSwiftUI.chatSend` still omits `contextScope`. The shared transport signature accepts it so iOS can pass it; the Mac app does not encode it.
- `xcodebuild -scheme OpenBot` is **not** green. Do not treat this slice as a device/simulator app build.

## Build evidence

Watch note: this machine currently lists `watchOS 26.5 (23T570)` and the OpenBot scheme log reached `WatchSimulator26.5.sdk` while building `OpenBotWatchExtension`. That is not a green app build. No runtime was installed for this slice.

1. `xcodebuild -scheme OpenBot -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' CODE_SIGNING_ALLOWED=NO build` failed in the OpenBot SwiftLint prebuild script (exit 2) before the app linked:

   - `apps/ios/Sources/Model/NodeAppModel.swift:2674:24` `error: Duplicate Conditions Violation` (`duplicate_conditions`)
   - `apps/ios/Sources/Model/NodeAppModel.swift:2679:14` same rule

   Those lines are pre-existing and were not edited here. Root `.swiftlint.yml` only includes `apps/macos/Sources`, so `make lint-swift` does not see them. The iOS target script uses `apps/ios/.swiftlint.yml` and fails the build.

2. A follow-up compile of the same scheme, with the gitignored Xcode project's SwiftLint/SwiftFormat run-script phases forced to `exit 0` (local `project.pbxproj` only; regenerated afterward with `xcodegen generate`, not committed), got past lint and then failed on pre-existing Employee Shell types, also untouched by this slice:

   - `EmployeeShellController.swift:30:25: cannot find 'EmployeeShellWebController' in scope`
   - `EmployeeShellController.swift:68:41: extra argument 'websiteDataStore' in call`
   - `EmployeeShellRootView.swift:44:37: extra arguments at positions #2, #5 in call`

   `EmployeeShellConfig` in `EmployeeShellWebView.swift` has no `websiteDataStore`, and `EmployeeShellWebController` is not defined. The new chat files were not in that error list.

3. Narrower check that does not embed Watch: `xcodebuild -scheme OpenBotLogicTests -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' CODE_SIGNING_ALLOWED=NO test` → **TEST SUCCEEDED** (2026-10-03 07:35 CST). Suites included `AgentStripNavTests` (5), `ChatKnowledgeCatalogTests` (3), `TalkConfigParsingTests` (6). Result bundle: `~/Library/Developer/Xcode/DerivedData/OpenBot-guopujwapfublvcogrfibbknmywt/Logs/Test/Test-OpenBotLogicTests-2026.10.03_07-35-11-+0800.xcresult`.

4. `swift build --target OpenBotChatUI` in `apps/shared/OpenBotKit` completed (macOS). That target compiles `MobileCompanionComposer` and the chat view model changes; it does not compile the iOS app.
