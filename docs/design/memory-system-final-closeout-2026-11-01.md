# 记忆系统最终收尾（2026-11-01）

| 字段               | 值                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 负责人             | 记忆系统收尾 / Grok Bot 云端执行                                                                                                              |
| 文档 ID            | `memory-system-final-closeout-2026-11-01`                                                                                                     |
| 证据目录           | `docs/design/evidence/memory-system-final-closeout-2026-11-01/`                                                                               |
| 验收代码 SHA       | `72a042332a5b0f3e630a7f916390f730be5e92e0`（门禁与隔离测试在此树上执行）                                                                      |
| 推送时 origin/main | `ea7f9218889ac9ca3d280d15cc14736149af369f`（#181）。`72a04233` 是它的祖先。其间无 memory 产品差异，只有 registry                              |
| 变基               | 收尾提交接到该 tip。未在新 tip 重跑全套门禁                                                                                                   |
| 验收时区           | **用户时区 Europe/Berlin**（CET, +0100）。文中 Asia/Shanghai / +0800 时间戳来自 Mac/box 机器时钟（可保留作溯源），不是用户时区；ISO UTC 另标 |
| 对照时刻           | Berlin `2026-11-01 12:39:43 CET` = Shanghai `2026-11-01 19:39:43 CST`                                                                         |
| 分支               | `cursor/memory-final-closeout-afe1`（只加收尾文档与隔离探针；不改产品行为）                                                                   |
| 本轮不做           | 合并、部署、切流、改生产、真实用户记忆写入/删除/遗忘/重建索引、默认开启 QMD / cloudSync / privateMemoryPromote、为过测试放宽类型或 ACL 或门闩 |

## 接管说明

从当时的 `origin/main` 开分支做核验与起草。开写前工作区干净，没有改他人未提交文件。历史待审只按**已合入提交**和**本轮验收命令**更新，不把首批 O1/O2/O3、O5 文案、O8 脚手架标回未完成。

已撤回、不得再当遗忘缺陷的证据：旧测试里两文件同短语、删 A 仍搜到 B。那是另一来源仍有效，不是同一来源残留。

`c8e96388ea932d0158cf3c77a565b7d8ee6ae965` 仍是首批审核锚点，且是本验收 SHA 的祖先。该锚点上曾经的 `pnpm tsgo` / `pnpm check` exit 0 **不能**外推成「之后 main 持续全绿」或「已部署」。本轮在验收 SHA 上重新跑门禁，结果见 §4。

云端限制：未执行本机 `pnpm loom register`，也没有本机网关身份或真实用户会话。这两项记 **not-run**，不记通过。

## 1. 环境与安装

| 项                   | 值                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Node                 | v22.23.4（`package.json` engines `>=22.12.0`）                                            |
| pnpm                 | 10.23.0（`packageManager`: `pnpm@10.23.0`）                                               |
| 锁文件               | `pnpm-lock.yaml` lockfileVersion 9.0                                                      |
| 安装                 | `CI=true pnpm install --frozen-lockfile`                                                  |
| 安装结果             | exit **0**。Berlin `2026-11-01T12:41:38+0100` 起，约 2.1s。日志：`pnpm-install.log`       |
| workspace            | 56 个。`extensions/memory-core` 的 `@upbeyond/openbot` 链接到仓库根，非断链               |
| 无依赖扩展           | `discord` 等 11 个扩展 `dependencies` 为空，因此没有自己的 `node_modules`。这不是残缺链接 |
| 断链                 | `node_modules` 顶层与 `extensions` 下 dangling symlink 计数为 0                           |
| 默认后端             | `src/memory/backend-config.ts` `DEFAULT_BACKEND = "builtin"`                              |
| cloudSync            | `resolveCogniWeaveCloudSync`：`enabled: raw?.enabled === true`，缺省关                    |
| privateMemoryPromote | `private-memory-promote-entry.ts` 写明默认关。本轮未改该默认                              |
| QMD                  | 仅当 `memory.backend=qmd`。缺省不是 QMD                                                   |

`manager.search` 会写：CogniWeave `search` 先 `syncScope`（`cogniweave-manager.ts`）；builtin `search` 在 dirty 时会 `scheduleAuthorizedSearchSync`（`manager.ts`）。本轮额外探针**没有**调用 search。效果矩阵里的 `EFF-RECALL-1` 沿用既有 harness，会走 manager search，证据层是 manager-integration，不是生产写入。

## 2. 已合入关系

下列 merge commit 全部 `git merge-base --is-ancestor <sha> 72a04233` 成功。

