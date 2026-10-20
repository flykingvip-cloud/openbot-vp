# Implementation Plan: ui-browser-test-infrastructure

## Agents

- kiro-ui-browser-infra · role: owner · scope: ui-browser-test-infrastructure · paths: `ui/vitest.config.ts`, `.kiro/specs/ui-browser-test-infrastructure/**`, `ui/src/ui/browser-runtime-imports.node.test.ts`, `ui/src/ui/capability/ai-workforce-governance/evolution-lineage.ts`, `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts`, `ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts`, `ui/src/ui/capability/ai-workforce-governance/pages/evolution-lineage-panel.browser.test.ts` · since: 2026-09-30

## 接管记录

`## Agents` 由 `pnpm loom derive` 从 `.loom/registry.yaml` 生成，registry 是唯一来源。

- Loom task：`ui-browser-test-infrastructure:kiro-ui-browser-infra`，2026-09-29 人工决定新建，2026-09-30 登记。owner `kiro-ui-browser-infra`，session `aa62b56b-5876-4eb4-a6bb-8c0041a7b715` · ide: kiro。
- 2026-09-30 path handoff：`ui/vitest.config.ts` from `diagnosis-evolution-decision-surfaces` to `ui-browser-test-infrastructure`。该文件的 `node:crypto` alias 由 Decision Surface 任务在 #218 紧急修复；原任务的 sessions 与提交记录不变，不登记 sharedPaths。
- 2026-09-30 verified path takeover：`ui/src/ui/capability/ai-workforce-governance/evolution-lineage.ts` from `openbot-evolution-unification:cursor-evolution` to `ui-browser-test-infrastructure`（2026-09-29 人工批准，原任务最后信号 2026-09-11）。接管前核对：两个 GitHub 仓库都没有涉及该文件的开放 PR；本 worktree 之外唯一的本地副本（整树暂存的快照 clone `openbot-p5-4`）与 `origin/main` 相同；599 个远端分支都没有该文件的未合入改动；`origin/main` 是唯一事实源。原任务其余 37 条路径、全部 sessions 与 `ownerHistory` 不变。该文件原有一条 sharedPaths 登记（lander 为原任务），随接管移除，其余 6 条 lineage sharedPaths 不变；没有新增 sharedPaths。#224 合入（`125027049`）。
- 2026-09-30 verified path takeover：`ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts` from `enterprise-overview-redesign:cursor-fable` to `ui-browser-test-infrastructure`（2026-09-30 人工批准，原任务没有任何 session 记录）。接管前核对：两个 GitHub 仓库都没有涉及该文件的开放 PR；本 worktree 之外唯一的本地副本（快照 clone `openbot-p5-4`）等于 main 的旧版本；有未合入改动的分支只有 `cursor-grok/identity-usage-grant`（该文件版本就是 #1182 合入的版本）与 `release/candidate-20260712`（PR #46 已于 2026-08-07 关闭）；`origin/main` 是唯一事实源。原任务其余 6 条路径与 metadata 不变；该文件没有 sharedPaths 登记，也没有新增。#226 合入（`52ca9c7a0`）。
- 2026-09-30 verified path takeover（只含测试文件，人工批准）：`ui/src/ui/capability/ai-workforce-governance/pages/evolution-lineage-panel.browser.test.ts` from `openbot-evolution-unification:cursor-evolution`；`ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts` 此前没有任务认领，直接登记。接管前核对（两个文件相同）：两个 GitHub 仓库都没有涉及它们的开放 PR；本 worktree 之外唯一的本地副本（快照 clone `openbot-p5-4`）与 `origin/main` 相同；601 个远端分支都没有它们的未合入改动；`origin/main` 是唯一事实源。原任务其余 36 条路径、全部 sessions 与 `ownerHistory` 不变；lineage 面板测试原有一条 sharedPaths 登记（lander 为原任务），随接管移除，其余 5 条 lineage sharedPaths 不变；没有新增 sharedPaths。

每个提交 trailers：

```
Task: ui-browser-test-infrastructure
Agent: kiro-ui-browser-infra
```

## 任务

