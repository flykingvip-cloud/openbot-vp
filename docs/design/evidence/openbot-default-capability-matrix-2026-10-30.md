# 默认能力矩阵与 P0 证据（2026-10-30）

基线：`3a391742f2603bc80d42ad3d4258e047224da352`（fetch 后仍是 `origin/main`）。本文件只覆盖第一批：八类能力判定，以及 P0-A / P0-B。P1-C 至 P2-H 只读，未在本 PR 实现。

状态只使用：已验证 / 部分验证 / 未实现 / 合理受控关闭 / 缺证据。

## 八类能力

| 能力          | 状态     | 产品声明与默认                                                                 | 配置来源                                                                                                                              | 生产入口                                                  | 实际执行器                                                    | 结果存储                                                                                      | 下次消费                                                         | 权限边界                                                            | 失败/跳过                                                                                  | 本轮测试证据                                                                                            |
| ------------- | -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 记忆          | 部分验证 | builtin 索引授权小组记忆；个人经验需审批；`privateMemoryPromote` 默认关        | `memory.backend`（默认 builtin）、`memorySearch`、`collaboration.learning.privateMemoryPromote`                                       | `extensions/memory-core` 工具；`getMemorySearchManager`   | `MemoryIndexManager` / QMD / CogniWeave                       | 授权范围内的 sqlite；本 PR 起非空小组根使用 `authz-scopes/<fingerprint>/`                     | 同 caller 的后续 `search`                                        | 成员 + 租户根；managed 非 CogniWeave fail-closed                    | 无 embedding → FTS-only `embedding_unavailable`；撤权后旧 manager 返回空且不带 snippet     | 见 P0-B。既有 `memory-continuity-acceptance` 本轮重跑通过。真实 HTTP 监听与真实 embedding provider 未跑 |
| 技能/资产进化 | 部分验证 | `outcome_verified` 后生成 draft，不能算已启用技能                              | 学习资产阈值与技能生命周期配置                                                                                                        | `src/auto-reply/reply/learning-skill-curation.ts`         | 策展器写草稿，安装/分配另有生命周期                           | draft 技能文件与生命周期存储                                                                  | 审批安装后的真实工具调用（本轮未打通证据）                       | 保留现有审批，不自动发布                                            | 未达阈值不策展                                                                             | 本轮只读。未做 P1-D                                                                                     |
| 系统进化      | 部分验证 | 控制平面可观察；shadow intent 只到 DISCOVERED，不自动 Apply                    | evolution governance / kill switch                                                                                                    | `src/gateway/evolution-control/shadow-intent-proposal.ts` | proposal registrar；diagnosis 为只读观察                      | proposal 状态                                                                                 | 授权 Apply 之后才改变运行绑定（本轮未证明）                      | delegation、payload hash、verifier 保留                             | 拒绝不改现状                                                                               | 本轮只读。`shadow-intent-proposal.ts` 明确 never authorize/Apply。未做 P1-E                             |
| 上下文        | 部分验证 | 默认开启 planner 与 projection；显式 false 关闭；env 覆盖 config               | `conversation.contextPlanner` / `conversation.projection`；`OPENBOT_CONVERSATION_CONTEXT_PLANNER` / `OPENBOT_CONVERSATION_PROJECTION` | `resolveContextEngine(config)` → `LegacyContextEngine`    | `assembleMessagesWithBudget`；`refreshConversationProjection` | projection JSON + session→conversation 绑定，位于 data root `.meta/conversations/projections` | 同一 `sessionId` 的下一次 `assemble` 写入 `systemPromptAddition` | rollout 不冻结这两项（既有策略）。无预算、无 conversation id 是跳过 | `missing_token_budget`、`missing_conversation_id`、`disabled_by_env`、`disabled_by_config` | `legacy.default-capability.test.ts` 修复前失败、修复后通过。见 P0-A                                     |
| 知识库        | 部分验证 | 检索/注入/引用与 publication 不是同一条链路。`event_driven` 不能当成已生效调度 | knowledge publication mode                                                                                                            | `src/gateway/enterprise-data/knowledge-publication.ts`    | on_demand / scheduled 有分发；event_driven 不分发             | publication / projection 存储                                                                 | 已验证 publication 才能被消费（本轮未重跑）                      | 授权与 SAR                                                          | `isImplementedMaterializationMode("event_driven") === false`                               | 本轮只读代码与既有测试名。未重跑知识库套件。事件物化记为未实现，不记为完成                              |
| 数据资产物化  | 部分验证 | on_demand 与 scheduled 可物化；event_driven 可保存但永不刷新                   | `EnterpriseKnowledgeProjectionMaterializationMode`                                                                                    | enterprise data gateway                                   | connector + publication gate                                  | knowledge object / lineage                                                                    | scheduled 走维护 tick；on_demand 走加载                          | 凭证、grant、SAR                                                    | 无凭证、未知 handler、demo `mock_smoke_ok` 不得当成生产事实                                | 本轮只读 `source-connection-probe.ts` 与 publication 注释。未重跑连接器。未实现所有连接器               |
| 定时任务      | 部分验证 | 默认开启，除非 `cron.enabled === false` 或 `OPENCLAW_SKIP_CRON=1`              | `cfg.cron`                                                                                                                            | `buildGatewayCronService`（`src/gateway/server-cron.ts`） | cron service timer                                            | cron store                                                                                    | 下次 wake                                                        | 目标身份与租户由 job 自身约束（本轮未重验）                         | 关闭时不调度                                                                               | 本轮只核对默认表达式，未跑创建→送达闭环。未见需要在本 PR 改动的新缺口                                   |
| 模型智能配置  | 部分验证 | 未设置时为 `native`。`native` 是合法默认，不是缺陷                             | `gateway.platform.models.mode`                                                                                                        | `resolvePlatformModelsMode`                               | native 直出；`aor_enhanced` 另有 gate                         | 平台模型快照                                                                                  | 后续请求读同一 mode                                              | 不扩大授权集合                                                      | 缺 mode 时回到 native，不合成“已优化”                                                      | 本轮只读 `platform-models-config.ts`。未证明用户选择改变真实 outbound provider/model                    |

