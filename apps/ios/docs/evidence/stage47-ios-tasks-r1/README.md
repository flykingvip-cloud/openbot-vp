# Stage 47 — iOS Tasks R1 (Track A2)

Date: 2026-10-03 (Asia/Shanghai). Branch `app/stage47-ios-tasks-r1` from `app/stage46-ios-chat-chrome` @ `42cb62972a652c08f42118791646d8e2cce4e6db`.

Native SwiftUI only. `EmployeeRootTabs` still owns the phone shell. The Tasks tab is not a WebView.

## Landed

- Tasks tab segments: 定时任务 | 待我处理. Default segment is 待我处理, matching Android `MobileTasksScreen` (`TasksSegment.Inbox`).
- 待我处理 loads Gateway `task.list` (`{}`) and keeps pending / accepted / running rows. Row detail calls `task.accept` / `task.complete` with `{ organizationId, id }`. 接受 is enabled only for pending; 完成 only for accepted or running.
- 定时任务 loads `cron.list` with `{ includeDisabled: true, limit: 50, offset: 0 }`. Detail calls `cron.update` (`{ id, patch: { enabled } }`) and `cron.run` (`{ id, mode: force }`).
- Plus button creates with a slim `cron.add` only: name, agentTurn message, cron expression or every-N-days. Body matches Android `buildCronAddParamsJson` (isolated / now / agentTurn / announce + `workbench-agent-main`). Not the multi-step Web wizard.
- Offline (operator gateway "not connected") shows the same two banners as Android's non-demo path. No iOS-only DEMO intent.

## Not done, and why

- Task-result card and 打开全文 are an intentional gap (calibrated ignore).
- Full multi-step cron create wizard is an intentional gap. Phone stays on the slim `cron.add` Android already uses.
- No private Gateway methods.

## Build evidence

1. `cd apps/ios && xcodebuild -scheme OpenBot -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' build` → **BUILD SUCCEEDED** (2026-10-03 08:52 CST). SwiftFormat (lint) and SwiftLint run-script phases stayed on. New tasks files had no lint violations. Pre-existing `SettingsTab.swift` superfluous_disable_command warning is untouched.

2. `xcodebuild -scheme OpenBotLogicTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -derivedDataPath /tmp/openbot-stage47-logic test` → **TEST SUCCEEDED**. `TasksWebModelsTests` passed (parse / inbox filter / cron.add / task.accept params).

## Files

- `apps/ios/Sources/MobileUI/TasksTabView.swift` (replaces `TasksTabStub.swift`)
- `apps/ios/Sources/MobileUI/TasksWebModels.swift`
- `apps/ios/Sources/MobileUI/EmployeeRootTabs.swift`
- `apps/ios/Tests/Logic/TasksWebModelsTests.swift`
- `apps/ios/project.yml`
- `apps/ios/SwiftSources.input.xcfilelist`
