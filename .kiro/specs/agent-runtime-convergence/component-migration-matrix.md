# T1 组件迁移矩阵（component-migration-matrix）

- 日期：2026-11-09（Asia/Shanghai）
- 分支：`codex/openbot/runtime-authority-closure`
- 开工 / 抽核 SHA：`efdb1b98d83e096a31e251095080de954f5883ec`（`#250`/`#252` 已合入 main）
- 性质：**T1 规格**；对照 `execution-authority-closure-plan-2026-11-09.md` §4 与工作项 T3–T8。
- Batch B 更新（2026-11-09）：`4ce9c442` 独立验收驳回。修正证据见 `batch-b-acceptance-rejection-fix-2026-11-09.md`。下列 T3/T4 行仍是待验收，不是通过。
- 处置枚举：`迁移` | `适配保留` | `观察保留` | `归档退役` | `证据不足` | `已在main接续`
- 状态枚举：`未开始` | `核准中` | `实施中` | `待验收` | `通过` | `阻塞` | `保留有因`
- 冲突原则：原个体/协作盘点与方案冲突时，**先核准后迁移**；已在 main 的实现 **接续或等待**，禁止从旧 tip 重做。
- 配套：`execution-authority-inventory.md`（行为级消费者）。

> 注：仓库另有历史 `migration-matrix.md`（更早 tip 的目录层计划）。**本文件为 T1 权威收口用组件矩阵**，以 efdb1b98d 现役路径为准，不覆盖或假装更新旧矩阵的「未迁移」总述。

## 矩阵

