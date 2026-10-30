# 默认能力矩阵与 P0 证据（2026-10-30）

基线：本分支 rebase 后相对 `origin/main`（见提交祖先）。覆盖 P0-A / P0-B、**P1-C**（私有记忆显式进组 RPC）、**P1-D**（学习策展 draft→finalize→install 可达闭环）、**P1-E**（shadow intent 人工 authorize→experiment→Apply→rollback 可达入口）、**P1-F**（event_driven 虚假可用性修复 + 生产探测禁 mock；最小事件物化路径已接；完整 KB 目标未宣称）、**P2-G**（模型智能配置：native 合法默认；合成中性档案不得冒充已验证优化；partial catalog 合成项不进 ranking；策略改变可影响 outbound primary）、**P2-H**（定时任务闭环：默认可调度；完成 ledger 不得空完成误报；create→persist→due→adapter 送达证据→下次调度；真实 HTTP 未跑）。

状态只使用：已验证 / 部分验证 / 未实现 / 合理受控关闭 / 缺证据。

## 八类能力

| 能力          | 状态     | 产品声明与默认                                                                 | 配置来源                                                                                                                              | 生产入口                                                                                                      | 实际执行器                                                                                     | 结果存储                                                                                      | 下次消费                                                         | 权限边界                                                            | 失败/跳过                                                                                  | 本轮测试证据                                                                                            |
| ------------- | -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 记忆          | 部分验证 | builtin 索引授权小组记忆；个人经验需审批；`privateMemoryPromote` 默认关        | `memory.backend`（默认 builtin）、`memorySearch`、`collaboration.learning.privateMemoryPromote`                                       | `extensions/memory-core` 工具；`getMemorySearchManager`                                                       | `MemoryIndexManager` / QMD / CogniWeave                                                        | 授权范围内的 sqlite；本 PR 起非空小组根使用 `authz-scopes/<fingerprint>/`                     | 同 caller 的后续 `search`                                        | 成员 + 租户根；managed 非 CogniWeave fail-closed                    | 无 embedding → FTS-only `embedding_unavailable`；撤权后旧 manager 返回空且不带 snippet     | 见 P0-B。既有 `memory-continuity-acceptance` 本轮重跑通过。真实 HTTP 监听与真实 embedding provider 未跑 |
| 技能/资产进化 | 部分验证 | `outcome_verified` 后生成 **draft**（非启用）；须 finalize+install 才可调用    | 学习资产阈值；既有 skill lifecycle；无新自动发布开关                                                                                  | `learning-skill-curation` + `collaboration.learning.skillDraft.list/finalize` + `robot-skills.install/remove` | 策展写 draft（owner 戳记、`autoInstallEnabled:false`）；finalize→private；install 物化 binding | `CONFIG_DIR/skill-assets` + learning `curatedSkillId`                                         | finalize+install 后 identity tool **execute** + 归因事件；remove 后停止归因    | 保留人工 finalize，不自动审批/发布；无 owner 草稿不可见于 list（覆盖边界）      | 未达阈值不策展；非 owner finalize 拒绝；draft 强制 install 仍无 identity tools；ownerless 组草稿仍不可见             | 见 P1-D（含 execute+归因）。真实 HTTP/provider 未跑 → 部分验证                                                             |
| 系统进化      | 部分验证 | 控制平面可观察；assist-shadow 默认只到 DISCOVERED（observe-only）；人工 authorize 后可实验/Apply | evolution governance / kill switch；`evolution.proposals.authorize`                                                                   | `authorize-shadow-intent.ts` + `evolution.proposals.authorize`；既有 experiments/apply/rollback                                       | shadow registrar（DISCOVERED）；authorize 入口；skill-installation adapter                     | proposal/ledger；skill install binding                                                        | authorize→experiment→canary Apply 后 runtime 消费；rollback 恢复 | delegation、payload hash、verifier、kill switch 保留                | 拒绝/缺 grant/observe-only 表面不改现状；runtime-binding 仍 observe-only                   | 见 P1-E（含重放绑定修复已推送待复验）。真实 HTTP/authz 子进程未跑 → 部分验证。已推送≠验收通过；不自称 Codex PASS                                       |
| 上下文        | 部分验证 | 默认开启 planner 与 projection；显式 false 关闭；env 覆盖 config               | `conversation.contextPlanner` / `conversation.projection`；`OPENBOT_CONVERSATION_CONTEXT_PLANNER` / `OPENBOT_CONVERSATION_PROJECTION` | `resolveContextEngine(config)` → `LegacyContextEngine`                                                        | `assembleMessagesWithBudget`；`refreshConversationProjection`                                  | projection JSON + session→conversation 绑定，位于 data root `.meta/conversations/projections` | 同一 `sessionId` 的下一次 `assemble` 写入 `systemPromptAddition` | rollout 不冻结这两项（既有策略）。无预算、无 conversation id 是跳过 | `missing_token_budget`、`missing_conversation_id`、`disabled_by_env`、`disabled_by_config` | `legacy.default-capability.test.ts` 修复前失败、修复后通过。见 P0-A                                     |
| 知识库        | 部分验证 | 检索/注入/引用与 publication 不是同一条链路。`event_driven` 有**最小** ingest 物化；完整 KB 目标未宣称；仍可迁到 scheduled/on_demand | knowledge publication mode                                                                                                            | `knowledge-publication.ts` + `projection-bindings.upsert` + `runEventDrivenProjectionsForEvent`                                             | on_demand / scheduled / **最小 event_driven**（非 clock；无 durable restart queue）                                    | publication / projection 存储                                                                 | 已验证 publication 才能被消费（本轮未重跑）                      | 授权与 SAR                                                          | 错 source / 非 event 调度不物化；deduped ingest 跳过物化                 | 见 P1-F。**已推送待复验 / 部分验证**；不记完整知识库目标完成                              |
| 数据资产物化  | 部分验证 | on_demand/scheduled 可物化；event_driven 经 ingest 最小物化；生产探测禁 `mock_smoke_ok` | `EnterpriseKnowledgeProjectionMaterializationMode` + probe mode                                                                       | enterprise data gateway + `source-connection-probe.ts` + events.ingest                                                | connector + publication gate；event 路径复用 `runProjectionMaterialization` | knowledge object / lineage                                                                    | scheduled 走维护 tick；on_demand 走加载；event 走 ingest                          | 凭证、grant、SAR；demo 可 mock 但须标注                                         | 无凭证/未知 handler/生产 mock 拒绝明确失败；demo 保持隔离标注；durable replay/限流未宣称                              | 见 P1-F。未实现全部连接器；Agent 触发与物化并行；**已推送待复验**                              |
| 定时任务      | 部分验证 | 默认开启，除非 `cron.enabled === false` 或 `OPENCLAW_SKIP_CRON=1`；长周期 `createCronLedgerSession` **不**依赖默认关闭的全局 ledger 开关 | `cfg.cron`；ledger 资格看任务文本，不看 `OPENBOT_PROGRESS_LEDGER_ENABLED` | `buildGatewayCronService` + `CronService` + isolated-agent / webhook announce | timer due fire → `runIsolatedAgentJob` / systemEvent；outbound `deliverOutboundPayloads` | cron store（`lastDelivered` / `lastDeliveryStatus` / `nextRunAtMs`）+ run log | 下次 `nextRunAtMs` wake；完成 ledger 后续 tick 带诚实 summary 记 ok | ownership ownerId/tenantId + personal scope 交叉；系统 retention 可共存 | `OPENCLAW_SKIP_CRON=1` / `enabled:false` 不调度；空完成仍非成功；完成 ledger 不再空完成误报 | 见 P2-H。单元+adapter 证据 create→persist→due→`deliverOutboundPayloads`→persist status；**真实 HTTP 送达未跑** → 部分验证 |
| 模型智能配置  | 部分验证 | 未设置时为 `native`（合法默认，非缺陷）。产品/系统设置保存 `aor_enhanced` 后由 `resolvePlatformModelsMode` 读入 gate | `gateway.platform.models.mode`（UI `onSetPlatformModelsMode` → config.set） | `resolveEmployeeModelGate` ← chat / followup / cron-isolated / subagent（image/PDF 经 chat+capability plan modality） | native 直出；`aor_enhanced` + 真实目录成本 → AOR 保集合重排；**全合成 → native**；**partial 合成项不进 rankModels** | 平台模型快照 + effectiveRouting / preferredModelOrder | 后续请求读同一 mode；`runWithModelFallback` 消费 preferredModelOrder | 不扩大授权集合 | 缺 mode→native；缺档案→synthetic_only 回退原序且无假解释；合成中性不得赢 cheapest | 见 P2-G。单元证明 preferredOrder 改变 outbound primary；**真实 HTTP/provider 未跑** → 部分验证 |

