# Stage 49 — iOS Me deepen (Track A4)

Date: 2026-10-03 (Asia/Shanghai). Branch `app/stage49-ios-me-deepen` from `app/stage48-ios-knowledge-r1` @ `d8d20835027c5217411ae2b41e8e16fd9394629a`.

Native SwiftUI only. `EmployeeRootTabs` still owns the phone shell. Me secondary pages are not a WebView tab. The optional employee workbench stays a full-screen cover from 更多, not a tab body.

## Landed

- 本机与连接: 连接网关 row with badge 已连接 / 未连接 (gateway status `Connected` plus a server name). Opens the existing Settings connect form in-tab (`SettingsTab(embedded:)`), so the 「我的」 kicker and the root tab bar stay. 设备与权限 uses the same settings form (permissions live there on iOS).
- Pairing badge: `device.pair.list` → 「我的设备」 shows `N 台` or `—`. The list is read-only. Current row is marked 本机 when `deviceId` matches `node.instanceId`.
- 更多: 我的机器人 (`agents.list`) and 我的协作小组 (`collaboration.spaces.list`). Create bot is `workspaces.create` (managed `~/.openbot/workspace`) → `agents.create` → `robots.bind-workspace`. Create group is `collaboration.spaces.members.update`. Group save / invite human use that same method.
- Robot workspace tabs 身份 | 能力 | 成长 | 运营授权 | 协作 via `robot.workspace.get` / `robot.workspace.updateIdentity`. 运营授权 reads `user-operational-identity.access.list-for-agent` (fallback `user-operational-identity.list`) and confirms with `user-operational-identity.grants.upsert`.
- Secondary pages use `MeSubScaffold`: back, kicker 「我的」, title. They are in the Me tab, not a sheet, so `EmployeeRootTabs` keeps the bottom bar.

## Not done, and why

- Me identity OAuth / WeChat wizard stays on Web (calibrated ignore). Personal settings is the account card plus logout, with a note that the wizard is not built on the phone.
- No iOS-only Gateway methods. No DEMO Me catalog.
- No WebView-as-tab.

## Build evidence

1. `cd apps/ios && xcodebuild -scheme OpenBot -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' build` → **BUILD SUCCEEDED** (2026-10-03 09:20 CST, after the JSON slash fix). SwiftFormat (lint) and SwiftLint run-script phases stayed on. New Me files had no SwiftLint violations. Pre-existing `SettingsTab.swift` `superfluous_disable_command` is untouched.

2. `xcodebuild -scheme OpenBotLogicTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -derivedDataPath /tmp/openbot-stage49-logic test -only-testing:OpenBotLogicTests/MeHubModelsTests` → **TEST SUCCEEDED**. Agents, spaces, identities, `device.pair.list`, workspace get, and the Web JSON param shapes passed.

## Files

- `apps/ios/Sources/MobileUI/MeTabShell.swift`
- `apps/ios/Sources/MobileUI/MeHubModels.swift`
- `apps/ios/Sources/MobileUI/MeHubScreens.swift`
- `apps/ios/Sources/MobileUI/EmployeeRootTabs.swift`
- `apps/ios/Sources/Settings/SettingsTab.swift` (`embedded`)
- `apps/ios/Sources/Voice/VoiceTab.swift` (`embedded`)
- `apps/ios/Tests/Logic/MeHubModelsTests.swift`
- `apps/ios/project.yml`
- `apps/ios/SwiftSources.input.xcfilelist`
