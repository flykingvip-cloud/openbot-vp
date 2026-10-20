# Implementation Plan: enterprise-mesh-navigation-repair

## Agents

- kiro-mesh-navigation · role: owner · scope: enterprise-mesh-navigation-repair · paths: `.kiro/specs/enterprise-mesh-navigation-repair/**`, `ui/src/ui/navigation.browser.test.ts` · since: 2026-09-30

## 接管记录

`## Agents` 由 `pnpm loom derive` 从 `.loom/registry.yaml` 生成，registry 是唯一来源。

- Loom task：`enterprise-mesh-navigation-repair:kiro-mesh-navigation`，即 D3.R1。2026-09-30 在 #221 的 D3.4 最终签收评论中人工决定新建，同日登记。owner `kiro-mesh-navigation`，session `87ecf61b-8114-4e8e-863a-3f57a4867adb` · ide: kiro。
- 2026-09-30 verified path takeover（只含测试文件，人工批准）：`ui/src/ui/navigation.browser.test.ts` from `builder-decommission:cursor-builder`（owner `codex-platform-manifest-compat`，唯一 session 最后信号 2026-07-23）。接管前核对，2026-10-01 在 `origin/main`（`aa743f014`）上复核结果相同：两个 GitHub 仓库的开放 PR（各 5 个）都不涉及该文件；本 worktree 之外唯一的本地副本（整树暂存的快照 clone `openbot-p5-4`）与 `origin/main` 相同；610 个远端分支都没有该文件的未合入改动；`old/main` 是 `origin/main` 的祖先，该文件版本相同；`origin/main` 是唯一事实源。原任务其余 8 条路径、session 与 `ownerHistory` 不变；landing stream `OPSD` 中该文件的条目不变；该文件没有 sharedPaths 登记，也没有新增。
- `.kiro/specs/builder-decommission/tasks.md` 的旧版 `## Agents` 行仍列出该文件，所以 `LOOM_FORCE_LEGACY=1` 的旧版归属会同时列出 `cursor-builder` 与 `kiro-mesh-navigation`。该 spec 不在本任务路径内，未修改；registry 归属只有 `kiro-mesh-navigation`。U3 接管 `enterprise-surfaces.browser.test.ts` 后也是这种情况。

每个提交 trailers：

```
Task: enterprise-mesh-navigation-repair
Agent: kiro-mesh-navigation
```

## 诊断

结论：两条断言过期。企业 Mesh 的路由与渲染都正确，只有文案匹配失败。没有涉及的生产文件，不扩大 ownership。

- 症状：main（`8b62ae816`；`aa743f014` 只改 Android 与 CHANGELOG）上 `pnpm --dir ui test src/ui/navigation.browser.test.ts`（chromium，独立缓存）49 个用例 4 个失败。两个 Mesh 用例都报 `expected '…' to match /机巢|AI Mesh/`（main 上 `ui/src/ui/navigation.browser.test.ts:452`、`:490`），同一用例中 `app.tab` 与 pathname 的断言都通过。实际的 `app.textContent` 含两处 "Mesh Governance"（左侧导航与 Mesh 模块页眉），不含「机巢」或 "AI Mesh"。失败截图中 Mesh 页面完整渲染；深链用例中协作组 `support` 的只读详情已经打开。
- 测试以英文运行（`beforeEach` 中 `i18n.setLocale("en")`）。`nav.items.enterpriseMesh` 与 `tabs.enterpriseMesh` 的英文都是 "Mesh Governance"（`ui/src/i18n/locales/en.ts:45`、`:1483`），中文都是「机巢治理」（`ui/src/i18n/locales/zh-CN.ts:45`、`:1429`），自 `2f8626483`（2026-05-28）起没有变过。`en.ts` 不含「机巢」；"AI Mesh" 在任何 ref 的产品代码中都没有出现过，只出现在这两条断言里。
- 根因：`0df166521`（2026-08-03，Task `enterprise-org-ui`，Agent `cursor-grok`）把两条匹配从 `/机巢治理|Mesh Governance/` 收紧为 `/机巢|AI Mesh/`，没有同步改 locale。此后在英文下还能通过，只靠 Mesh 页面 light DOM 中的一段硬编码中文：员工覆盖 KPI 卡的说明「当前企业内已纳入机巢治理视野的员工。」（该提交中 `enterprise-mesh-governance-surface.ts:2440`）。该路由上其他硬编码的「机巢」文案都在 `governance-assets-page` 内，它渲染到自己的 shadow root，不计入 `app.textContent`（应用本身渲染到 light DOM，`ui/src/ui/app.ts:1661`）。这一点来自源码核对，没有检出旧提交运行。
- 触发：`22d7eab7c`（#661，2026-08-27；子提交「mesh governance uses module header + baseline KPI grid」，Task `enterprise-overview-redesign`，Agent `cursor-fable`）把 KPI 卡换成共享的 `renderEnterpriseKpiGrid`，去掉了说明文字。这是有意的界面改动，也是 main first-parent 上第一个不含该文案的提交；#661 没有改这个测试文件。现在 Mesh 页面中的「机巢」只剩 aria-label 与注释，模块页眉渲染 `t("tabs.enterpriseMesh")`（`ui/src/ui/ports/enterprise/views/enterprise-mesh-governance-surface.ts:2833`）。