`privateMemoryPromote` 仍记为 **合理受控关闭**（默认 unset/false）：`promotePrivateMemoryCapsuleToGroup` 只有显式 `true` 才写组学习资产。P1-C 已补生产 RPC `collaboration.learning.privateMemory.promote`（`private-memory-promote-entry.ts` + server-methods 注册）：要求 identified actor、个人 scope 按 capsuleId 加载、ownership 与目标组 trusted write 成员校验；flag OFF 返回 success-shaped `{promoted:false, reason:flag_off}`，不假装晋升成功。默认不打开 flag。验收复跑后补齐五修复：①策略拒绝前不写目标组正文；②projection/asset 稳定幂等 id；③RPC 可信 tenant/stores 传入执行层（managed 缺可信上下文 fail-closed）；④重试不覆盖资产生命周期（revoked/reuseCount 保留）；⑤源读取与目标策略绑定同一可信 stores/locator（fileStore/groupStorage，禁止 silent default reopen）。本批未接线 UI。撤销：个人 revoke 不自动撤销组侧副本；组侧走 `collaboration.capsule.transition` revoked。真实跨租户 HTTP/authz 子进程未跑 → 记忆行 / P1-C **仍部分验证**（已推送≠验收通过）。

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

- 不打开 `privateMemoryPromote` 默认（仅补 RPC 入口）。
- P2-H 已交单元闭环 + adapter 送达证据（`deliverOutboundPayloads`→persist）。**真实 HTTP 送达 / 真 gateway 长跑未跑** → 定时任务保持部分验证。P1-F 最小事件物化已接；durable restart queue / 完整 KB 目标未宣称。
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