| PR          | merge SHA                                  | 标题要点                                   |
| ----------- | ------------------------------------------ | ------------------------------------------ |
| #92         | `2ab8f34aa9e1f3ee2945b385a378fe5fa2006df9` | collab heartbeat / Mode B / handoff refuse |
| #93         | `3bc9f7fff3a19ebfd79bf550ffb6b29352854252` | check-recovery                             |
| #96         | `f792827f2b40d54273f6e547aaf1059449f83c6d` | O5 文案 + forget 隔离                      |
| #97         | `71adcc07069fc3c7de24e2c902a21d87822d6b10` | O1/O2/O3 + O8 harness                      |
| #104        | `2010b6f8d7ae7ff0ec01f65f0e4bf91169cdbfda` | 恢复 trunk tsgo/check                      |
| #105        | `80c20e19e41ad8f921d06d3bace6145b1326910e` | wake-op tenant mock                        |
| #106        | `c8e96388ea932d0158cf3c77a565b7d8ee6ae965` | 首批审核锚点                               |
| #108        | `5fb3cf92f1b8e5d73c818270134887ad67c6e136` | O4 只读 + 候选视图接线                     |
| #114        | `b72b5764ada914c200e0e7bf6571f78c1a388cae` | DS path1                                   |
| #116        | `99f19a46449acd89a02f781df50fbc1c36629460` | 效果矩阵 harness                           |
| #118 / #119 | `637905f2` / `f32f2bcf`                    | 矩阵文档格式                               |
| #121        | `8ab441ed52446f8fd77f344f3fa3117810af16e8` | soft forget MVP                            |
| #156        | `3cab9055af18941ed38f1ce0344531e06568436e` | safe-continuity FTS + authz                |
| #157        | `3a391742f2603bc80d42ad3d4258e047224da352` | memory-core 身份转发 + HTTP/e2e            |

历史文档点名的 `src/memory/memory-batch1-o4-o5-diagnose.test.ts` 在本验收 SHA 的 git 历史中不存在。O4/O5 的现行测试是 `memory-center-o4-readonly.test.ts`、`memory-effect-acceptance-matrix.test.ts`、`memory-forget-gateway-isolation.test.ts`。不把缺文件当成遗忘缺陷复现。

## 3. 唯一收尾状态表

字段约定：「合入」= merge commit 是验收 SHA 的祖先。「隔离测试」= 本轮在合成/临时根上的命令结果，not-run 不计通过。「已部署」= 运行容器 build-info 含该提交。「用户效果」= 真实模型在合成环境里采用记忆，mock 不算。

