# Stage 3.0 — Me hub Web-aligned (slice 4)

SoT: top tabs **个人设置｜本机与连接｜更多** (four-tab preview `me-hub.jpg` / `me-device.jpg` / `SUMMARY.zh-CN.md`).

## Web flows mirrored (do not invent Android-only Me system)

| Concern | Web SoT | Gateway / shared Android |
| --- | --- | --- |
| Personal settings shell tabs | `ui/src/ui/ports/employee/views/workbench-personal-settings-page.ts` + `workbench-types.ts` (`account` / `security` / `preferences` / `authorization`) | Compose segments + sheets |
| Account / security / prefs panels | `workbench-personal-account-panel.ts` / `workbench-personal-security-panel.ts` / `workbench-personal-preferences-panel.ts` | Read-only account card; password change points at Web `platform-auth` `/password/change` |
| 授权资源 | `workbench-personal-authorization-panel.ts` + `user-operational-identity.ts` | `user-operational-identity.list` + `enterprise-operational-identity.access.list-for-seat` |
| 本机与连接 / 我的设备 | `ui/src/ui/controllers/devices.ts` (`device.pair.list`) + companion Connect / Settings | Reuse `ConnectTabScreen` + `SettingsSheet`; paired list via `device.pair.list` |
| 我的机器人 | `my-bot-read-model.ts` / `my-bot-workspace-panel.ts` | `agents.list` + `robot.workspace.updateIdentity`; create → reduced `agents.create` |
| 我的协作小组 | `collaboration-group-read-model.ts` / `spaces.ts` | `collaboration.spaces.list` + create/save via `collaboration.spaces.members.update` |
| Visual SoT | four-tab preview Me panes | — |

Connect / device / voice / canvas pieces kept where they map to **本机与连接** (gateway + permissions + local capabilities).

## Gaps

- Full add-identity wizards (OAuth / WeChat QR / manual credentials) stay on Web — Android shows list + “Web 向导” affordance.
- Seat model catalog is placeholder; full platform model binding UI not ported.
- `agents.create` on phone is reduced (no `workspaces.create` local-path allocation); failures surface Web-wizard hint.
- Account profile / password write path not yet wired on `EmployeeAuthClient` (read-only + Web redirect notice).
- Group member roster editor / invites deferred; detail saves title/purpose only.

## Test

- `./gradlew :app:compileDebugKotlin`
- `./gradlew :app:testDebugUnitTest --tests ai.openbot.app.ui.MeHubModelsTest`