## P1-C 私有经验显式分享入口（2026-10-30）

| 项       | 说明                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| RPC      | `collaboration.learning.privateMemory.promote`（WRITE scope，与 capsule.approve 同族）                                   |
| Flag     | `collaboration.learning.privateMemoryPromote` 默认 **OFF**；ON 才写组资产+audit                                          |
| 加载     | 仅从 `agent:<botId>` `readCapsules` 按 `capsuleId`；不接受客户端胶囊正文                                                 |
| 校验     | identified actor；`assertPersonalLearningOwnership`；目标组 `resolveTrustedWriteContext`；仅 `approved` 胶囊             |
| 策略顺序 | 目标组 policy/lifecycle **先于** `appendCapsule`/projection/asset；拒绝时仅 audit，目标组无正文副本（回归：lifecycle_blocked PoC） |
| 幂等     | 稳定 `proj:`/`asset:` id；已存在同 id 资产时返回原回执且**不**重建 `status`/`reuseCount`/`createdAt`/`version`（撤销不因重试复活） |
| 可信上下文 | RPC 传入 `tenantId`/`securityProfile`/`stores`；**源 capsule 读取**、**目标 policy（fileStore/groupStorage）**与 learning 写入同绑定；managed 缺可信上下文 fail-closed；禁止 silent default reopen |
| 测试     | entry + RPC + promote；含 policy-denial 零正文、repeat 幂等、**lifecycle-preserve**、**stores-binding**（源读/策略 archived 零写入）、跨租户拒绝 |
| UI       | 本批未接（避免 lander 冲突）                                                                                             |
| 撤销缺口 | 个人 revoke ≠ 组侧自动 revoke；组侧 transition revoked 后 recall 停注入仍待独立验证；FLOOR `promotion-audit` 默认路径未改（本流用 trusted helper）；behavior-buffer 旁路仍可能读默认 root（已知边界） |
| 状态     | **已推送待复验 / 部分验证**：五修复已推送（含 lifecycle-preserve + stores-binding）；**已推送≠验收通过**；无真实跨租户 HTTP、无 UI；默认仍 **合理受控关闭** |

