# Implementation Plan: mesh-naming-truth-sync

## Agents

- kiro-mesh-naming · role: owner · scope: mesh-naming-truth-sync · paths: `.kiro/specs/mesh-naming-truth-sync/**`, `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md`, `docs/design/robot-workspace-mesh-phase-1-acceptance-2026-08-02.md`, `docs/design/robot-workspace-mesh-phase-4-acceptance-2026-08-02.md` · since: 2026-10-01

## 登记记录

`## Agents` 由 `pnpm loom derive` 从 `.loom/registry.yaml` 生成，registry 是唯一来源。

- Loom task：`mesh-naming-truth-sync:kiro-mesh-naming`。2026-10-01 人工决定由本任务处理 D3.R1 诊断中发现的命名问题，并由本任务决定如何处理。owner `kiro-mesh-naming`，session `b6aa6dc3-72af-430a-a4dd-f9c271ec2fd0` · ide: kiro。
- 三个 docs 文件此前没有任务认领，直接登记，不涉及接管。登记前核对（`origin/main` `a6818b3fa`）：两个 GitHub 仓库的开放 PR（8 个、5 个）都不涉及它们；本 worktree 之外唯一的本地副本（快照 clone `openbot-p5-4`）与 `origin/main` 相同；624 个远端分支中只有冻结的 `release/baseline-recovery-20260725`（`origin` 与 `old` 各一份）带有不同版本，来自 `7817ad9f8`，即同一批文档的另一份提交；`old/main` 与 `origin/main` 相同。没有 sharedPaths。

每个提交 trailers：

```
Task: mesh-naming-truth-sync
Agent: kiro-mesh-naming
```

## 事实

- 产品中实际的名称：`nav.items.enterpriseMesh` 与 `tabs.enterpriseMesh` 是「机巢治理」/ "Mesh Governance"（`ui/src/i18n/locales/zh-CN.ts:45`、`:1429`，`ui/src/i18n/locales/en.ts:45`、`:1483`），自 `2f8626483`（2026-05-28）起没有变过。zh-TW、de、es、pt-BR 没有这两个 key，回退到英文。权限目录 `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts:112`、`:118` 与 Mesh 页面的 aria-label `机巢治理工作台分类`（`enterprise-mesh-governance-surface.ts:500`）也用「机巢治理」。
- 改名从未进入代码：任何 ref 中都没有把这两个 key 改为「机巢」或 "AI Mesh" 的提交；"AI Mesh" 在产品代码中从未出现过；90 个本地 checkout 的 locale 文件与 2 个 stash 中也没有。
- 改名的来源只有 2026-08-02 的一批文档（`3b4a5a3d3`，Task `robot-workspace-mesh-boundary`，Agent `cursor-mesh-ops`）：方案 `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md` 要求「机巢治理」→「机巢」（§0、§9），没有提 "AI Mesh"，也没有说明理由；"AI Mesh" 只出现在 Phase 1 验收清单中。Phase 0–4 五份验收清单的签字都是「专家验收（Cursor Agent）」，没有人工产品签收记录。
- 那份验收清单的命名与文案交付大多没有对应改动：命名、§2.3 的 Legacy 术语改写、§2.1 的副标题与 `renderMyBotDetailPlaceholder()` 在任何 ref 中都不存在；提交时导航测试匹配的仍是 `/机巢治理|Mesh Governance/`。结构性交付（运营 / 绩效 Tab、只读深链抽屉及其声明）是存在的。
- 2026-08-02 前后的其他 spec 与设计文档都称这个模块为「机巢治理」或「Mesh 治理」：如 `.kiro/specs/mesh-governance-redesign/requirements.md:5`（2026-06-01）、`docs/design/enterprise-ui-baseline.md:6`（2026-06-16）、`docs/design/ai-workforce-governance-design.md:1`（2026-07-27），以及 2026-09-28 以后的 `.kiro/specs/diagnosis-evolution-decision-surfaces/`。
- 唯一按改名行事的是 `0df166521`（2026-08-03）对导航测试的收紧，它让测试依赖一个不存在的名称，最终成为 D3.R1；#245 已改为按 locale 断言。

## 决定（2026-10-01）

- 企业端模块名保持「机巢治理」/ "Mesh Governance"，以 locale 中的 `nav.items.enterpriseMesh` 与 `tabs.enterpriseMesh` 为准。理由：这是已上线、在所有 ref 中一致的名称，前后的 spec 都这样称呼；改名只出自一份由 agent 签收、交付记录大多不实的文档；顶层导航改名是用户可见的产品决定，没有人工决定过。
- 更正记录而不是改代码：在三份文档中加更正说明，原文保留，让后来的 agent 不再按不存在的名称行事。
- 以后若决定改名：只改这两个 locale key（en / zh-CN；其他语言回退英文），并同步权限目录与 aria-label；导航测试跟随 locale，不必再改。

## 任务

- [x] **M1** 建立任务：登记 Loom task 与 session，认领三份文档与本 spec 目录 — kiro-mesh-naming
- [x] **M2** 核对事实：见上节 — kiro-mesh-naming
- [x] **M3** 更正记录：Phase 1 验收清单文首加更正，§3.4、§3.5 与 §5 可选改进 3 加行内标注；Phase 4 验收清单 §5 可选后续 2 加更正；方案 §0 加更正，§9 Phase 1 两项勾选加行内标注。只加说明，原文与勾选状态不改 — kiro-mesh-naming
- [ ] **M4**（待人决定）机巢页面中的员工语义术语。方案 §8 与 PR 模板的 Strong Separation 检查项都禁止在机巢文案中用「成长路径」「能力配置」。现存用法：
  - 线上可见：对象总览 KPI「成长观察」（`ui/src/ui/ports/enterprise/views/enterprise-mesh-governance-surface.ts:2470`）。它不在禁用词中，但 Phase 1 计划改为「运营异常」。
  - 只在 resolver 预览中（`/enterprise/mesh` 等无租户路径）：卡片「能力成长路径」与说明中的「能力配置」（`ui/src/ui/ports/enterprise/views/enterprise-shell.ts:49`）。
  - 没有调用方、不会渲染：`renderMeshDetailPanel`（`enterprise-mesh-governance-surface.ts:1942`）中的「能力配置」（:1396）、「运行成长」（:1402）、「能力成长路径」（:1445）。
  - 未渲染：`subtitles.enterpriseMesh`（`zh-CN.ts:1484`、`en.ts:1544–1545`）含「能力成长路径」/ "capability growth paths"；企业页不渲染页面副标题（`ui/src/ui/app-render.ts:1973–1982`），导航提示用的是 `nav.items`（`ui/src/ui/navigation.ts:1540–1541`）。
  - 处理需要 `enterprise-mesh-governance-surface.ts` 与 `enterprise-shell.ts` 的 ownership（`ops-decommission:kiro-enterprise-tsgo`，最后信号 2026-07-13；`enterprise-shell.ts` 另有 `enterprise-organization-monthly-usage:cursor-grok-org-usage`），改 locale 还需要 locale 文件的 ownership（4 个任务认领）。是否处理、由谁处理，待人决定。