`privateMemoryPromote` 单独记为 **合理受控关闭**：`src/gateway/collaboration-learning/private-memory-promote.ts` 只有显式 `true` 才开启。本 PR 不打开它。

## 受支持记忆后端

| 入口                                                 | personal_local                   | managed_enterprise                                                               |
| ---------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| 完整 `accessContext`                                 | 不走 managed resolver            | 非 `memory.backend=cogniweave` 时 `managed_backend_not_cogniweave`，不建本地索引 |
| 工具 `securityProfile`（往往没有完整 accessContext） | 按成员解析 builtin/QMD 根        | 本 PR 起与上一行相同错误码，不再把 managed 当成 personal_local                   |
| builtin                                              | 授权 `collaborationMemoryRoots`  | 不索引                                                                           |
| qmd                                                  | 授权集合                         | 不落到本地 QMD/builtin                                                           |
| cogniweave                                           | `CogniWeaveMemoryManager.create` | `createFromHandle`；缺 ownership proof 则拒绝                                    |

隔离门没有删除。本地 builtin/QMD 根仍按既有冻结说明不能就地改成租户资源隔离。

## P0-A 上下文开关

触发：不设置 `OPENBOT_CONVERSATION_CONTEXT_PLANNER`，`tokenBudget=3500`，配置为生产默认（planner/projection 均为 true）。

修复前症状：`LegacyContextEngine.assemble` 的 `budgetTrace` 为 `undefined`。旧实现只读环境变量，未设置时返回 false（修复前 `src/context-engine/legacy.ts` 的 `envFlagEnabled`）。

根因：`src/conversations/flags.ts` 的默认值没有进入引擎。`flags.ts` 顶部写 env 优先，实现却是“config 布尔存在则压过 env”。

修复：

- env 显式 `1/0/true/false/yes/no/on/off` 高于 config，再高于默认。空串和无法识别的值不覆盖 config。
- `resolveContextEngine(config)` 把请求配置传给 legacy 工厂。
- `assemble` / `afterTurn` 调用 `resolveConversationFlags`。
- `afterTurn` 把 `sessionId → conversationId` 写到 projection 目录。下一次 `assemble` 用它把 `shortSummary` 放进 `systemPromptAddition`。重启后新引擎实例仍能读到文件。
- 无预算、无 conversation id 写入 `capabilityDecisions`，不抛错，也不伪造 `budgetTrace`。