## P1-D 技能/资产进化最后一段（2026-10-30）

| 项           | 说明                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 缺口         | 策展写 draft **不带 ownerUserId**，且默认 `autoInstall` 建 relation → 假“已装”；`personal-skills.*` / 我的资产 ACL 看不见草稿，finalize/install 人工门不可达 |
| 修复         | `curateLearningSkillDrafts` 从资产 `metadata.personalOwnerUserId`（可 override）戳 owner；`autoInstallEnabled:false`；`sourceLineageId=learning:<scope>`     |
| 生产入口     | `collaboration.learning.skillDraft.list`（READ）/ `.finalize`（WRITE，draft→private，**不** install）                                                        |
| 安装/撤销    | 沿用 `robot-skills.install` / `remove`（+ SkillExecutionBinding hooks）                                                                                      |
| 真实调用证据 | 闭环测：finalize+install 后 identity tool **`execute`**（注入 openbotSkillId）+ `recordLifecycleSkillToolStart/Result` 归因；remove 后 resolve/attribution 停止 |
| 幂等         | `curatedSkillId` 写回学习资产；同簇不再策展                                                                                                                  |
| 人工门       | finalize 可达；**不** auto-approve / auto-install                                                                                                            |
| UI           | 本批未接（RPC+tests）                                                                                                                                        |
| 已知缺口 / 覆盖边界 | 无 `personalOwnerUserId` 的组侧资产策展草稿仍无 owner（list 不可见）— **本轮明确为覆盖边界**；真实 HTTP gateway 子进程未跑 |
| 状态         | **已推送待复验 / 部分验证**（已推送≠验收通过）                                                                                                                                                 |

## P1-E 系统进化闭环（shadow intent authorize）

触发：bootstrap 注册的 assist-shadow registrar 只产 `DISCOVERED`；`evolution.proposals.transition` 仅 reject/promote/hold，DISCOVERED 无后续入口。diagnosis preview 仍不自动 Apply。

根因：`shadow-intent-proposal.ts` 明确 never authorize/Apply；缺少与 `evolution.diagnosis.submit` 对等的人工确认入口。

修复：

- 新增 `authorize-shadow-intent.ts`：对 `assist-shadow:` + `capability.skill-installation` 的 DISCOVERED 提案，在 `confirmedByUser` + 有效 grant 下进入 `APPROVED_FOR_EXPERIMENT`（不自动 Apply）。
- `system.runtime-binding-governance` 标注 observe-only，authorize 拒绝。
- RPC `evolution.proposals.authorize`（operator.approvals）；list/get 投影 `observeOnly` / `nextAction`。
- 既有 `experiments.create` / `applications.apply` / `rollback` 继续作为后续入口；delegation、kill switch、payload hash、verifier 未削弱。

