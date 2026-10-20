# Implementation Plan: navigation-shell-tests-repair

## Agents

- kiro-nav-shells · role: owner · scope: navigation-shell-tests-repair · paths: `.kiro/specs/navigation-shell-tests-repair/**`, `ui/src/ui/navigation.browser.test.ts` · since: 2026-10-01

## 接管记录

`## Agents` 由 `pnpm loom derive` 从 `.loom/registry.yaml` 生成，registry 是唯一来源。

- Loom task：`navigation-shell-tests-repair:kiro-nav-shells`。2026-10-01 D3.R1 关闭时人工决定，同一文件剩下的两个失败另开任务处理。owner `kiro-nav-shells`，session `7d8472c2-d8c4-4cd3-ac7c-3a983eef6ad3` · ide: kiro。
- 2026-10-01 verified path takeover（只含测试文件，人工批准）：`ui/src/ui/navigation.browser.test.ts` from `enterprise-mesh-navigation-repair:kiro-mesh-navigation`。原任务的 R1–R4 都已完成（#245、#251），同时改为 `landed`，其 session 标为 `done`。landed 任务不再参与归属与 overlap 检查，原任务的 paths 原样保留作为历史。
- 接管前核对（`origin/main` `a6818b3fa`）：两个 GitHub 仓库的开放 PR（7 个、5 个）都不涉及该文件。本 worktree 之外唯一的本地副本（快照 clone `openbot-p5-4`）是 #245 之前的旧版本，不是在途改动。622 个远端分支都没有该文件的未合入改动。`old/main` 是 `origin/main` 的祖先，其中该文件仍是 #245 之前的版本。`origin/main` 是唯一事实源。landing stream `OPSD` 中该文件的条目不变；没有 sharedPaths。

每个提交 trailers：

```
Task: navigation-shell-tests-repair
Agent: kiro-nav-shells
```

## 诊断

结论：两个用例在懒加载的外壳就绪前就断言。路由与渲染都正确，只改测试文件；没有涉及的生产文件。

- 症状：main（`a6818b3fa`）上 `pnpm --dir ui test src/ui/navigation.browser.test.ts`（chromium，独立缓存）49 个用例 2 个失败。
  - 「renders the workbench home shell without the legacy sidebar nav」：`.shell--workspace` 存在，`.employee-workbench` 不存在（`expected null not to be null`）。失败截图在断言之后才拍，那时工作台已经出现。
  - 「preserves the platform route instead of falling back to the employee home」：`app.tab` 与 pathname 都正确，`.platform-surface-header__title` 不存在（`expected undefined to be '平台总览'`）。失败截图中是加载占位「正在加载平台控制台…」。这条断言之后的断言此前从未执行过。
- 根因：gmood2008/openbot#218（`4d1e6ab4c`，2026-08-07）把员工工作台与平台外壳改为懒加载（`ui/src/ui/ports/cross-port-shell-lazy.ts`）。chunk 加载完成前，`ui/src/ui/app-render.ts` 渲染加载占位（`renderCrossPortShellLoadingPlaceholder`，:1772、:1789），加载完成后经 `subscribeCrossPortShellReady` 重渲染（`ui/src/ui/app.ts:1672`）。这两个用例在挂载后只等第一次 `updateComplete` 就断言。在 `9b87c82f3` 上用临时探针（未提交）测得：第一次更新时只有占位；工作台约 388 ms 后出现，平台页眉约 221 ms 后出现。该 PR 没有改这个测试文件。
- 顺序依赖：chunk 缓存在模块级，一旦某个用例触发的加载完成，后面的用例都能直接拿到。所以哪些用例失败取决于顺序与时序：只有在加载完成之前就检查外壳内容的用例会失败。按文件顺序是这两个；main 上单独运行「renders the workbench home with the employee workbench sidebar」也失败。在 `696f0fc19` 上随机顺序（`--sequence.shuffle`，seed 1–3）每次失败 2 个，三次的组合各不相同，涉及「renders the workbench sidebar with its own scroll area」「auto-scrolls chat history to the latest message」「keeps workbench chat usable on narrow viewports」。
- 另一个影响（源码核对，`ui/src/ui/app-render.ts:1154`、:1769–1772）：chunk 未加载时，路由即使错误回退到员工首页，渲染的也是占位而不是工作台，所以「员工工作台不存在」一类断言照样通过。

## 任务

- [x] **N1** 建立任务：登记 Loom task 与 session，按接管记录核对后单文件接管 `ui/src/ui/navigation.browser.test.ts`，原任务改为 `landed` — kiro-nav-shells
- [x] **N2** 诊断：见上节。只涉及测试文件，不改生产代码 — kiro-nav-shells
- [x] **N3** 只改测试文件：新增 `beforeAll`，在任何用例运行前加载员工工作台与平台外壳两个懒加载 chunk（`preloadEmployeeWorkbenchBundle`、`preloadPlatformPortBundle`）。用例本身不改，仍在 chromium 中运行，不跳过、不放宽。main `a6818b3fa` 上：修复前 2 失败 / 47 通过，修复后 49 / 49 通过；「preserves the platform route…」中原本从未执行的后续断言（共享顶栏、平台导航树与导航文字）现在也都通过；两个目标用例与「renders the workbench home with the employee workbench sidebar」单独运行都通过（修复前后者单独运行失败）；随机顺序 seed 1–3 都是 49 / 49。在 `696f0fc19` 上做了两处临时变异，都被捕获，随后还原，与 HEAD 逐字节相同：工作台根节点去掉 `employee-workbench` class 时「renders the workbench home shell…」失败（`expected null not to be null`）；平台页眉标题多一个字符时「preserves the platform route…」失败（`expected '平台总览·' to be '平台总览'`） — kiro-nav-shells
- [x] **N4** 合入后在 main 上复跑该文件：#254 于 2026-10-01 squash 合入（`5f943a00e`；landed 与 source `b03a39e75` 的 tree 相同），#257 随后合入。在 main `9ae1fb8de` 上用独立缓存冷、热各跑一次，都是 49 / 49 通过；依赖扫描失败、中途刷新、导入失败都是 0。本任务随之改为 `landed` — kiro-nav-shells

## 已知问题（不属于本任务文件）

- `ui/src/ui/platform-sidebar-routing.browser.test.ts`（1 个失败：`platform surface should be rendered: expected null not to be null`）也经共享的 `ui/src/ui/test-helpers/app-mount.ts` 挂载整个应用，并在 `updateComplete` 后断言平台外壳，可能同因，未核实。该文件与 `app-mount.ts` 都没有任务认领。
- `ui/src/ui/ports/port-shells.browser.test.ts`（4 个失败）直接调用 `renderPlatformPortShell`，不经懒加载，与本根因无关，未调查。归 `ops-decommission:codex-opsd` 与 `platform-tenant-management-ia:cursor-tenant-ia`。
- 以上是否处理待人决定。加载占位本身没有测试覆盖。
