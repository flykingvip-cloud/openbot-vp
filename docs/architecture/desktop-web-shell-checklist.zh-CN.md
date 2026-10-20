# 桌面 Web shell 落地清单（脚手架笔记）

> **状态：** Stage 55 — Windows Web shell 宿主已落地（见 evidence）；Mac Stage 53/54 仍有效  
> **日期：** 2026-10-08（Asia/Shanghai）  
> **依据：** [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md) **已拍板选项 1**  
> **非目标：** Mac/Windows 原生四 Tab；把菜单栏伴侣改成员工 Tab；本文件不授权直接改产品码。

## 边界

| 做                                      | 不做                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| 桌面窗口/嵌入加载 **Web employee**      | 移植 `EmployeeRootTabs` / `PostOnboardingTabs` 到桌面 |
| Mac 伴侣继续 Gateway / TCC / node       | 伴侣内做对话/任务/知识/我的底栏                       |
| 与 Web 同一 Gateway RPC                 | 桌面私有员工 API                                      |
| Windows **Web shell 宿主**（Stage 55）  | Windows 原生四 Tab；冒充完整伴侣已交付                |

## 建议切片顺序

1. **边界文档落地** — ✅ Stage 52 ADR 已拍板 + 本清单。
2. **Mac 员工窗口 POC** — ✅ Stage 53：菜单「员工工作台」→ `EmployeeShellController` → 独立主窗口加载 `/embed/employee/*`（无 `shell=mobile`）；`openDeviceSettings` → 伴侣 Settings（非员工 me embed）。证据：`apps/macos/docs/evidence/stage53-mac-employee-web-shell-poc/README.md`。
3. **登录与 Gateway** — ✅ Stage 54：未登录 deferred deep link → `EmployeeLoginView`；员工 jar ≠ node pairing；`EmployeeNotificationRouter.start()` 安装；深链/通知统一进员工窗。证据：`apps/macos/docs/evidence/stage54-mac-employee-web-shell-login-deeplink/README.md`。
4. **矩阵 Desktop 列** — ✅ Stage 53 IMP-SHELL + Stage 54 登录/深链；Web employee 已有行为的功能格 Desktop 标「有（Web shell 复用）」；伴侣能力仍 N/A。
5. **Windows Web shell 宿主** — ✅ Stage 55：`apps/windows` WebView2 员工窗 + 同 bridge / auth gate / deeplink 可移植规则；**无** `shell=mobile`；`openDeviceSettings` 仍宿主原生（伴侣 planned）。证据：`apps/windows/docs/evidence/stage55-windows-employee-web-shell-host/README.md`。WebView2 真机 smoke 需 Windows 机器。

## 验收口令

- 问「桌面四 Tab 做了吗？」→ **不做原生**；员工面 = Web。
- 问「Mac 伴侣是不是员工 App？」→ **不是**；伴侣 = Gateway/TCC/node。
- 问「Windows 员工面？」→ **Web shell 宿主**（Stage 55）；完整伴侣仍 planned。