失败然后通过：

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/evolution-control/authorize-shadow-intent.test.ts
```

覆盖：observe-only 标注；runtime-binding 拒绝；DISCOVERED 无法开实验；缺确认/缺 grant 不改现状；authorize→experiment→canary Apply→rollback 恢复未安装；reject 无 application；RPC 注册与 scope。

### P1-E 重放绑定修复（2026-10-30 follow-up）

Codex tip `d6a48880` 指出：`existingEvent` 早退在核对 trustedTenantId / principal / grant 之前返回 `ok/alreadyAuthorized`，并泄漏其他租户提案正文；`APPROVED_FOR_EXPERIMENT` 同 grant 早退亦需重检。

服务层修复（`authorize-shadow-intent.ts`）：

1. 幂等成功前先校验 commandId 绑定（tenantScope + principalRef + proposalId + grantId）与当前可信主体；换绑定 → `command_rebind` / `cross_tenant`。
2. 成功回执前重检 grant：撤销/过期 → `grant_inactive`（显式 fail-closed；不发重放成功回执）。
3. `cross_tenant` / `command_rebind` / `grant_*` 拒绝不附带越权 proposal 正文。
4. `APPROVED_FOR_EXPERIMENT` 同 grant 早退同样要求当前租户可读 + grant 仍有效 + principal 与既有授权事件一致。

测试：`authorize-replay-repro.test.ts`（正：同主体重放；负：跨租户/换 principal/换 grant/撤销/过期/command 重绑定）+ 既有 `authorize-shadow-intent.test.ts`。

状态：**已推送待复验 / 部分验证**。**已推送≠验收通过**；不自行宣告 Codex PASS。

已知限制：真实 HTTP/authz 未跑；runtime-binding 仍无专用治理入口；矩阵保持 **部分验证**，不自行宣告 Codex PASS。

## P1-F 知识库与数据资产物化（虚假可用性修复 + 最小事件物化，2026-10-30）

触发：`event_driven` 曾可保存为“成功”却无执行器；生产探测可能落到 `mock_smoke_ok`。

根因：枚举保留 + 写入未拒；事件总线只触发 Agent，未接 projection materialization。

修复：

- 虚假可用性批次：新建拒绝/迁移路径 + 生产禁 mock（保留）。
- **最小诚实事件物化**（本轮）：`runEventDrivenProjectionsForEvent` 对非 deduped ingest 按 `sourceId` 匹配 enabled `event_driven` bindings，复用 `runProjectionMaterialization`；`events.ingest` RPC 接线；`event_driven` 记为 implemented（**非** clock scheduler）。
- **不宣称**：durable restart queue、有序多消费者 replay、生产限流、完整知识库目标、demo→prod 隔离深化、真实 source auth 扩面。

失败然后通过：

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/enterprise-data/knowledge-publication.test.ts \
  src/gateway/enterprise-data/connector-handler-runtime.test.ts \
  src/gateway/enterprise-data/connector-catalog.test.ts \
  src/gateway/server-methods/enterprise-data-m4.test.ts
```

矩阵：**已推送待复验 / 部分验证**（知识库/数据资产物化）。最小事件物化已接；完整 KB 目标未宣称。**已推送≠验收通过**；不自行宣告 Codex PASS。

## P2-G 模型智能配置（合成中性不得冒充已验证优化，2026-10-30）

触发：`aor_enhanced` + 空/缺成本目录时，`selectModelOrderWithinEffectiveSet` 仍用合成中性档案（cost 1/1）跑 `rankModels`，并把 `strategy` 标成 `cheapest`/`best_quality`，附带 “lowest estimated cost” 解释——冒充经效果验证的智能优化。矩阵此前只读 `platform-models-config.ts`，未证明用户选择改变真实 outbound provider/model。

根因：`profileForRef` 为缺档模型合成中性档案后仍宣称配置策略；`resourceCatalogToAorProfiles` 把缺成本条目以中性价推入目录，掩盖 synthetic_only。

修复（诚实批次；**不**把 embedding governance 从 shadow 改 enforced；**不**扩大授权集合；`native` 仍为合法默认）：