| 项                   | 成文契约                                                                                           | 代码 / PR                                                                                         | 测试适用面                                                                                          | 本轮验证                                                                                                                    | 未覆盖                                                                              | 合入              | 隔离测试                         | 已部署          | 用户效果 | 结论                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------- | -------------------------------- | --------------- | -------- | --------------------------------------------------------------- |
| O1 健康探针          | 优化方案 Step 2；存储可读 ≠ 后端健康；无检索证据则 search=unknown                                  | #97；`src/memory/health-probe.ts`                                                                 | cogniweave/builtin/qmd 只读探针；无网关                                                             | health-probe\* 全绿                                                                                                         | 生产健康报告                                                                        | 是                | 通过                             | 否              | not-run  | **已关闭**（首批可观测性）                                      |
| O2 审计空 Markdown   | 实施记录 §4；不发明 `memoryScope`                                                                  | #97；`scripts/memory-platform-audit.mjs`                                                          | 隔离配置 + 真实脚本 spawn                                                                           | `memory-platform-audit.o2.test.ts` 10 通过                                                                                  | 生产审计                                                                            | 是                | 通过                             | 否              | not-run  | **已关闭**（首批）                                              |
| O3 ACL 测试契约      | 绑定后 queryAtoms；错主 fail-closed                                                                | #97；`query-atoms-acl.test.ts`                                                                    | SDK/manager；mock 身份                                                                              | 4 通过；矩阵 EFF-ACL-1/2 通过                                                                                               | 生产主体                                                                            | 是                | 通过                             | 否              | not-run  | **已关闭**（首批测试契约）                                      |
| O5 文案              | 按钮「删除此记忆文件」；不承诺立刻停止全部召回                                                     | #96；Memory Center / 数据目录                                                                     | UI node 渲染                                                                                        | UI 12 通过，含该文案                                                                                                        | 不重开「删 A 留 B」                                                                 | 是                | 通过                             | 否              | not-run  | **已关闭**（文案）。缺陷判断维持撤回                            |
| O8 分层基线          | passed/failed/not-run；not-run 不进 passed                                                         | #97；`memory-batch1-o8-baseline-v3.test.ts`                                                       | 隔离 harness                                                                                        | 3 通过                                                                                                                      | 模型/生产。套件与矩阵重叠，不可相加当样本量                                         | 是                | 通过                             | 否              | not-run  | **已关闭**（脚手架）。不等于效果验收                            |
| O4 只读              | 默认 active；候选仅 tentative；过滤先于 limit；total 对齐；不晋升、不自动绑定、不隐式迁移          | #108；`memory-center-o4-readonly.ts`；设计 §12                                                    | embedded SQLite；mock 身份。非 postgres/REST                                                        | readonly 9 通过：limit/total、错主不写绑定、重复读与跨进程重开 hash 不变、旧 schema 不迁移                                  | 真实连接认证全链（设计写明不声称）                                                  | 是                | 通过                             | 否              | not-run  | **已关闭**（只读基础）                                          |
| 候选视图             | 已确认 / 候选（待确认）徽章与空态；精确 `statusView`                                               | #108；`memory-center-page.ts`；`memory-list-o4-status-view.test.ts`                               | UI node + gateway handler mock                                                                      | UI 12 通过（徽章、两种空态）；gateway statusView 4 通过                                                                     | 浏览器手工点选；生产 UI                                                             | 是                | 通过                             | 否              | not-run  | **已关闭**（接线）。无晋升                                      |
| DS path1 同源        | list/forget 只认 workspace `MEMORY.md`/`memory.md`/`memory/**/*.md`，不再以 DS `memory/agent` 为根 | #114；`src/data/memory-list.ts`                                                                   | cogniweave 隔离 + path1 helper                                                                      | 矩阵 EFF-LIST-1、EFF-FORGET-PATH1-1/2、EFF-MULTI-1 通过；`memory-fact-forget` 单文件删除通过                                | 历史 DS 文件迁移（契约明确不做）                                                    | 是                | 通过                             | 否              | not-run  | **已关闭**（管理面收敛）                                        |
| soft forget MVP      | factRef=atomId；soft-forget live sources；默认不 purge；幂等；拒绝无副作用                         | #121；`memory-fact-forget.ts`；`data.memory.forgetFact`                                           | SDK in-memory；manager 隔离；gateway handler（managed/enterprise/错主 mock，成功路径 mock manager） | 事实遗忘 5 通过；gateway 4 通过。探针：同一 operationId 重放仍 forgotten；第二次 operation 影响对象数 0；未 purge           | **重启后** sqlite 仍 forgotten：本轮 not-run。不称为物理删除                        | 是                | 通过（重启除外）                 | 否              | not-run  | **已关闭**（MVP soft）。重启记未覆盖，不升格成效果关闭          |
| DM 连续记忆          | builtin 索引 workspace memory；跨主体读不到；子进程真实 token                                      | #156 + #157；`test/memory-continuity-gateway.e2e.test.ts`                                         | builtin；DM；子进程真 token。embedding mock 只在工具层单测                                          | acceptance DM 通过；HTTP DM 通过（注入身份）；e2e 1 通过（真 token，约 12.6s）                                              | 真模型是否把 DM 事实写进回答                                                        | 是                | 通过                             | 否              | not-run  | **已关闭**（DM 工具/HTTP/子进程检索）。效果另列                 |
| 群协作记忆与成员撤销 | members.json；非成员/撤销/跨租户不泄露正文                                                         | #156 工具层；#157 HTTP 注入                                                                       | 工具层真 members.json；HTTP **注入身份**；不是子进程真认证                                          | acceptance 群组用例通过；HTTP 集成 2 通过                                                                                   | **子进程群组真认证**（platform-auth / trusted-proxy）仍是缺口。注入测试不得把它关闭 | 是                | 注入身份通过；子进程群组 not-run | 否              | not-run  | **已关闭**（工具层 + HTTP 注入）。子进程群组真认证 **明确延期** |
| 学习批准/注入/撤销   | candidate 不注入；批准后才进入 recall；撤销后停止。`privateMemoryPromote` 默认关                   | #156；`memory-continuity-acceptance.test.ts` 学习环；`personal-learning-ownership.test.ts`        | 隔离 state；个人 scope `agent:<botId>`；群胶囊存储                                                  | acceptance 学习环通过；ownership 4 通过                                                                                     | 未批准学习是否被模型采用（见效果行）                                                | 是                | 通过                             | 否              | not-run  | **已关闭**（召回门）。不等于模型采用                            |
| 更新与冲突           | 优化方案 S2：真更新后不沿用旧事实；冲突可解释                                                      | SDK `supersedeAtom` 会把旧原子标 deprecated。`detectConflicts` 只读列出 `conflictsWith`，不改状态 | 本轮探针：in-memory SDK。两个原子先以 **active** 写入，再调用 `supersedeAtom`                       | 探针 exit 0。默认 `queryAtoms` 之后只剩新事实 `FACT-NEW-CLOSEOUT-20261101`；旧事实不再命中。错主命中 0 且状态未被拒绝读改写 | 没有产品级「冲突生成」入口。不把预置 conflicted 行当本轮更新。模型是否改口：not-run | 引擎 API 已在主干 | SDK 通过                         | 否              | not-run  | **已关闭**（SDK 真 supersede）。产品冲突流 **明确延期**         |
| 完整模型正确采用     | 优化方案 §4：回答正确采用 ≠ 召回命中 ≠ reuseCount                                                  | 无本轮产品改动                                                                                    | DeepSeek 合成隔离；pinned `3460ef9fa…`；state `/private/tmp/openbot-closeout-model-effect-3460ef9fa/` | **限定范围通过×6**（`model-effect-six-scenarios-deepseek.json`；见覆盖限制）                                               | 整体模型效果层 / 生产验收；S2 相关过滤；S3 产品冲突入口；S5 soft forget/重启         | 是                | 六场景限定范围通过               | 否              | scoped   | **仅本次六场景合成可关**（≠ 整体模型效果 / production）         |
| 当前部署与运行版本   | 以运行容器 `build-info` 为准，不以 git 日期为准                                                    | 验收 SHA 是源码 tip，不是已证明的运行 tip                                                         | 本云端无 podman/docker、无监听网关、无 `~/.openbot`                                                 | **not-run**                                                                                                                 | 线上 SHA、后端与开关摘要、健康报告实读                                              | 源码已在 main     | 不适用                           | **否 / 不可达** | not-run  | **阻塞**（运行未生效）                                          |
| O6 reuseCount        | 不接通自增、不废弃、不改权重；不可用于效果评估                                                     | 方案 D1；本轮无实现 PR                                                                            | 无                                                                                                  | 未改代码                                                                                                                    | 仪表盘文案若仍未落地，保持暂缓                                                      | 否                | not-run                          | 否              | not-run  | **明确延期**                                                    |
| O7 相关性过滤        | 先离线评估；默认行为不变                                                                           | 方案 D2                                                                                           | 无                                                                                                  | 未改默认                                                                                                                    | 离线对照                                                                            | 否                | not-run                          | 否              | not-run  | **明确延期**                                                    |
| O9 真实云同步        | 移出本轮；默认 client 不是生产 HTTP 云同步                                                         | 方案 D3                                                                                           | 无                                                                                                  | 未实现、未开启                                                                                                              | 生产云客户端                                                                        | 否                | not-run                          | 否              | not-run  | **明确延期**                                                    |