<!-- prettier-ignore -->
| 旧组件 / 现役锚点 | 原设计意图 | 当前路径（main efdb1b98d） | 目标归属 | 依赖 | 处置 | 状态 | 对照 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `conversation-task/turn-relation.ts` | 回合关系：安全中止谓词、owner 约束谓词、旧 amend/conversation/new_work 分类、title re-export | 分类器仍在 turn-relation；abort 谓词已拆到 `park-abort.ts` 并由本文件 re-export；title 仍 re-export context | policy：仅现役安全/约束谓词；**不**把 `classifyTurnRelation` 升权威；重复分类→归档 | policy/input-stamp；Gateway chat；session-task-board 约束路径；complex-task-loop（dormant） | **迁移**（谓词）+ **观察保留→归档退役**（整包分类器） | 待验收 | T3 / T8 |
| `classifyTurnRelation` | 旧语义分流（与 command `interpretInteraction` 重叠风险） | 唯一定义于 turn-relation；**唯一源码调用** `task-orchestration/complex-task-loop.ts:186`；shaping API **无生产 importer**；orch dispatch 默认 OFF | 不进入新 policy 权威；核准后归档 | observe-gate / feature flags / allowlist | **观察保留** → 条件满足后 **归档退役** | 核准中 | T3 / T8 |
| `shouldTaskParkAbortInFlight` | 切焦点时是否 abort in-flight / 清队列 | 实现 `policy/explicit-task-control.ts`，经 `policy/index` 导出；Gateway `chat.ts` 直接 import 该入口；turn-relation 与 park-abort 只 re-export | policy 安全谓词 | chat abort / embedded abort / queue clear | **迁移** | 待验收 | T3 |
| `isOwnerConstraint*` / `shouldPersistOwnerConstraint` | 约束修订 vs 全量替换 vs 是否落盘 | turn-relation；由 `session-task-board` 约束辅助调用 | policy 纯谓词；写仍 state | state `appendTaskConstraint` | **迁移** | 核准中 | T3 |
| `conversation-task/focus-policy.ts` | FOCUS/PARKED **执行槽**调度、`decideWake`、heartbeat 禁动作 | `evaluateWakeEligibility` 在 policy 公共入口；`decideWake` 与 `MAX_PARKED_SLOTS` 仍在本文件；写板仍 state | policy 资格判定；动作留本文件；写板仍 state | FocusSnapshot；board enrich；`MAX_PARKED_SLOTS` | **迁移** | 待验收 | T3 / T4 |
| `MAX_PARKED_SLOTS` | 执行槽位上限（非任务基数 cap，见文件头注释） | `focus-policy.ts` =3；与 `MAX_PARKED_TASKS` 分属不同模块 | 独立命名；**勿与 TASKS 硬合** | decideWake park 路径 | **适配保留** | 待验收 | T3（I0） |
| `policy/task-board-limits.MAX_PARKED_TASKS` | 会话板 parked **任务**容量与续跑窗口 | **已在** `agent-runtime/policy/task-board-limits.ts`；`task-record.parkTask` 使用 | policy（已落位） | state park / completion-notice | **已在main接续** | 通过（相对本切片） | T3 / T2 |
| `conversation-task/focus-switch.ts` | 用户消息焦点切换启发式 + transcript 只读 IO + fence 文案 | 仍在；stamp re-export policy；title 委托 context；transcript 读取留本文件 | 纯判定→policy；IO→adapter；文案→context | session 文件；qualifyTurn | **迁移** | 待验收 | T3 / T7 |
| `stripInboundStamp` 多源 | 去入站 GMT 戳 | 权威：`policy/input-stamp.ts`；focus-switch re-export；dialogue 委托同一函数 | 单一 policy 实现；旧处 import/re-export | 多判定链 | **迁移** | 待验收 | T3（I0） |
| `conversation-task/reply-completion.ts` | 成功回复后关闭 CTR + ledger + 触发会话板完成；delivery-close consult | 板状态、notice 追加、CTR close 分三次调用。notice 只在 `transitionTask` 返回后写。缺 sessionFile 或缺 binding 不算 independent。activation 默认 OFF | 编排留 conversation-task adapter；完成写只经 state | store / ledger-binding / session completion / completion-notice | **适配保留** | 待验收 | **T4** |
| `conversation-task/session-task-board.ts` | 会话任务板门面：曾含实现，现大量 re-export | facade → `agent-runtime/state|policy|contracts|context`；仍含少量约束/分类辅助 | 兼容门面直至消费者归零；禁止新增长期业务实现 | 大量 Gateway / agents / auto-reply / async-wait | **适配保留** | 保留有因 | T4 / T8 |
| `conversation-task/control-plane.ts` | CTR 激活控制面（SQLite） | 仍在；activation / bootstrap / degrade | 保留领域含义；不粗并会话板 | feature flags；store | **适配保留** | 保留有因 | T4 / T8 |
| `conversation-task/ledger-binding.ts` | Conversation ledger 关闭与工具观察 | reply-completion；embedded-attempt 观察创建 | 独立权威；与板完成联动条件写清 | cron store；tool observations | **适配保留** | 保留有因 | T4 / T8 |
| `task-orchestration/complex-task-loop.ts` | 可选四步可见报告 / shaping；默认关 | 文件在；**无生产 importer**；flags 默认 OFF | 观察不控权；不得第二关闭权 | turn-relation classify；observe-gate | **观察保留** | 保留有因 | T3 / T8 |
| `gateway/collaboration-dispatch/effective-policy.ts` | L1 不变量、模板、权限类型 | 不变量与模板在 `policy/collaboration-rules.ts`；本文件 re-export 并保留 EffectivePolicy 类型 | policy | resolve / compiler | **迁移** | 待验收 | T5 |
| `policy-compiler.ts` + sections + hash | `compileEffectiveCollaborationPolicy` 与 hash | 算法、分段、hash、模型类型在 policy；本文件只 re-export。组合根 `resolve-effective-policy.ts` 仍读 operating state / overlay | policy；同输入同 policyHash | effective-policy 类型 | **迁移**（算法）+ **适配保留**（组合根） | 待验收 | T5 |
| `resolve-effective-policy.ts` | 唯一组合根（喂 operatingState/overlay） | 仍在；learning / policy-lane / round-snapshot 消费 | 迁移期薄壳可留 Gateway/command；算法进 policy | compiler | **适配保留**（壳）+ **迁移**（算法） | 未开始 | T5 |
| `submit-review-versioning.ts` | 提交版本/空/重复规则 | 纯函数在 policy；本文件只 re-export | policy | claim-contract | **迁移** | 待验收 | T5 |
| `governance-gate.ts` | 治理门纯判定 | 判定在 policy；本文件只 re-export。未改确认模式 | policy | 角色/模式 | **迁移** | 待验收 | T5 |
| `peer-review-gate.ts` | 评审判定 + 评审事实写 | accept 计数判定在 policy。锁内 jsonl 追加走 `state` `appendPeerReviewLog`。质量账本仍在锁外。默认仍 OFF；不驱动 Admission | policy 判定 + state 事实 | claim accept | **迁移** | 待验收 | T5 / T6 |
| `plan-gate-exec.ts` | 交付执行门 / board-todolist mapping | 状态映射在 policy；执行包组装仍在本文件。未与 ClaimContract 合并 | policy + 现宿主组装 | private todolist | **迁移** | 待验收 | T5 / T6 |
| `claim-contract.ts` | 群 ClaimContract 状态机与锁内事务 | 合法边在 policy。读-校验-追加由 `mutateBoardClaimLog` / `appendBoardClaimLog` 在 state 持锁完成。唤醒仍在锁外。默认仍 OFF。存储目录仍是群板，不是会话板 | 合法边→policy；锁内 RMW→state | round lock；effective policy | **迁移** | 待验收 | T5 / T6 |
| `executor-private-todolist.ts` | 成员私有计划（非群共享板） | 仍独立目录。确认判定在 policy。propose/confirm/revise 的锁内追加走 `commitPrivateTodolistLog`，不写入群板 | **独立 state 作用域** | claim item + owner | **迁移** | 待验收 | T6 |
| `handoff-contract.ts` | 交接分类与 apply / 责任快照 | 分类在 policy。accept/approve/apply 的锁内状态复核、事实顺序和 txn 恢复在 `state/collaboration/handoff-txn.ts`。本文件只做 flag、身份、配置和锁外 wake。存储原语在 `state/repository/durable-json.ts`，不再由 state 引用 Gateway | policy 纯分类 + state 事务 | governance-gate | **迁移** | 待验收 | T6 |
| legacy-primary-supplement / round-runtime / decision / wake / floor* | 协作回合、发言、唤醒等现役行为 | 仍在 collaboration-dispatch 及周边 | 区分领域编排 vs adapter vs 策略；**不整目录删除**；Gateway 最终仅请求/事件/连接 | Floor / LIVE 相关 flag | **适配保留**（迁移期暂留） | 保留有因 | T6 / T8 |
| `auto-reply/reply/get-reply-run.ts`、`agent-runner.ts` | 受控回复宿主 | 仍在；`runAdmittedTurn` 经 wiring | 保留宿主；核准无第二决策权威 | execution / command wiring | **适配保留** | 保留有因 | T1 / T8 |
| `commands/agent.ts`、`cron/isolated-agent/run.ts`、`followup-runner.ts` | 场景入口（命令/定时/续跑） | 仍在；共用 controlled lifecycle 片段 | 保留不同受控宿主；不强并入口 | claimQueuedExecution；confirmPending | **适配保留** | 保留有因 | T1 / T9 |
| `agent-runtime/execution/runner/embedded-attempt*.ts`、`embedded-run.ts`、`cli-run.ts`、`admitted-*.ts` | 执行后端 / 已准入候选 | **已在** agent-runtime（#250/#252 收敛） | execution（已落位） | binding；lifecycle；failover | **已在main接续** | 通过 | T7 / T9 |
| `agent-runtime/command/*`（interpret / route / admission / stop / task-status） | 交互解释与命令用例 | **已在** agent-runtime（#250） | command | state ports；inference | **已在main接续** | 通过 | T1 / T3 |
| `agent-runtime/policy/*`（binding/limits/explicit-control/constraints/queue/run-limits/catalog/input-stamp…） | 个体纯规则子集 | **已在**；catalog 自述非完整清单 | policy；T2 扩展 catalog | state / execution 检查点 | **已在main接续** | 通过（子集） | T2 / T3 |
| `agent-runtime/state/mutations/*` + `repository/async-wait-*` + task-board-file | 会话板事务与 async-wait | **已在**；session-task-board 多为 facade | state | 文件锁 / claimToken | **已在main接续** | 通过 | T4 / T9 |
| `agent-runtime/delivery/dispatch/confirm-pending.ts` | 投递确认权威 | **已在**；wiring + followup/dispatch 消费 | delivery | pending-delivery；completeChecked | **已在main接续** | 通过 | T4 / T9 |
| `agent-runtime/capabilities/*` | 工具/MCP/插件目录与调用适配 | **已在**（#250） | capabilities；声明≠授权 | execution before-call | **已在main接续** | 通过 | T7 |
| `auto-reply/reply/groups.ts`、`runtime-context-assembly.ts`、system-prompt* | 群材料与提示装配 | `selectContextCatalog` 只看显式协作绑定；`ChatType==="group"` 不选群目录。个体装配拒绝群层 id。协作顺序仍是 `COLLABORATION_MEMBER_CONTEXT_ORDER`。章节表仍在 `agents/system-prompt.ts` | context；个人路径不误载群材料 | Builder IO | **迁移** | 待验收 | T7 |
| hooks transform / Lobster / OpenProse | 扩展工作流加载与恢复 | 仍保留。`retirement-disposition.md` 记录消费者、配置和恢复资产未知，不删除 | 逐项保留；证据不足不称清空 | plugin SDK；用户资产 | **证据不足** | 保留有因 | T8 |
| Gateway `server-methods/chat.ts`（focus/control/dispatch） | 请求入口与事件转接；迁移期暂留编排副作用 | 现役主链入口；调用 park-abort / focus-switch / sessionTaskState / reply-completion consult | **最终**仅 adapter；编排归 command | 全链路 | **适配保留**（迁移期暂留，禁止写成终态） | 保留有因 | T6 / T8 |