- 全合成 → `strategy: "native"` + `catalogCoverage: "synthetic_only"`，**不**产出 routingExplanation。
- **partial catalog**：仅真实档案进入 `rankModels`；合成中性 peers 按原序追加，不得赢 cheapest/best_quality。
- 缺成本目录条目不再进入 profiles（仅记 `missingCostModelIds`），由 selection 合成并可检测。
- gate 仅在 `selection.strategy !== "native"` 时声明 selectorStrategy / preferredModelOrder。
- 单元证明：真实目录成本下 cheapest/best_quality 的 `preferredModelOrder` 成为 `runWithModelFallback` 的首个 outbound `provider/model`。

调用点覆盖（接线已存在，本轮未改 hot-path 签名）：

| 入口 | 是否经 employee-model-gate / preferredModelOrder | 备注 |
| --- | --- | --- |
| 普通聊天 | 是（`agent-runner-execution.ts`） | 含 images 选项走同一 fallback |
| followup | 是（`followup-runner.ts`） | |
| cron-isolated | 是（`cron/isolated-agent/run.ts`） | |
| subagent | 是（`subagent-spawn.ts` + child-task AOR reorder） | 继承 parent snapshot mode |
| image/PDF | 经 chat/capability-plan modality，非独立 gate | 附件字节估计见 child-spawn |

产品保存路径：系统设置 `onSetPlatformModelsMode` → `gateway.platform.models.mode` → config.set；运行时 `resolvePlatformModelsMode` 读取。缺托管身份时 gate 早退（无 allowlist 强制），mode 仍写入 effectiveRouting，但不伪造 preferredModelOrder。

失败然后通过：

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/model-entitlement/aor-selection.test.ts \
  src/gateway/model-entitlement/aor-catalog-adapter.test.ts \
  src/gateway/models/platform-models-config.p2g.test.ts \
  src/agents/model-fallback.p2g-outbound.test.ts \
  src/gateway/model-entitlement/employee-model-gate.aor.test.ts