失败然后通过：

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/context-engine/legacy.default-capability.test.ts -t "no env"
```

把 `src/context-engine/legacy.ts` 临时换回基线后，该用例 `expected undefined to be truthy`（`budgetTrace`）。换回修复后，同一文件 6 项通过，其中包括 resolver 绑定、显式开关、env 冲突、跳过原因、重启后消费。

优先级规则（唯一）：对 `OPENBOT_CONVERSATION_HISTORY_CURSOR`、`PROJECTION`、`CONTEXT_PLANNER`、`SEMANTIC_SEARCH`、`RETENTION_ENFORCE`，env 覆盖 config。这与 `flags.ts` 文件头一致。只在两边都显式设置且互相矛盾时，行为相对旧实现改变。

未改 `src/agents/pi-embedded-runner/run/attempt.ts`。该文件已有其他 lander。生产配置经 `run.ts` 已有的 `resolveContextEngine(params.config)` 进入引擎。`afterTurn` 本来就收到 `sessionKey`。下一次 assemble 靠 session 绑定消费投影，不依赖 attempt 传 sessionKey。若同一个 conversation 换了新的 `sessionId`，要等该 session 的 `afterTurn`，或调用方传入 `runtimeContext.sessionKey`。

压缩与 tool 配对仍走 `assembleMessagesWithBudget`，本 PR 没有改它。

## P0-B 记忆闭环

### 1. 小组文件自动刷新

触发：manager 已完成首次索引（`dirty` 被清掉），之后在授权 `memoryDir` 里新增、修改、删除 markdown。不调用 `sync()`。

修复前症状：`ensureWatcher` 只监视工作区 memory 与 `extraPaths`。`onSearch` 仅在 `dirty` 时调度同步，所以小组文件变化不会进入后续搜索。

根因：`src/memory/manager-sync-ops.ts` 的 `ensureWatcher`。另外，当前 chokidar 对 `**/*.md` glob 不发出 add 事件；直接监视目录可以。因此小组根监视的是目录本身，而不是那条无效 glob。工作区与 extraPaths 的 glob 本轮没有改。

修复后：`manager.collab-continuity.test.ts` 在 4s 上限内看到新增、修改、删除。该次运行整段约 568ms。约定：可见性是 watcher debounce（`watchDebounceMs`，同时用作 `awaitWriteFinish.stabilityThreshold`）加上同步完成后的下一次 search。触发同步的那一次 search 本身不保证命中，也不对每次 search 做全量重建。

### 2. 同名组 / 撤权

触发：同一 `groupId`、不同 `memoryDir`；以及同一 caller 从有根变为空根。

修复前形状：缓存键只拼 `groupId`，sqlite 使用配置里的同一个 `store.path`。撤权后的新 manager 若仍打开旧库，搜索可以读到旧 snippet。本 PR 用测试把隔离和撤权做成可复现行为，而不是只凭代码形状下结论。

修复：缓存键包含 caller（有身份时）和 `groupId + memoryDir`。非空根使用独立 sqlite。同一身份的新根集会同步标记旧 manager，`search` 返回 `[]`，`readFile` 抛 `not authorized`，响应里没有正文。

### 3. 无 embedding

触发：provider 为 null。

结果：`status.custom.searchMode=fts-only`，`degraded=true`，`degradeReason=embedding_unavailable`。改写查询 `weekday delivery cutoff` 不会命中只含中文句子和 `quartz-deadline-token` 的文档。词法查询该 token 仍能命中，且不把它叫做语义成功。

本环境没有可用的 sqlite-vec / 真实 embedding provider。确定性向量召回未验证，不能写成语义能力已验证。

### 4. managed 工具路径

`extensions/memory-core` 在 enterprise/employee session 上设置 `securityProfile=managed_enterprise`，通常不带完整 `accessContext`。修复前只有 `accessContext` 会触发 `managed_backend_not_cogniweave`。工具路径仍可能进 builtin。

修复后：`continuityAuthz.profile === managed_enterprise` 且后端不是 cogniweave 时返回同一错误，manager 为 null，工具结果 `results` 为空。`search-manager.managed-tool-profile.test.ts` 通过。`item7-stage-c-identity-thread.test.ts` 仍通过。

## 测试分层

| 层                             | 命令                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 结果                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯函数 / manager               | `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/context-engine/legacy.default-capability.test.ts src/context-engine/legacy.budget.test.ts src/context-engine/context-engine.test.ts src/conversations/flags.test.ts src/conversations/conversation-lifecycle.p0.test.ts src/memory/collaboration-index-scope.test.ts src/memory/manager.collab-continuity.test.ts src/memory/manager.watcher-config.test.ts src/memory/manager.search-degrade.test.ts src/memory/memory-continuity-acceptance.test.ts src/memory/search-manager.dataplane.test.ts src/memory/search-manager.governance-cache.test.ts src/memory/search-manager.managed-tool-profile.test.ts src/memory/item7-stage-c-identity-thread.test.ts` | 通过（见 PR 描述中的计数）。`manager.get-concurrency.test.ts` 在未改动的基线上同样失败：12 个 `getMemorySearchManager` 包装对象不是同一引用。不是本 PR 引入的 |
| 工具                           | `src/memory/search-manager.managed-tool-profile.test.ts` 的 `memory_search` 用例                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 通过。managed 不返回 snippet                                                                                                                                  |
| 真实 HTTP                      | 未跑                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 任务书记录 `listen(127.0.0.1)` EPERM。本轮不把跳过当成通过                                                                                                    |
| 真实认证子进程 / 真实 provider | 未跑                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 缺证据                                                                                                                                                        |

## 用户可见变化

- 未设置上述 env 时，默认配置会真正跑 context budget planner，并在有 conversation id 时写 projection。下一次同一 session 的 assemble 会带上短摘要。
- 配置显式 false 会关闭。env 显式 false 会压过配置 true。
- 小组 markdown 的新增、修改、删除会在 watcher debounce 后的后续搜索中出现或消失，不需要每次全量重建。
- 不同租户的同名组不再共用一个 sqlite。撤权后的旧 manager 不再返回正文。
- 没有 embedding 时，状态标明 FTS-only 降级。
- enterprise/employee 工具在非 CogniWeave 后端上不再走 builtin 索引。

## 已知限制与回滚

- 不打开 `privateMemoryPromote`。
- 不实现 P1-C 至 P2-H。
- 工作区 memory 的 `**/*.md` watcher glob 在当前 chokidar 上仍可能不发事件。本 PR 只改了授权小组目录。
- 持有小组根的索引写到 `authz-scopes/<fingerprint>/`。空根仍用原来的 `store.path`。回滚后新目录可以留下，旧库不会被删除。
- 语义向量质量、真实 HTTP、真实认证子进程、真实 embedding provider 都还没有本轮证据。
- 回滚：还原本 PR。没有配置迁移。没有生产 gateway 重启。

## P0 验收回退修复（tool pairing + pending revoke）

独立验收对 `e15c19d2` 指出两项未过，本轮修复后仍记 **部分验证**（不自行宣告 P0 通过）：

| ID  | 问题                                                                                                                | 修复                                                                                                                                                                 | 证据                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A   | 默认 planner 按单条消息裁剪，长 assistant `toolCall` 被丢掉而 `toolResult` 保留；runner 在 assemble 后未再 sanitize | `groupHistoryIntoToolUnits` 整单元裁剪；`assembleMessagesWithBudget` / `LegacyContextEngine.assemble` / `attempt.ts` 在 assemble 后再 `sanitizeToolUseResultPairing` | `tool-pair-repro.test.ts`（验收 PoC）；`context-assemble.test.ts` 并行/连续/预算；`attempt.context-assemble-pairing.test.ts` |
| B   | 撤权只扫 `INDEX_CACHE`，`INDEX_CACHE_PENDING` 初始化中的旧 scope 仍可发布并返回旧小组 snippet                       | 同 caller prefix 的 epoch bump；过期 pending 不入库且 `markContinuityAccessRevoked`；`sync` 尊重撤权                                                                 | `pending-revocation-repro.test.ts`（含 review pending / re-auth / out-of-order）                                             |

条件：真实 HTTP 监听、真实 embedding、全量 type/lint/build、远端最新同步仍未作为本轮通过依据。watcher 用例需 `CHOKIDAR_USEPOLLING`（原生 EMFILE），不记产品缺陷。

## 第二轮验收回退（pending dispose + runner 边界）

| ID  | 问题                                                | 修复                                                                                                    | 证据                                                                       |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C   | 过期 pending 只 mark 不 close，且不在 closeAll 跟踪 | `INDEX_CACHE_ORPHANS`；epoch 不匹配时 mark+track；`close()` 仅当 `INDEX_CACHE.get(key)===this` 才删缓存 | `pending-dispose-repro.test.ts`（closeAll 后 db 不可查；re-auth 缓存保持） |
| D   | attempt 配对测试未跑真实 runner                     | 新增 `runEmbeddedAttempt` 边界测试，在 `session.prompt` 捕获将发往 provider 的 messages                 | `attempt.context-assemble-pairing.runner.test.ts`                          |

矩阵仍为 **部分验证**。HTTP/真实 embedding/新鲜远端 tip 未作为通过依据。

### check / build 证据（第二轮）

- 本 PR 触达文件 `oxfmt --check` 通过；全仓 `pnpm check` 的 `format:check` 仍会扫到其他未改文件的既有格式问题（未动他人路径）。
- `CI=true pnpm build` 通过（含 `build:plugin-sdk:dts`、`ui:build`）。动态导入 ineffective 警告为既有，非本轮引入。
- 为通过 `tsc -p tsconfig.plugin-sdk.dts.json`，将 `embedding_unavailable` 补入 `MemoryEmbeddingErrorReason`（与既有 FTS-only 状态字段一致）。
