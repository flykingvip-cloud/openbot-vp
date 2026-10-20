# ADR：桌面员工 UI 走 Web shell，还是原生四 Tab

> **状态：** **已拍板 — 选项 1 Web shell**（Stage 52 / Track B3）  
> **拍板日期：** 2026-10-07（Asia/Shanghai）  
> **决策人：** Daniel  
> **事实来源：** `docs/platforms/macos.md`；Windows 仅引用 `docs/platforms/windows.md` 已写明的句子  
> **明确：** **不**实现 Mac/Windows 原生员工四 Tab；Mac 菜单栏伴侣只保留 Gateway / TCC / node 职责。

## 决定

采用 **选项 1：桌面员工 UI = Web shell**。

| 面                 | 职责                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **桌面员工 UI**    | 复用 Web employee（窗口或嵌入加载同一套员工面）。行为/RPC 跟 Web，不另起桌面私有四 Tab IA。                                                                                                                |
| **Mac 菜单栏伴侣** | 只管 Gateway 生命周期、TCC（通知 / 辅助功能 / 屏幕录制 / 麦克风 / 语音识别 / Automation）、node（Canvas / Camera / Screen / `system.run` 等）、可选 PeekabooBridge / CLI 安装。**不**改造成员工四 Tab 壳。 |
| **Windows**        | 继续以文档现状为准（WSL2 CLI + Gateway；原生伴侣仍为 planned）。**不**为对齐手机而先造 Windows 原生四 Tab。                                                                                                |
| **手机**           | 继续 Android Compose / iOS SwiftUI 并行原生（见 [`multiplatform-sharing.zh-CN.md`](./multiplatform-sharing.zh-CN.md)）。                                                                                   |

## 现状（拍板时仍成立）

`docs/platforms/macos.md` 把 macOS 应用定义为 **菜单栏伴侣 + Gateway broker**，没有员工四 Tab。  
`docs/platforms/windows.md`：Windows 推荐 WSL2 跑 CLI + Gateway；「Native Windows companion apps are planned.」没有员工四 Tab。

手机四 Tab 验收见 [`multiplatform-acceptance-matrix.zh-CN.md`](./multiplatform-acceptance-matrix.zh-CN.md)。Desktop 列策略为 **Web shell**（功能格可仍标 Web / N/A，直到桌面 Web shell 落地切片有 evidence）。

## 曾考虑的选项（保留备查）

### 1. 桌面员工 UI 用 Web shell（**已选**）

员工四 Tab 行为以 Web employee 为参考，桌面用窗口或嵌入加载。菜单栏伴侣保持 Gateway / TCC / node。

### 2. Mac / Windows 原生四 Tab（**未选**）

在伴侣之外再做原生员工壳。工程接近再做一端；与菜单栏架构重叠。本拍板明确拒绝。

## 影响

|      | 选项 1 Web shell（已选）                                                          | 选项 2 原生四 Tab（未选）        |
| ---- | --------------------------------------------------------------------------------- | -------------------------------- |
| 工程 | 窗口/嵌入、登录态、与伴侣边界。不移植 `PostOnboardingTabs` / `EmployeeRootTabs`。 | 接近再做一端；与菜单栏重叠。     |
| 发布 | 员工 UI 跟 Web。Mac 伴侣仍按 `scripts/package-mac-app.sh`。                       | 每桌面端单独发版。               |
| 离线 | 员工页依赖 Web 资源与 Gateway；伴侣本地 Gateway / node 仍在。                     | 壳可更离线，但业务仍要 Gateway。 |

## 拍板后仍禁止

- 不实现 Mac/Windows **原生**员工四 Tab。
- 不把 macOS 菜单栏伴侣改成员工 Tab 壳。
- 不把手机四 Tab 嵌进 Mac/Windows 冒充桌面员工面已交付。
- 未获明确同意前，不擅自 merge 后续实现 PR 到 `main`。

## 后续实现切片（推荐，本 ADR PR **不开工**）

见 [`desktop-web-shell-checklist.zh-CN.md`](./desktop-web-shell-checklist.zh-CN.md)。摘要：

1. Mac：员工 Web shell 窗口入口（与菜单栏伴侣边界清晰）+ 登录态/会话与 Gateway 对齐。
2. 验收：矩阵 Desktop 列从策略说明推进到有 evidence 的「有 / 部分」。
3. Windows：✅ Stage 55 Web shell 宿主（`apps/windows`）；完整伴侣仍 planned；**不做**原生四 Tab。