`reuseCount`：学习侧计数是提示词构造/注入计数，不是「请求已采用」。原子 `metrics.reuseCount` 仍不可用来证明复用或效果。

## 4. 门禁与命令

均在验收 SHA `72a04233` 上执行（当时还没有收尾文档提交）。vitest 自带的 `Start at` 是 UTC；包装脚本的时间戳是 Europe/Berlin。

| 命令                                                    | exit                 | 分类                                                                                        | 证据                                       |
| ------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `CI=true pnpm install --frozen-lockfile`                | **0**                | 环境就绪                                                                                    | `pnpm-install.log`                         |
| `pnpm tsgo`                                             | **2**                | **主干既有错误**（30 条）。本轮没有为了变绿去改类型                                         | `pnpm-tsgo.log`                            |
| `pnpm check`                                            | **1**                | 停在 `oxfmt --check`。30 个文件：29 个在干净验收树上就已不通过，另加当时未格式化的收尾 JSON | `pnpm-check.log`                           |
| 只格式化本轮收尾文件后 `pnpm exec oxfmt --check`        | **1**                | 仍是主干既有 29 个文件。收尾路径已不在列表中。不改那 29 个文件                              | `pnpm-format-check-after-closeout-fmt.log` |
| 记忆 unit（19 文件 / 79 测试，`--maxWorkers=2`）        | **0**                | 本轮通过                                                                                    | `mem-closeout-tests.log`                   |
| gateway 记忆相关（6 文件 / 31 测试）                    | **0**                | 本轮通过。forget 成功用例是 handler + mock manager，不是子进程真认证                        | 同上                                       |
| UI 第一次：在仓库根用 `ui/vitest.node.config.ts`        | **1**                | **本轮工具错误**（include 相对 ui/，没有匹配到文件）。不是产品失败                          | `mem-closeout-tests.log`                   |
| UI 纠正：`ui/` 下再跑 `memory-center-page.node.test.ts` | **0**（12）          | 本轮通过                                                                                    | `mem-closeout-ui.log`                      |
| e2e `test/memory-continuity-gateway.e2e.test.ts`        | **0**（1，约 12.6s） | 子进程 **真 token**，仅 DM                                                                  | `mem-closeout-tests.log`                   |
| `tsx` 真 supersede 探针                                 | **0**                | SDK 层。未调用 search，未 purge                                                             | `real-supersede-probe.json`                |

`pnpm tsgo` 与记忆相关的主干错误（不修）：

- `extensions/memory-core/index.ts`：调用 `createMemorySearchTool` / `createMemoryGetTool` 时传入 `authenticatedUserId`，但 `src/plugins/runtime/types-core.ts` 的 `PluginMemoryToolFactory` 未声明该字段，也未声明实现侧已有的 `securityProfile`。运行时 `runtime-tools.ts` 仍把参数转给 `src/agents/tools/memory-tool.ts`，实现函数**会**读取这两个字段。这是插件工厂类型漂移，不是本轮证明转发被删掉。
- `src/memory/memory-continuity-gateway.http.integration.test.ts`：`authorize` mock 的返回类型缺 `method` / `trustedProxy`。测试仍被 vitest 跑过并 exit 0。类型红不影响这次运行结果，但门禁未绿。

其余 tsgo 错误在 bash sandbox、cron、enterprise-data、evolution-control、chat.restore、collaboration-rules-summary，与本收尾改动无关。

效果矩阵本轮复跑（`memory-effect-matrix-closeout.json`）：total 15，passed 11，failed 0，not-run 4。not-run 为 `EFF-GW-1`、`EFF-MODEL-1`、`EFF-PROD-1`、`EFF-FACT-1`。harness 仍把 `factLevelForgetProduct: false` 写进摘要，这是矩阵文件的固定声明（矩阵自己不跑事实级遗忘）。事实级 soft MVP 以 #121 与 `memory-fact-forget.test.ts` 为准，不要用这个布尔把 #121 标回未做，也不要把它当成「全来源物理删除已验收」。

## 5. 核心隔离验收对照

临时根由 `createIsolationLayout` / `applyIsolationEnv` 创建。探针在调用引擎前断言 config/state/data/workspace/sessions/tenant/协作目录都在隔离根内，并确认未设置 gateway token。未连接云同步，未读取真实凭据。