## 与原切片覆盖（方案 §9）

| 原切片                      | 本矩阵落点                             | 决策（不变）                      |
| --------------------------- | -------------------------------------- | --------------------------------- |
| 个体 I0                     | STAMP-STRIP / LIM-PARKED-\* 行         | 等价后去重；非同义不硬合          |
| 个体 I1                     | turn-relation 拆行                     | 现役谓词迁移；分类器不升权威      |
| 个体 I2                     | focus-policy 行                        | 判定/认领/唤醒分离                |
| 个体 I3                     | focus-switch 行                        | 必要规则 + IO 适配                |
| 个体 I4                     | reply-completion 行                    | **提前**完成一致性                |
| 协作 S0–S5                  | effective-policy → claim-contract 诸行 | 行为锁定非文件搬家；flag 保留默认 |
| 私有计划 / handoff / 评审写 | 对应行                                 | 显式纳入 T6                       |

## 建议实施顺序（盘点，非自动开工）

1. T1 本矩阵验收通过后 → T2 扩展 `policy/catalog`（不另造第二目录）。
2. T4 完成态窗口（reply-completion）**优先于**大范围搬迁。
3. T3：I0 等价证明 → 安全谓词小批 → focus-wake；**禁止**整包 classify。
4. T5→T6：协作纯规则→锁内事务；Gateway 标「暂留」并设退出条件。
5. T7 context/capabilities 断点；T8 仅在消费者归零 + 恢复资产核准后删。

## 明确不做

- 不把「目录已在 agent-runtime」写成「权威已全部收口」。
- 不从 `#250/#252` 合入前 tip 重做已在 main 的 execution/command/state/delivery。
- 不把 Gateway 暂留写成最终领域归属。
- 不统一把 collaboration/orch/CTR flag 改 OFF 冒充安全迁移（本 tip 多数已是默认 OFF；迁移须保留迁移前默认/配置/启用行为）。
- 本轮 **只写规格**；无业务代码变更、无 commit/push/PR。
