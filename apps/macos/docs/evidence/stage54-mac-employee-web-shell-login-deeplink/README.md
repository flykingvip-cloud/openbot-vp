# Stage 54 — Mac employee Web shell：登录态 / 深链 / 通知点回员工窗

Date: 2026-10-08 (Asia/Shanghai). Branch `app/stage54-mac-web-shell-login-deeplink`（叠在 Stage 53 / [#408](https://github.com/upbeyond/openbot/pull/408) + freeze [#450](https://github.com/upbeyond/openbot/pull/450) 之后的 main）。

## 决策上下文

ADR 选项 1（[`desktop-ui-adr.zh-CN.md`](../../../../../docs/architecture/desktop-ui-adr.zh-CN.md)）：桌面员工 UI = **Web shell**；伴侣 = Gateway / TCC / node。清单第 3 刀（[`desktop-web-shell-checklist.zh-CN.md`](../../../../../docs/architecture/desktop-web-shell-checklist.zh-CN.md)）：登录与 Gateway + 深度链接/通知统一点回员工窗。

## 本切片落地

| 项 | 行为 |
| --- | --- |
| 登录 | 未登录时菜单「员工工作台」或员工语法深链 → `EmployeeLoginView`；成功后继续 `pendingRoute`（deferred deep link）。员工账号 jar ≠ node pairing。 |
| 深链 | `openbot://employee/…` / `chat` / `space` / `knowledge` → `DeepLinkHandler` → `EmployeeShellDeepLinkRouting.embedPath` → 员工窗 `/embed/employee/*`。 |
| 通知 | `EmployeeNotificationRouter.start()` 在员工 shell `open`/深链入口安装（idempotent）；`NotificationManager` 写入 `userInfo[deepLink]`；点击走同一套 `DeepLinkHandler`（仍 auth-gate）。Wave 1 = 本地/系统通知；服务端 push 不在本切片。 |
| 边界 | Stage 53：`openDeviceSettings` 仍 companion Settings；bootstrap **无** `shell=mobile`。 |

## 代码锚点

| 路径 | 角色 |
| --- | --- |
| `EmployeeShell/EmployeeLoginView.swift` + `EmployeeAuthClient.swift` | 密码登录 / 找回 / 邀请注册 / SSO 入口 |
| `EmployeeShell/EmployeeShellController.swift` | 登录窗、pendingRoute、shell 导航 |
| `EmployeeShell/EmployeeShellDeepLinkRouting.swift` | 纯映射 + auth gate（可测） |
| `EmployeeShell/EmployeeNotificationRouter.swift` + `MenuBar.swift` | 通知代理安装 |
| `DeepLinks.swift` | 员工语法进 shell；agent/gateway/workspace 不动 |

## 非目标（仍）

- 原生四 Tab / 把菜单栏改成员工壳
- Windows Web shell 宿主
- 员工 MFA / 新 OIDC（SSO = 既有 trusted-proxy）
- 服务端 push（Wave 2）

## 验证

```bash
cd apps/macos
swift test --filter EmployeeShellLoginDeepLinkTests
swift test --filter EmployeeShellWebShellBoundaryTests
```

Manual smoke：未登录点菜单 → 登录窗；登录后进 overview；`openbot://employee/me` 进 me embed；带 `deepLink` 的本地通知点击进员工窗；设备设置仍开伴侣 Settings。

## 矩阵

本 evidence 支撑 Desktop 列：IMP-SHELL 加深（登录/深链/通知）；Web employee 已有行为的功能格标为 **有（Web shell 复用）**，见 `docs/architecture/multiplatform-acceptance-matrix.zh-CN.md`。