| 要求                                                   | 证据层                                                                                       | 结果                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 跨会话 / 跨工作区 DM 标记可检索，另一 workspace 读不到 | builtin manager + sync；acceptance                                                           | 通过。DM 私聊 scope 是 `agent:<agentId>`，不是按 sessionKey 切库 |
| 跨进程                                                 | 子进程 gateway，真 Bearer token，DM search/get                                               | 通过                                                             |
| 真更新（非预置 deprecated）                            | SDK `supersedeAtom`：旧/新原子都先 active                                                    | 通过。默认查询只剩 `FACT-NEW-CLOSEOUT-20261101`                  |
| 冲突                                                   | `detectConflicts` 不改状态，`conflictsWith` 仍为空                                           | **not-run** 作为产品冲突流。不把预置 conflicted 算更新           |
| O4 默认 active、候选 tentative、徽章/空态              | readonly 测试 + UI 测试                                                                      | 通过                                                             |
| 不晋升 / 不自动绑定 / 不隐式迁移                       | readonly 测试：错主不写绑定；旧 schema 版本保持；读前后 db hash 不变                         | 通过                                                             |
| 过滤先于 limit，total 对齐                             | readonly：active total 5、limit 3、truncated                                                 | 通过                                                             |
| 错主体不泄露                                           | query-atoms-acl、O4、探针错主命中 0、群组拒绝不含 marker                                     | 通过（见各层）                                                   |
| path1 同源 identity/locator                            | list 与 forget 使用 workspace 相对 key；DS `memory/agent` 不进可管理列表                     | 矩阵通过                                                         |
| 单来源删除                                             | path1 `forgetMemoryEntry` 只删所选 workspace 文件；同内容另一来源保留是契约                  | 通过。撤回证据不再使用                                           |
| soft forget 幂等 / 拒绝无副作用 / 非物理删除           | gateway 拒绝不调用 manager；探针重放 forgotten 且第二次 affected 0；manager 测试断言文件仍在 | 通过。**重启 not-run**                                           |
| 学习 candidate → 批准 → 注入 → 撤销                    | acceptance 学习环                                                                            | 通过（recall 层，不是模型）                                      |
| #157 DM 子进程真 token vs 群成员 HTTP 注入             | e2e 头注释 vs HTTP 测试头注释                                                                | 两类都复跑通过，且没有互相顶替                                   |

## 6. 真实模型效果

**结论：限定范围通过（scoped pass）** — 隔离 SDK/manager + 真实 DeepSeek 回答的一次合成验收。  
**不得**扩大为整体模型效果层关闭或生产验收通过。

本机补跑（Mac/box 时钟 Asia/Shanghai **2026-11-01T23:23+08:00**；**用户时区 Europe/Berlin**）：provider=`api-proxy-deepseek`，model=`deepseek-chat`，六场景均为**限定范围通过**（**6** 次 model HTTP 调用；调用数硬停 max=40 **未触发**）。费用证据仅支持「6 次调用；调用数硬停未触达」，**不应**写成已精确核算实际 USD 花费。禁止用 mock 或固定答案冒充——本轮为真实 DeepSeek 回答。**本轮不再重复调用模型。**

证据：`docs/design/evidence/memory-system-final-closeout-2026-11-01/model-effect-six-scenarios-deepseek.json` 与同目录 `.md` / `.driver.ts`。状态根：`/private/tmp/openbot-closeout-model-effect-3460ef9fa/`（合成隔离；**未**写真实 `~/.openbot` 用户记忆；**未**启网关、未碰 :18789/:18790/:19001）。密钥仅进程内读取，证据中为 `[REDACTED]`。

`overallModelEffectCloseable=true` 的含义见 JSON 字段 `overallModelEffectCloseableScope`：**仅**本次六场景合成运行可关，**不是**整体模型效果层 / 生产可关。

每个场景记录了：合成事实 ID、model id、提示词版本、attempt≤2、召回/片段是否进入请求、回答摘录、评分规则；正例要求 fragmentInRequest 且回答含唯一 token，负例要求请求与回答均无 token。

| 场景                 | 结果                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| 保存后新会话采用     | **限定范围通过**（DeepSeek `deepseek-chat`；fragmentInRequest + 采用 token） |
| 无关内容不乱入       | **限定范围通过**（相关采用；无关 hobby token 未出现在回答）          |
| 更新后不沿用旧事实   | **限定范围通过**（SDK `supersedeAtom` 后仅 NEW 进上下文；模型采用 NEW 非 OLD） |
| 无权限不进上下文     | **限定范围通过**（错主 ACL 空上下文；模型未采用 secret）             |
| 遗忘后不用被禁用来源 | **限定范围通过**（path1 forget 后无片段；模型未用 token）            |
| 未批准学习不采用     | **限定范围通过**（candidate 不进 recall；模型未采用；批准对照可注入） |

### 必须保留的覆盖限制（#182 材料）

1. **S2**：`irrelInRequest=true` — 通过仅表示**回答未采用无关内容**，**不**表示检索相关性过滤有效。
2. **S3**：直接调用 SDK `supersedeAtom` — 证明更新后查询与回答采用新事实，**不**代表产品入口完整冲突处理流程已验证。
3. **S5**：path1 文件删除遗忘 — **不**替代事实级 soft forget、全部来源处理、或重启后遗忘验收。

检索层已经覆盖的部分（召回、ACL、批准前不注入）不能单独填「模型正确采用」这张表；完整 gateway agent 工具循环仍未覆盖（本轮未启网关）。

## 7. 运行与部署

本轮不部署。云端虚拟机没有 podman、没有 docker、`ss` 无监听网关，因此**没有**读到任何容器 `/app/dist/build-info.json`。运行版本 **not-run**。

这直接挡住「上线阶段可以关闭」。源码在 `origin/main` 上，只能写成：研发代码已进入主干，运行未生效。

健康报告字段（代码含义，不是某次线上读数）：