- [x] **U1** 建立任务：登记 Loom task 与 session，接收 `ui/vitest.config.ts`，单文件接管 `evolution-lineage.ts` — kiro-ui-browser-infra
- [x] **U2**（D3.4.2，前置 A）`evolution-lineage.ts` 的运行时值改从 `packages/evolution-core/src/capsule-eligibility.ts` 导入，不经 `@openbot/evolution-core` 根入口，也不给 Vite / Vitest 配置根 barrel alias。守卫测试 `ui/src/ui/browser-runtime-imports.node.test.ts`：浏览器代码不经根入口导入运行时值；浏览器代码触达的 evolution-core 模块不导入 Node 内置模块或根 barrel；UI 的 Vite / Vitest 配置不提到根入口。修复前失败，修复后通过（#224，`125027049`） — kiro-ui-browser-infra
- [x] **U3**（D3.4.3，前置 B）`enterprise-surfaces.browser.test.ts` 的组织名录导入用例改用浏览器原生 `File`，不再 `await import("node:buffer")`；不加 Buffer polyfill，不改生产代码，不跳过测试。该文件在 chromium 中 84 / 84 通过；浏览器测试不再导入任何 `node:` 模块 — kiro-ui-browser-infra
- [x] **U4**（D3.4.4）#226 合入后在 main（`52ca9c7a0`）上跑全量浏览器测试，冷、热缓存各一次：依赖扫描失败、中途刷新、导入失败都是 0；681 个用例，冷 651 通过 / 29 失败，热 652 通过 / 28 失败，差别只有轮次间翻转的 `platform/advanced/page` devices 页签；企业端 14 个浏览器测试文件全部通过；两个 lineage 文件 7 个失败（U5） — kiro-ui-browser-infra
- [x] **U5**（D3.4 签收前置）两个 lineage 浏览器测试（`actions-page` 3、`evolution-lineage-panel` 4）单文件接管后修复：`vi.mock` 在 chromium 中不生效，改用现有 `setGovernanceApiClient` 注入 Gateway 替身，组件走真实的 governanceApi 函数，测试断言每个动作发出的 RPC 方法与参数；替身收到未预期的方法即判失败。每个测试开始时确认没有已连接的 client，结束后恢复为 null：governanceApi 没有 getter，但它的初始 client 是 null，这两个文件导入的模块都不设置它。仍在 chromium 中运行，不跳过、不降级；不改 `governanceApi.ts`、组件、Gateway、Adapter 或运行门。7 / 7 通过（main 上 7 个全失败）；对两个组件做的四处临时变异与去掉 client 恢复都被捕获，随后还原 — kiro-ui-browser-infra
- [x] **U6**（D3.4 联合验收输入）U5（#228）重绑 main `f6a2e255a` 后 squash 合入（`e82c99d11`）。随后在 main `e82c99d11` 上跑全量浏览器测试 `pnpm --dir ui test`，冷、热各一次：`TMPDIR` 指向新的空目录，用独立的优化缓存，不碰共享缓存。冷、热两轮：依赖扫描失败、中途刷新、导入失败都是 0；681 个用例，都是 659 通过 / 21 失败 / 1 跳过，失败集合相同；lineage 两个文件 7 / 7 通过；企业端 14 个浏览器测试文件全部通过。同时段合入前基线（同一 main，两个 lineage 测试换回 #228 之前的版本，另一个独立缓存）：冷 652 通过 / 28 失败，热 650 通过 / 30 失败。基线稳定通过、U6 稳定失败的用例 0 个；#228 新增稳定失败 0 个，修掉 7 个；U6 的 21 个稳定失败在基线中同样稳定失败。D3.4 code-present 据此于 2026-09-30 签收（#221，`8b62ae816`） — kiro-ui-browser-infra

## 已知问题（不属于本任务文件）

- 轮次间翻转的用例：`platform/pricing/page` 与 `plan-detail-edit` 的中文断言、`platform/advanced/page` devices 页签、`knowledge-universe-graph-canvas` 的 i18n 边标签、`knowledge-universe-home-cockpit` 的两个截图、`pricing-v3-layout` 的 900px 宿主用例。与本任务的改动无关。
- 冷、热都失败的既有用例（21 个）：`navigation`（4）、`port-shells`（4）、`pricing-v3-layout`（6），以及 `platform-sidebar-routing`、`chat-image-open`、`brand-assets`、`public-home`、`auth-home`、`employee-model-access-section`、`knowledge-universe-local-folder` 各 1。其中 `navigation`、`port-shells`、`platform-sidebar-routing`、`chat-image-open` 是 #218 恢复加载后首次暴露的。
