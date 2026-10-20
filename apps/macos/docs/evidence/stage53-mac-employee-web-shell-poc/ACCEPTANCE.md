# PR #408 独立验收报告（Stage 53）

> **角色：** 独立验收评审（非作者）  
> **PR：** https://github.com/upbeyond/openbot/pull/408  
> **分支：** `app/stage53-mac-employee-web-shell-poc`  
> **Head tip（验收修正后）：** `710f746f90cd3a8a79533c542c8176c336b8ab74`  
> **Base：** `main`（PR base 当时 `613733bef`）；实现叠在 [#402](https://github.com/upbeyond/openbot/pull/402) stage52 之上  
> **日期：** 2026-10-07（Asia/Shanghai）  
> **硬规则：** 未验收合格不得合入 `main`；本评审 **不执行 merge**。

## 结论（Verdict）

### **有条件合格**

内容与 ADR 选项 1 对齐；`openDeviceSettings` 边界正确；Mac POC 范围正确；无 Windows 原生 UI。  
合入条件：

1. **含本报告的 acceptance fix 提交**（窗口标题对齐「员工工作台 / Employee Workbench」；矩阵表头去掉「本切片不实现桌面壳」矛盾）。  
2. **叠栈：** #402 仍开且用户要求 CI 全绿才合 — #408 叠在 #402 上；建议 **先合 #402（CI 绿后）再合 #408**，或 rebase 到已合 main 后再合。  
3. **CI：** #408 验收时 checks 多为 pending；须按组织政策等绿（或知悉主干同类红灯后由授权人决定）。  
4. **`swift test --filter EmployeeShellWebShellBoundaryTests`：** 作者与本评审均受 GitHub HTTPS/SPM 拉取影响未能稳定跑通 — **记下，非内容不合格**；合入前有条件时补跑。

**推荐：** 在条件 1–3 满足后 **可以合入**。验收员不代为 merge。

---

## 验收标准对照

| # | 标准 | 结果 |
| --- | --- | --- |
| 1 | ADR 选项 1：员工 UI = Web shell 窗；伴侣 Gateway/TCC/node；无原生四 Tab | **通过** — 复用 `/embed/employee/*` 主窗；注释与 macos.md 明确伴侣职责；无 `EmployeeRootTabs`/`PostOnboardingTabs` 移植 |
| 2 | `openDeviceSettings` → `SettingsWindowOpener`，非员工 me embed | **通过** — `EmployeeShellController.handleNativeIntent`：`.openDeviceSettings` → `SettingsWindowOpener.shared.open()`（不再 `navigate(... me)`） |
| 3 | 菜单/窗口命名 员工工作台 / Employee Workbench | **初审部分通过 → 修正后通过** — 菜单原文已是；窗口曾为 `OpenBot Workbench`/`OpenBot 工作台`，与准则及 PR 正文不符，acceptance fix 已对齐 |
| 4 | Docs/matrix/checklist/evidence 准确；叠 #402 OK | **初审有文档矛盾 → 修正后通过** — 叠栈确认含 stage52 commits；checklist 项 2 ✅；evidence 路径正确；矩阵 IMP-SHELL Desktop 已引 stage53；表头「不实现桌面壳」已改 |
| 5 | 无 Windows 原生 UI；范围仅 Mac POC | **通过** — diff 仅 `apps/macos/**` + architecture/platforms 文档 |
| 6 | CI；swift test | **记下** — 见下 |

---

## 变更范围（相对 stage52 tip `5afa0d681`）

| 路径 | 判定 |
| --- | --- |
| `EmployeeShellController.swift` | device-settings → companion Settings |
| `EmployeeShellStrings.swift` / `EmployeeShellWindowController.swift` / `MenuContentView.swift` | 命名与注释 |
| `EmployeeShellWebShellBoundaryTests.swift` | 边界单测 |
| `apps/macos/docs/evidence/stage53-…/README.md` | evidence |
| `desktop-web-shell-checklist.zh-CN.md` | 项 2 标完成 |
| `multiplatform-acceptance-matrix.zh-CN.md` | IMP-SHELL Desktop |
| `docs/platforms/macos.md` | Employee UI (Web shell) 节 |

**无** Windows 宿主、无原生四 Tab IA。

---

## 必改项（acceptance fix，已在分支落地）

1. **窗口标题**与准则「Menu/window naming 员工工作台 / Employee Workbench」及 PR 声称不一致 → 已改为与菜单相同文案，并更新单测期望。  
2. **矩阵表头**仍写「本切片不实现桌面壳」与 Stage 53 POC / IMP-SHELL「有」矛盾 → 已改写；EN stub 补 Stage 52–53 note。

---

## CI

### PR #408（验收时）

`mergeable_state: unstable`。`gh pr checks`：多数 **pending**（actionlint / check / delivery guard / secrets / freeze / docs-scope / label…）；ios/backfill **skipping**。合入前需再读一轮最终结论。

### PR #402（用户要求等绿）

仍 **open**，head `5afa0d681`。关键失败仍在：

- `check (types, lint, format)` fail  
- `check-docs` fail  
- `delivery guard` fail  
- `freeze + phase0 evidence tests` fail  
- `secrets` fail  

若干 pass（docs-scope / actionlint / no-tabs / label）。**尚未全绿** — 与用户「等绿再合」一致，**暂不合 #402**。

### swift test

Evidence 已写 SPM/GitHub HTTPS 卡住。本评审未获得稳定 `swift test` 绿结果。测试为纯路由/字符串/bootstrap URL，逻辑可从源码静态验收。

---

## Blockers

| 类型 | 项 | 状态 |
| --- | --- | --- |
| 内容 | 窗口命名 / 矩阵表头矛盾 | **acceptance fix 已清** |
| 内容 | device-settings 边界 / 原生四 Tab | **无问题** |
| 流程 | #402 CI 全绿（用户门禁） | **未满足**（仍 5 fail） |
| 流程 | #408 CI 最终绿 | **验收时 pending** |
| 流程 | swift test 实跑 | **未跑通（记下）** |

**无剩余内容 blocker**（修正提交推送后）。流程门禁按用户/CI 政策。

---

## 推荐合入顺序（给人）

1. 等 **#402 CI 全绿** → 独立验收已通过的 #402 合入 main。  
2. #408 rebase/确认含 acceptance fix → CI 绿 → 授权人合入。  
3. 有网络时补跑 `swift test --filter EmployeeShellWebShellBoundaryTests`。

---

## 路径

- Worktree：`/Users/daniel/AI VP/openbot-stage53-mac-web-shell-poc`  
- 本报告：`apps/macos/docs/evidence/stage53-mac-employee-web-shell-poc/ACCEPTANCE.md`  
- 副本：`/Users/daniel/AI VP/PR408-独立验收.md`  
- Evidence README：同目录 `README.md`