- `storage`：文件或 sqlite 是否可读。cogniweave embedded 缺库可以是 `missing`。可读不等于健康。
- `backendHealth`：缺省保持 `unknown`。embedded 缺库为 `unhealthy`；配置与观察到的后端不一致为 `degraded`。存储 ready 仍可以是 `unknown`（`health-probe.ts` 约 466–488 行）。
- `search`：探针不做检索。没有检索证据时为 `unknown`，不能把 documentCount>0 写成 search 正常。
- `unknown`：证据不足时的合法结果，不是失败被藏起来，也不是健康。

最小发布清单（本轮不执行，供发布责任人）：

1. 再次 `git fetch origin main`，候选 SHA 必须等于当时的 `origin/main`。
2. 构建产物写入运行容器后，读该容器 `build-info` 的代码 SHA 与构建时间，确认包含要发布的提交。
3. 核对运行配置摘要（脱敏）：默认 backend 仍是 builtin；未默认打开 QMD、cloudSync、privateMemoryPromote。
4. 只读健康报告，按上一节解释 storage / backendHealth / search，不把 unknown 改成 ok。

## 8. 失败、not-run、延期

| 类别           | 项                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| failed（产品） | 无。本轮记忆/O4/path1/soft forget/连续记忆/权限套件没有失败断言                                                                 |
| failed（门禁） | `pnpm tsgo` exit 2；`pnpm check` exit 1。分类为主干既有，不是本收尾改坏的产品回归                                               |
| 本轮工具错误   | UI vitest 第一次在错误 cwd 下 exit 1；纠正后 exit 0                                                                             |
| not-run        | ~~六条模型场景~~（已 DeepSeek **限定范围通过**×6）；生产/运行 build-info（相对新 tip 仍须重证）；soft forget 进程重启；子进程群组真认证；O6/O7/O9；产品冲突生成；loom register；完整 gateway agent 工具循环 |
| 明确延期       | O6、O7、O9；子进程群组真认证；产品级冲突流；DS 历史文件迁入 workspace                                                           |
| 阻塞关闭上线   | 运行生效未证明（须对**当前 tip**重证，不得移用旧 SHA）+ 六场景仅为限定范围通过（≠ 整体模型效果/生产）+ 门禁以对齐后最终 tip 为准 |

## 9. 三层关闭建议

1. **研发交付：不能按「全绿可关」关闭。** 清单内功能 PR 已在验收 SHA 中。本轮隔离套件通过，首批不重开。但 `pnpm tsgo` 与 `pnpm check` 在该 SHA 上不是 exit 0，所以不能宣布研发门禁关闭。
2. **运行生效：不能关闭。** build-info 不可达。状态是「主干有代码，运行未证明生效」。
3. **记忆效果：仅本次六场景合成可关（限定范围通过）。** DeepSeek 六场景 scoped pass（见 §6 与覆盖限制）。脚手架/召回通过仍不等于 production online effect；`overallModelEffectCloseable` **不得**解读为整体模型效果层或生产关闭。

## 10. 剩余最小动作

| 动作                                                                               | 责任人             | 说明                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 让 `origin/main` 的 `pnpm format:check` 与 `pnpm tsgo` 在不放宽规则的前提下 exit 0 | 主干维护           | 最小类型对齐：`PluginMemoryToolFactory` 补上实现已读取的 `authenticatedUserId` 与 `securityProfile`；修正 HTTP harness 的 authorize mock 类型。本收尾 PR 不改这些产品类型 |
| 子进程群组真认证夹具                                                               | 记忆连续性         | 需要 platform-auth 或 trusted-proxy。禁止用 HTTP 注入测试把缺口标成已关闭                                                                                                 |
| soft forget 重启复验                                                               | 记忆连续性         | 隔离进程重启后，forgotten 来源仍不可检索，且文件未被物理删除                                                                                                              |
| 合成模型六场景                                                                     | 效果验收           | **已补跑限定范围通过×6**（DeepSeek；见 JSON/MD；含 S2/S3/S5 限制；不再重跑模型）                                                                                          |
| 只读核对运行容器 build-info                                                        | 发布               | 见 §7。本轮不部署                                                                                                                                                         |
| 本机 loom / 网关身份                                                               | 有本机身份的执行者 | 云端 not-run                                                                                                                                                              |

## 11. 未触碰

未合并，未推 main，未部署，未切流，未写/删/遗忘/重建真实用户记忆，未改 QMD、cloudSync、privateMemoryPromote 的默认值，未放宽 ACL 或类型门闩，未关外部 issue。既有设计文档与历史证据目录保持原样。

## LOCAL RERUN (Mac worktree)

| 字段        | 值                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 工作树      | `/Users/daniel/AI VP/openbot-memory-final-closeout-182`                                                                       |
| 分支        | `cursor/memory-final-closeout-afe1`                                                                                           |
| 开跑时 HEAD | `c35164c188651329b28f541d7376db0a804966f0`（相对 `origin/main` `ea7f9218889ac9ca3d280d15cc14736149af369f`：`ea7f921` 是祖先） |
| 时区        | **用户时区 Europe/Berlin**；文中 Asia/Shanghai 标签为 Mac/box 机器时钟溯源                                                    |
| 本轮不做    | 合并、部署、切流、真实用户记忆写入/search 可能 sync-write、放宽 composition-root LOC（模型六场景已另轮 DeepSeek 补跑并 push 证据） |

### 门禁 exits（本机）