## 任务

- [x] **R1** 建立任务：登记 Loom task 与 session，按接管记录核对后单文件接管 `ui/src/ui/navigation.browser.test.ts` — kiro-mesh-navigation
- [x] **R2** 诊断：症状、根因与涉及文件见上节。只涉及测试文件，不改生产代码 — kiro-mesh-navigation
- [x] **R3** 只改测试文件。新增 `expectMeshSurfaceTitle`：按当前 locale 取 `tabs.enterpriseMesh`，先确认该 key 能解析，再断言 Mesh 页面自己的模块页眉（`.enterprise-surface--mesh > .enterprise-module-header .enterprise-page__title`）文字与之相等。原来的整页匹配只靠左侧导航的同名文字也能通过，即使 Mesh 页面没有渲染。两个用例都改用它；深链用例另外断言 Mesh 页面中的 `governance-assets-page` 在其 shadow root 内打开协作组 `support` 的只读详情（`role="dialog"`、`aria-label="机巢只读详情"`）。仍在 chromium 中运行，不跳过、不放宽。修复前该文件 4 失败 / 45 通过；修复后独立缓存连跑 3 次，都是 2 失败 / 47 通过，两个 Mesh 用例都通过。两处临时变异都被捕获，随后还原，与 HEAD 逐字节相同：Mesh 页眉改用 `tabs.enterpriseOverview` 时两个用例都失败（`expected 'Enterprise Overview' to be 'Mesh Governance'`）；assets-page 不打开深链详情时深链用例失败（`read-only drawer for the deep-linked group: expected null not to be null`），导航用例仍通过 — kiro-mesh-navigation
- [x] **R4** 合入后在 main 上复跑该文件：#245 于 2026-10-01 squash 合入（`9b87c82f3`；landed 与 source `b650fb587` 的 tree 相同）。main `9b87c82f3` 上用独立缓存冷、热各跑一次，都是 2 失败 / 47 通过，两个 Mesh 用例都通过；依赖扫描失败、中途刷新、导入失败都是 0。父规格的 D3.R1 同步关闭 — kiro-mesh-navigation

## 已知问题（不属于 D3.R1）

- 同一文件另有两个既有失败，修复前后失败信息相同，本任务未处理：「renders the workbench home shell without the legacy sidebar nav」（`expected null not to be null`）与「preserves the platform route instead of falling back to the employee home」（`expected undefined to be '平台总览'`）。2026-10-01 人工决定另开任务处理：`navigation-shell-tests-repair:kiro-nav-shells`，该测试文件随之转交。
- 产品命名：`docs/design/robot-workspace-mesh-phase-1-acceptance-2026-08-02.md` 记录 `enterpriseMesh` 改为「机巢」/「AI Mesh」、导航标题为「机巢」，但 locale 从未这样改过。是否改名是产品决定，还需要 locale 文件的 ownership；新断言跟随 locale，改名后测试不必再改。2026-10-01 人工决定交给 `mesh-naming-truth-sync:kiro-mesh-naming` 处理。