```

矩阵：**已推送待复验 / 部分验证**（模型智能配置）。真实 outbound provider HTTP 未跑。**已推送≠验收通过**；不自行宣告 Codex PASS。

## P2-H 定时任务（创建→持久化→到期→送达状态→下次调度，2026-10-30）

目标：Cron 默认开启；长周期 `createCronLedgerSession` 已独立于默认关闭的全局 progress-ledger 开关（保留）。验收创建→持久化→到期执行→**送达**→下次调度；不能把计时器注册、ledger 创建或执行日志单独当成送达。

### 调查结论

可测层已有大量既有覆盖，本轮先复跑再找真实缺口：

| 验收点 | 既有证据 | 本轮 |
| --- | --- | --- |
| 默认开启（`enabled !== false` 且非 `OPENCLAW_SKIP_CRON=1`） | `buildGatewayCronService` 表达式；gateway 测设 skip=0 | 核对表达式，无重复开关 |
| create → persist | `owner-scheduled-task.chain`（默认 `Asia/Shanghai` 08:00）；`CronService.add` | 通过 |
| due fire → next schedule | `service.persists-delivered-status`（推进 `nextRunAtMs`）；`restart-catchup` | 通过 |
| delivered / not-delivered / not-requested | `service.persists-delivered-status`（含 finished 事件） | 通过 |
| announce 多通道 outbound | `isolated-agent.direct-delivery-core-channels`（Slack/Discord/WhatsApp/iMessage，`delivered:true`） | 通过 |
| webhook 送达路径 | `gateway/server.cron.test` posts webhooks… | 通过 |
| restart / missed | `service.restart-catchup` | 通过 |
| Asia/Shanghai | `schedule.test` + owner-scheduled-task 默认 tz | 通过 |
| concurrency | `issue-regressions` `maxConcurrentRuns`；`prevents-duplicate-timers` | 通过 |
| failure retry | `issue-regressions` #24355 one-shot retry | 通过 |
| delete/disable | CRUD patch `enabled:false`；one-shot disable | 通过 |
| model selection | `run.cron-model-override` | 通过 |
| target identity / tenant | `cron.personal-scope`（personal ∩ tenant；跨租户拒绝） | 通过 |
| ledger 独立于全局开关 | `progress-ledger/feature.ts` 注释 + `cron-binding`「flag unset 仍 bind」+ long-horizon 测 | 通过 |

计时器注册、ledger seed、执行日志**单独**均不记为送达；送达以 `delivered`/`deliveryStatus` 持久化与 outbound/webhook 调用为准。

### 真实缺口（修复前失败 → 修复后通过）

1. **完成 ledger 空完成误报**  
   触发：长周期 job 验收已全部 met 后再次 due；`ledgerHasNoWritableStep` 早退 `status:"ok"` 且无 summary。  
   症状：`classifyCronCompletion` 把裸 ok 判为 `empty`→`error`（`cron_completion:empty`），模型虽未跑但调度记失败。  
   根因：`src/cron/isolated-agent/run.ts` 早退未携带真实摘要，与 Batch 8 空完成禁令冲突。  
   修复：早退附 summary `Ledger already complete; no remaining writable step.`（仍不跑模型；不绕过空完成禁令）。  
   证据：`run.long-horizon-ledger.test.ts`「does not run a model when the ledger has no writable step」修复前 `expected 'ok' / received 'error'`，修复后通过。

2. **gateway CRUD list 与 retention 系统任务**  
   触发：非 minimal gateway + `catalogEnabled` 默认 true 时，`ensureConversationRetentionCronJob` 在 `cron.start()` 后写入 `openbot.conversation.retention`。  
   症状：`server.cron.test`「handles cron CRUD…」在 `cron.add(daily)` 后断言 `jobs.length === 1` 失败（实际 2）。  
   根因：测试未承认系统任务共存；非产品禁止用户任务。  
   修复：按 name 查找 `daily` 并断言 delivery；允许 `length >= 1`。  
   证据：同测修复前失败、修复后通过。

### 本轮加强（adapter 证据，仍非 live）

- `service.delivery-adapter-evidence.p2h.test.ts`：`dispatchCronDelivery` → mocked `deliverOutboundPayloads`（断言 channel/to）→ `delivered` 仅在 outbound 有结果时为 true → CronService 持久化 `lastDeliveryStatus=delivered`。
- **不**宣称 live webhook/HTTP；矩阵保持 **部分验证**。

### 未做 / 已知限制

- **真实 HTTP 通道送达**（Telegram/Slack 真网、真 webhook 对端）未跑 → 矩阵保持 **部分验证**。
- 不新增重复 `cron.enabled` feature flag；不把全局 progress-ledger 默认打开。
- 不合并、不部署、不自称 Codex PASS。

### 复跑命令

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/cron/isolated-agent/run.long-horizon-ledger.test.ts \
  src/gateway/server.cron.test.ts \
  src/cron/service.persists-delivered-status.test.ts \
  src/cron/service.restart-catchup.test.ts \
  src/cron/schedule.test.ts \
  src/cron/owner-scheduled-task.chain.test.ts \
  src/gateway/server-methods/cron.personal-scope.test.ts \
  src/progress-ledger/cron-binding.test.ts \
  src/cron/isolated-agent.direct-delivery-core-channels.test.ts \
  src/cron/isolated-agent/run.cron-model-override.test.ts \
  src/cron/service.prevents-duplicate-timers.test.ts \
  src/cron/service.issue-regressions.test.ts \
  src/gateway/server-cron.test.ts \
  src/cron/completion-contract.test.ts
```

矩阵：**已推送待复验 / 部分验证**（定时任务）。**已推送≠验收通过**；不自行宣告 Codex PASS。