| 命令                                     | exit  | 说明                                  | 证据                                               |
| ---------------------------------------- | ----- | ------------------------------------- | -------------------------------------------------- |
| `CI=true pnpm install --frozen-lockfile` | **0** | 本会话已跑；按成功计                  | `local-pnpm-install.log`                           |
| `pnpm tsgo`                              | **0** | 经本地 type/mock/contract 修复后      | `local-pnpm-tsgo-after-trunk-fix.log` / 修复后复跑 |
| `pnpm format:check`                      | **0** | oxfmt 后                              | `local-format-check.log`                           |
| `pnpm check`                             | **1** | 停在 `lint:core:composition-root-loc` | `local-pnpm-check-full.log`                        |

**主干既有 composition-root-loc 阻塞（未修、未抬预算）：**

- `src/gateway/collaboration-learning.ts`: 166（budget 150）；相对 `origin/main` **未触碰**；`ea7f921` tip 同为超预算
- `ui/src/ui/app.ts`: 4890（budget 4845）；相对 `origin/main` **未触碰**；`ea7f921` tip 同为超预算

研发门禁结论：**BLOCKED** 于 trunk composition-root-loc（tsgo/format 已绿）。

### 隔离 vitest 复跑（与云端 mem-closeout 同矩阵）

| 命令                                                                                                    | exit  | 摘要                             | 证据                          |
| ------------------------------------------------------------------------------------------------------- | ----- | -------------------------------- | ----------------------------- |
| unit：`pnpm exec vitest run --config vitest.unit.config.ts --maxWorkers=2`（19 memory 文件）            | **0** | 19 files / 79 tests              | `local-isolation-unit.log`    |
| gateway：`pnpm exec vitest run --config vitest.gateway.config.ts --pool=forks --maxWorkers=2`（6 文件） | **0** | 6 files / 31 tests               | `local-isolation-gateway.log` |
| UI：`ui/` 下 `vitest.node.config.ts` → `memory-center-page.node.test.ts`                                | **0** | 12 tests                         | `local-isolation-ui.log`      |
| e2e：`vitest.e2e.config.ts` → `test/memory-continuity-gateway.e2e.test.ts`                              | **0** | 1 test ~14s（子进程真 token DM） | `local-isolation-e2e.log`     |

未发明通过项；上表均为本机复跑实测 exit。

### 本机网关身份（只读）

证据：`docs/design/evidence/memory-system-final-closeout-2026-11-01/local-gateway-identity.json`。

| port  | PID   | cwd HEAD / note                | health | UI commit / build-info                               | STATE（只读推断）                                       |
| ----- | ----- | ------------------------------ | ------ | ---------------------------------------------------- | ------------------------------------------------------- |
| 18789 | 77060 | `beb0ee226ab6…`（#180 工作树） | live   | UI=`beb0ee226ab6…`；`dist/build-info.json` 同 commit | `~/.openbot`                                            |
| 18790 | 71854 | `02c26fab…` detached           | live   | UI=`02c26fa`；无 dist/build-info                     | `/private/tmp/openbot-pr143-live-20261029-174622/state` |
| 19001 | 11204 | 无 `.git`                      | live   | UI 404；无 build-info.json                           | `/private/tmp/openbot-joint-accept-state-883a5159`      |

**结论：** runtime identity = **VERIFIED**（只读）。三者都不是 tip-of-main memory closeout SHA。未调用 memory search API，未改 state。

### 六场景模型效果

用户后续授权 DeepSeek-only 合成模型效果补跑（见 §6 与 `model-effect-six-scenarios-deepseek.*`）。**六场景均为限定范围通过**（真实 `deepseek-chat`；非 mock；**不再重跑**）。

| 场景                 | 结果             |
| -------------------- | ---------------- |
| 保存后新会话采用     | **限定范围通过** |
| 无关内容不乱入       | **限定范围通过** |
| 更新后不沿用旧事实   | **限定范围通过** |
| 无权限不进上下文     | **限定范围通过** |
| 遗忘后不用被禁用来源 | **限定范围通过** |
| 未批准学习不采用     | **限定范围通过** |

**覆盖限制：** S2=`irrelInRequest=true`（仅证明回答未采用无关内容）；S3=直接 SDK `supersedeAtom`（非产品冲突入口全流程）；S5=path1 文件删除（非 soft forget / 全来源 / 重启后）。

O6 / O7 / O9 仍 **明确延期**。撤回的「forget failed」双来源假阳性结论保持。

### 三层关闭（本机复跑后，仍不宣称整体关闭）

1. **研发交付：BLOCKED** — 卡在 trunk `composition-root-loc`（tsgo/format 绿；隔离矩阵复跑绿）。
2. **运行身份：VERIFIED**（只读三网关）— 但无一为 memory closeout tip SHA；**不**等于运行生效关闭。
3. **模型效果：仅本次六场景合成可关（限定范围通过）** — 有真实模型采用/拒用证据；仍 **不** 宣称整体模型效果层、production online effect 或完整 gateway agent tool-loop E2E。

**不宣称 overall close（运行生效仍未关）。** Draft PR #182 仍是唯一收尾记录。

## FINAL ACCEPTANCE SHA PIN (post-LOC tip)

| 字段                                                | 值                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **最终验收 / 门禁 tip SHA（研发 tip，LOC 解除后）** | `3460ef9faa8d7844367f4e2e4d28f656aeb27072`                                                                                                              |
| 分支                                                | `cursor/memory-final-closeout-afe1`                                                                                                                     |
| Draft PR                                            | https://github.com/flykingvip-cloud/openbot-vp/pull/182                                                                                                 |
| 相对 `origin/main`（钉定时）                        | behind 13 / ahead 6（钉定时 `git fetch` 后 `git rev-list --left-right --count origin/main...HEAD`；origin/main=`5815006dc…`）；**不**假装已与 main 同步 |
| 钉定时区                                            | 2026-11-01T23:10:10+0800 Asia/Shanghai                                                                                                                  |

### 钉 SHA 含义（边界）

- 本 SHA 固定为 **R&D / closeout tip**：`composition-root-loc` 已在此 tip 通过且**未抬预算**。
- **不**宣称：运行生效已关闭、已部署、或与 `origin/main` 字节一致。合成 DeepSeek 六场景见 §6（**限定范围通过**×6）；`overallModelEffectCloseable` 仅覆盖该合成运行。仍不宣称 production online effect。对齐 main 后须在**新 tip**重跑门禁/构建身份，不得移用 `3460ef9fa…` 旧结果冒充新 tip。
- `:19001` / #113 joint-accept 历史证据（见下）仅证明当时声明身份与鉴权隔离边界；标签保留「声明身份，构建来源未完全验证」；**不得**用作本 tip 运行生效证明。

### 本 tip 已持久化的本机证据（脱敏）

| 文件                                                                                                          | 角色                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/local-gateway-19001-buildinfo-fix.json`         | :19001 身份补核历史；非 closeout tip 生效证明 |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/local-gateway-19001-provenance-auth.json`       | :19001 provenance + auth 边界历史；非业务验收 |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/composition-root-loc-fix-2026-11-01.md`         | LOC 解除记录                                  |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/local-gateway-closeout-tip-build-identity.json` | 专用环境完整构建 + :19111 身份探针（已停）    |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/model-effect-six-scenarios-deepseek.json`         | DeepSeek 六场景（限定范围通过×6；含覆盖限制；密钥已脱敏） |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/model-effect-six-scenarios-deepseek.md`           | 六场景短记录                                  |
| `docs/design/evidence/memory-system-final-closeout-2026-11-01/model-effect-six-scenarios-deepseek.driver.ts`    | 隔离驱动（只读密钥；合成 state）              |

### LOC 状态（相对 LOCAL RERUN 上文）

上文 LOCAL RERUN 记录的「166/150、4890/4845、BLOCKED」是 **LOC 修复前** 快照。修复后 tip `3460ef9faa8d7844367f4e2e4d28f656aeb27072`：`collaboration-learning.ts`=150/150，`ui/src/ui/app.ts`=4844/4845；`pnpm lint:core:composition-root-loc` exit 0。

### 专用环境完整构建 + 运行身份（本 tip）

| 字段         | 值                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 证据         | `docs/design/evidence/memory-system-final-closeout-2026-11-01/local-gateway-closeout-tip-build-identity.json`                  |
| 构建命令     | `pnpm build`（官方完整路径，含 `write-build-info.ts` + `ui:build`）exit **0**                                                  |
| 构建工作树   | `/Users/daniel/AI VP/openbot-closeout-accept-build-3460ef9fa` @ `3460ef9faa8d7844367f4e2e4d28f656aeb27072`（detached sibling） |
| 专用 state   | `/private/tmp/openbot-closeout-accept-3460ef9fa`（**不是** #113 joint-accept state）                                           |
| 临时网关端口 | **19111**（已停止；未碰 :18789/:18790/:19001）                                                                                 |
| 声明 commit  | UI `data-openbot-build-commit` 与 `dist/build-info.json` 均为 `3460ef9fa…`（= 钉 tip）                                         |
| provenance   | **official full pnpm build of pinned tip**；启动时 run-node 额外 tsdown 一次；**不**宣称产品运行生效或模型场景关闭             |
| 记录时区     | 2026-11-01T23:15:06+0800 Asia/Shanghai                                                                                         |

### 仍开放 / 延期（对齐后须诚实记录）

1. ~~专用环境对钉 tip `3460ef9fa…` 做官方完整构建并验证运行身份~~ **已完成**（见上表；:19111 已停）。**对齐最新 main 后不得移用该旧 tip 构建身份**；若宣称新 tip 构建身份须在新 tip 重做。
2. ~~六条模型场景 not-run~~ → **限定范围通过×6**（DeepSeek；见 §6；**不再重跑模型**）。整体模型效果层 / 生产验收仍未关。
3. 整体收尾仍不关闭：运行产品生效 ≠ 身份探针；完整 gateway agent 工具循环未测；soft forget 重启未测；O6/O7/O9 明确延期；S2/S3/S5 覆盖限制仍有效。
4. **本轮不授权合并、部署或再次付费模型调用。** Draft/合入申请另开闸门。

## FOLLOW-UP: scoped-pass language + main align

| 字段 | 值 |
| --- | --- |
| 目的 | 将六场景从「整体可关」收窄为「限定范围通过」；保留 S2/S3/S5 限制；修正时区与费用表述；与最新 `origin/main` 对齐后在**最终 tip**重证门禁 |
| 用户时区 | **Europe/Berlin** |
| 模型重跑 | **禁止**（本 follow-up 只改文档/证据措辞） |
| 合并/部署 | **未授权** |
| 相对已合入 #182 | #182 已 squash 入 main；本 follow-up 为文档收敛补丁，另提合入申请 |
