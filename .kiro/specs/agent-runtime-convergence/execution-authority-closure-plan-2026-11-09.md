# OpenBot 执行体系权威收口与组件规范迁移实施方案

- 日期：2026-11-09（Europe/Berlin）
- 编制角色：独立验收方 codex-runtime-manager
- 本次源码抽核基线：`e3fef11c8b40a8ec0ace10a29e2fd82e07c9be66`
- 性质：实施交接方案，不是已完成声明，不授权生产部署。
- 总目标：一个执行体系、一组受控状态入口、一套可查询规则目录。规则可以演进，但不能各自拥有执行控制权。

## 1. 使用本方案前的要求

执行团队先固定实际开工 SHA、刷新 origin/main 并检查祖先关系，记录工作树及其他团队 WIP，按仓库要求登记唯一负责人和实施路径。若基线落后，先单独处理基线同步，不覆盖或暂存他人的改动。

本方案中的源码路径已在上述基线核查存在；文件内完整消费者、配置资产和运行证据仍须在 T1 核实。建议目标路径不是要求创建空目录，已有合理组件应直接复用。

两个输入文档在原工作树 `/Users/daniel/.codex/worktrees/runtime-convergence/openbot/.kiro/specs/agent-runtime-convergence/` 中读取；当前 PR250 工作树没有这两个文件。执行团队应先获取、保留它们的原文及内容指纹，不要假定它们已提交进候选版本：

1. `collab-policy-state-migration-boundary-2026-11-09.md`
2. `individual-policy-state-closure-slices-2026-11-09.md`

它们的定位基线是 `5b46483c9`，不构成当前版本验收证据。原切片与本方案冲突时，采用本方案的先核准、后迁移原则，不机械搬迁旧规则。

## 2. 不变边界与非目标

1. 不新增功能、新调度器、通用脚本规则引擎或并行 runtime。
2. 交互与执行分离；普通问候、直接问答不因入站而创建任务。交互也可加载身份、历史、知识和记忆。
3. 长任务与短任务共用主流程，通过等待、恢复和限制策略体现差异；不另造长任务执行器。
4. 个体任务、群 ClaimContract、执行者私有计划三个作用域分离。
5. 共享生命周期，不强制所有场景走 runAdmittedTurn。聊天、操作者命令、定时和排队续跑可保留不同受控宿主。
6. 执行结束、目标完成、成果验收和实际送达分别记录。投递失败不得改写为执行失败；仅重投不得重跑业务。
7. 不按旧名称删除 embedded/CLI 后端、legacy-primary-supplement、hooks、Lobster、OpenProse。
8. 不改变既有提示词字节、排序、信任等级、模型调用次数、开关默认值和权限语义，除非发现并单独证明缺陷。
9. 无生产部署、Gateway 重启、真实渠道外发授权；飞书测试继续保持跳过。真实测试如需新增授权，独立提出。

## 3. 最终结构与依赖要求

| 区域         | 权威职责                                         | 不允许                         |
| ------------ | ------------------------------------------------ | ------------------------------ |
| contracts    | 主题化数据和接口契约                             | 行为实现、任意参数袋           |
| command      | 交互解释、目标关联、准入、个人与协作编排         | 深入工具循环、裸写存储         |
| execution    | 已准入工作推进、尝试、等待及恢复生命周期         | 二次语义分类、关闭群契约       |
| delivery     | 验收、展示、成果与实际投递回执                   | 根据回复非空推断送达           |
| context      | 供三层使用的来源读取边界、选择、信任、预算、装配 | 掌握任务准入或完成权           |
| capabilities | 工具、MCP、插件和连接器调用适配                  | 用声明元数据授予权限           |
| policy       | 快照到决定的纯规则、合法转移和限制               | IO、模型调用、调度和状态写入   |
| state        | 各作用域的存储、原子变更、身份版本校验           | 拼提示词、渠道投递             |
| model        | 身份、授权、预算、回退、计费、取消的共享治理     | 自己创建任务或成为执行宿主     |
| wiring       | 绑定依赖与公开端口                               | 新增业务判断                   |
| 外部 adapter | Gateway、渠道、定时等接入和触发                  | 独立分类、关闭、恢复或重试权威 |

依赖按具体接口声明，不以笼统的“所有层从上往下”代替依赖图。policy/contracts 不反向依赖宿主；execution 不依赖 wiring；外部消费者经公开入口进入。state 可以在锁内使用纯 policy；跨域编排由 command/受控宿主组织。不得通过 barrel 引入循环依赖。

## 4. 旧组件—目标职责—设计文档对应表

下文设计文档均相对 `.kiro/specs/agent-runtime-convergence/`。

| 旧组件/现役锚点                                                                                              | 处置与目标                                                | 对照文档                                                                             | 工作项 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| conversation-task/turn-relation.ts                                                                           | 拆开现役谓词与旧分类器；必要纯规则进 policy，重复分类归档 | individual 文档；archive/interaction-retirement-2026-11-05.md；command-public-api.md | T3     |
| conversation-task/focus-switch.ts                                                                            | 核准启发式消费者；纯规则、transcript IO、文案分别归位     | individual 文档；authority-map.md                                                    | T3/T7  |
| conversation-task/focus-policy.ts                                                                            | 核准槽位/任务容量语义；纯 wake 规则进 policy，触发留宿主  | transition-baseline.md；individual 文档                                              | T3/T4  |
| conversation-task/reply-completion.ts                                                                        | 拆清完成条件、ledger 编排与板事务；核准部分成功窗口       | task-close-audit.md；delivery-outlet-map.md                                          | T4     |
| conversation-task/session-task-board.ts                                                                      | 保留必要门面直至消费者迁完；不得新增长期业务实现          | core-contract-map.md；completion-gates.md                                            | T4/T8  |
| conversation-task/control-plane.ts、ledger-binding.ts                                                        | 保留领域含义，不粗并会话板；证明是否仍有独立控制权        | original-intent-preservation.md；retirement-intent-contract.md                       | T4/T8  |
| task-orchestration/complex-task-loop.ts                                                                      | 核实配置与消费者；观察不控权，重复分类/关闭归档           | retirement-intent-audit.md；extension-disposition.md                                 | T3/T8  |
| gateway/collaboration-dispatch/effective-policy.ts                                                           | 不变量、模板、权限及类型按职责拆分                        | collab 文档；scenario-architecture.md                                                | T5     |
| 同目录 policy-compiler.ts、policy-compiler-sections.ts、policy-compiler-hash.ts、resolve-effective-policy.ts | 纯编译/哈希归 policy；宿主仅供快照和配置；保留 hash 语义  | collab 文档；wiring-policy-boundaries.md                                             | T5     |
| 同目录 submit-review-versioning.ts、governance-gate.ts、plan-gate-exec.ts                                    | 纯规则唯一归 policy；IO 留对应事务/宿主                   | collab 文档；authority-map.md                                                        | T5     |
| 同目录 peer-review-gate.ts                                                                                   | 分离评审判定和评审事实事务                                | collab 文档；scenario-architecture.md                                                | T5/T6  |
| 同目录 claim-contract.ts                                                                                     | 合法边进 policy；群板锁内事务进 state；领域编排归 command | collab 文档；retirement-intent-contract.md                                           | T5/T6  |
| 同目录 executor-private-todolist.ts、handoff-contract.ts                                                     | 私有计划/交接状态进独立 state 作用域，编排与判定分离      | collab 文档；scenario-architecture.md                                                | T6     |
| 同目录 legacy-production-executor.ts、round-runtime/decision/wake/floor 相关文件                             | 保留现役行为；区分领域编排、适配与策略，不整目录删除      | scenario-architecture.md；original-intent-preservation.md                            | T6/T8  |
| auto-reply/reply/get-reply-run.ts、agent-runner.ts                                                           | 受控回复宿主；逐项核准是否残留第二决策权威                | admitted-turn-ownership.md；execution-ports-plan.md                                  | T1/T8  |
| commands/agent.ts、cron/isolated-agent/run.ts、auto-reply/reply/followup-runner.ts                           | 保留场景宿主，共用 controlled lifecycle；不强并入口       | candidate-extraction-map.md；candidate-invariants.md                                 | T1/T9  |
| agent-runtime/execution/runner/embedded-attempt\*.ts、embedded-run.ts、cli-run.ts                            | 保留执行后端；验证拆分顺序、清理和失败结算                | phase-split-repair-20261109.md；execution-five-stage-map.md                          | T7/T9  |
| auto-reply/reply/groups.ts、runtime-context-assembly.ts                                                      | 群材料归 context；个人路径不误加载群材料                  | context-source-map.md；context-component-plan.md                                     | T7     |
| agents/system-prompt\*.ts、agent-runtime/context/system-prompt.ts                                            | 保留必要宿主 IO；纯投影唯一归 context，不造空统一服务     | builder-component-contract.md；context-budget-map.md                                 | T7     |
| agent-runtime/capabilities/catalog.ts、Tool/MCP/插件适配                                                     | 声明与授权分离；保持 unknown/not_declared 的真实性        | extension-disposition.md；admitted-backend-port.md                                   | T7     |
| hooks transform、Lobster、OpenProse 的加载/恢复路径                                                          | 定位真实入口、配置、用户资产、token 后逐项决定保留或退役  | extension-disposition.md；retirement-gates.md                                        | T8     |
| agent-runtime/state/repository/async-wait-\*、delivery/dispatch/confirm-pending.ts                           | 保留恢复主链与确认权威，防旧回调、重复执行与重复送达      | completion-gates.md；package6-same-sha-acceptance.md                                 | T4/T9  |

表中前三列为迁移线索，不等于已核准结论。不得把历史文档中的路径或描述直接当当前消费者事实。

## 5. T0—T2：开工盘点与规则目录

### T0 固定基线与归属

输出开工 SHA、origin/main、分支、脏文件、暂存区和任务登记。只处理本任务文件。仓库规则要求的阶段提交使用 scripts/committer，附 Task/Agent；不自行推送或部署。

### T1 权威和消费者盘点

对每项建任务、准入、推进、修订、停止、恢复、验收、关闭、投递行为，记录：

`行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置`

检索必须覆盖 src、extensions、scripts 和配置 schema；区分产品调用、测试、再导出、动态加载。不要只统计 import。每个疑似旧组件给出原设计意图和“迁移/适配保留/观察保留/归档退役/证据不足”结论。

必须更新事实：当前抽核 classifyTurnRelation 的生产调用在 complex-task-loop；Gateway 使用 shouldTaskParkAbortInFlight。不能把整个 turn-relation 视为 Gateway 必需分类器。

### T2 可查询规则目录

优先扩展现有 policy/catalog.ts，不另造第二目录。记录：

`id、category、owner、scope、implementation、enforcementPoints、version、dependencies、configuration、tests、retirementCondition`。

- 系统不变量：身份隔离、版本校验、取消围栏等，代码强制；无普通关闭开关。
- 产品策略：重试、容量、评审等，有类型配置，可版本化。
- 交互/质量偏好：提示频率、风格等，归 context/delivery。
- 数据契约不是规则；ClaimContract 是领域对象，不是可开关脚本。

目录可通过类型化读取和现有审计工具查询；本轮不新增管理 UI、任意脚本、表达式求值器或自动规则调度器。仍未盘全时明确标记覆盖范围。

验收：T0—T2 独立评审通过，才开始行为迁移。

## 6. T3—T4：个体主链收口

### T3 分类和焦点

1. 对 I0 双源做样本等价测试。槽位上限与任务容量不是因为都等于 3 就合并；输入清洗不同则先解释差异。
2. 对 I1 分开现役安全谓词、旧语义分类与辅助标题生成。重复语义分类不升级为新 policy 权威。
3. 对 I2 分离 wake 资格判定、认领事务、唤醒动作；心跳不得隐式新建或重规划任务。
4. 对 I3 只迁确有现役消费者的纯判定；transcript IO 留明确 adapter；文案归 context。
5. 全部交互仍由 command 解释并准入；活动任务不是额外“插话类型执行器”。

### T4 完成与状态事务（优先于大范围搬迁）

当前 reply-completion.ts 存在先 transitionTask(closed)、后 recordCheckedTaskCompletion 的顺序，须用失败注入核准是否可能部分成功；不能直接断言现网已故障。

分别定义 ConversationTask、ledger、SessionTaskBoard 的关闭含义。不同领域允许不同状态，但不得对外虚报。若需要联动，明确成功条件、拒绝、重试和对账；优先复用既有幂等/版本机制，不新建总控或通用分布式事务框架。

必须测试：绑定错配、会话板写入失败、ledger 写入失败、重复关闭、旧 attempt、验收失败、静默/占位、投递未知。投递确认只经既有 delivery/state 受控入口。

异步等待须验证 job/token/attempt/run 身份、锁内认领、失效持有者回收、暂停取消围栏、重启恢复和仅重投原成果。协作与个人准入差异必须保留，不额外强建个人任务板。

## 7. T5—T6：协作规则与事务收口

### T5 纯规则

按依赖而非文件大小迁移：不变量/类型 → 编译及 hash → 提交版本/治理/评审/计划门槛 → 状态转移。

每片使用相同输入验证旧新输出等价；涵盖 L2 不放宽 L1、默认值、provenance、hash、非法状态边、空提交、重复提交、非作者评审。保持实际 flag 默认及现有启用状态，不一律改 OFF。

### T6 事务与领域编排

建议目标为 state 下协作子域和 command 下协作子域，具体文件名由既有依赖确定：

- 群板 ClaimContract：publish/claim/apply/inProgress/submit/review/accept/return/block/cancel。
- 私有计划：propose/confirm/revise/superseded，不能误变群共享板。
- 评审与交接：事实追加、责任快照、版本校验。
- 编排：回合、认领后的推进、评审集成、唤醒决策归领域组件；Gateway 最终仅请求/事件/连接适配。

保持读取、合法性检查、版本比较、追加在同一锁内；fan-out 和渠道动作在提交成功后锁外执行。验证并发认领、旧版本接受、提交后修订、取消与回调竞争。

legacy-primary-supplement 不因名称退役。先抽离依赖和权威，再决定兼容入口是否仍必要；不得顺便修改 Floor 发言机制或协作选人行为。

## 8. T7—T8：供给归位和旧路径退役

### T7 上下文及能力

为每个模型入口画出 read → select/order → render → audit → model messages 调用链。Builder 的读取、副作用、投影与审计分离；调用次数、顺序、预算、信任及暴露记录有测试。SessionManager/JSONL 权威历史不是可随意丢弃的可选 context source。

个人与协作分别装配；缺少群上下文不是自动回退个人权限的理由。embedded 尝试报告若不是第二套编译器，明确说明即可，不造空服务。

工具/MCP/插件经能力边界调用；权限、限制性修订在真实动作前执行。未知取消/幂等能力继续诚实声明 unknown/not_declared。只修实际接管断点，不扩完整适配器平台。

### T8 退役条件

每项退役必须有：原设计意图、生产消费者、动态配置、未完成任务/恢复资产、替代链、归档位置、删除范围、回归证据、回退办法。

允许删除：已无生产消费者、无恢复资产且替代链已接上的重复实现。保留适配器只能单向委托，不得复制判断。若既有 archive tag 机制要求不可变归档，沿用它；不要悄悄丢弃历史测试。

hooks/Lobster/OpenProse 配置与资产证据不足时保留并注明未知；不得称全面清空。规则开关切换也不能遗弃在途 token 或让旧回调绕过新围栏。

## 9. 原切片覆盖矩阵

| 原切片                                          | 本方案 | 决策                           |
| ----------------------------------------------- | ------ | ------------------------------ |
| 个体 I0                                         | T2/T3  | 等价后去重，非同义不硬合       |
| 个体 I1                                         | T3/T8  | 现役谓词迁移，重复分类核准退役 |
| 个体 I2                                         | T3/T4  | 判定、认领、唤醒分离           |
| 个体 I3                                         | T3/T7  | 仅保留必要规则与 IO 适配       |
| 个体 I4                                         | T4     | 提前核准完成一致性             |
| 协作 S0                                         | T2/T5  | 不变量唯一实现                 |
| 协作 S1                                         | T5     | 提交版本规则                   |
| 协作 S2                                         | T5/T6  | 治理/评审判断与写入分离        |
| 协作 S3                                         | T5/T6  | 计划门槛与计划事务             |
| 协作 S4                                         | T5/T6  | 转移与锁内事务                 |
| 协作 S5                                         | T5     | 编译/hash 等价                 |
| 协作文档未单列切片的私有计划、handoff、评审写入 | T6     | 显式纳入，不遗漏               |

## 10. T9 同版本测试与验收

### 10.1 测试方法

使用 OPENBOT_TEST_PROFILE=low，必要时 OPENBOT_TEST_SERIAL_GATEWAY=1；不盲跑全库。先读取 package.json 确认命令，按切片运行已有相关测试和新增回归。逻辑缺陷新增 red→green；纯移动用旧新等价/稳定性/顺序测试，不为目录变化写无价值测试。

每批执行类型检查、改动文件 lint/format、架构门禁和 diff-check。涉及 lazy import 边界时按仓库要求构建并记录动态 import 警告，不能重启生产。基线失败需同环境同命令对比；不得自动称为既有失败。

### 10.2 最终行为矩阵

| 场景         | 必须证明                                              |
| ------------ | ----------------------------------------------------- |
| 普通聊天     | 不建任务、不启动工具执行层                            |
| 明确任务     | 目标/验收/待办经受控准入                              |
| 活动期间交流 | 查询不改目标；修订作用正确目标；无第二语义路由        |
| 控制         | 暂停/取消实际生效；旧回调拒绝                         |
| 异步与重启   | 可恢复、无重复业务/投递、原身份不串                   |
| 成果失败     | 验收失败保持未完成                                    |
| 投递失败     | 执行成功独立可查；仅重投同版本原成果                  |
| 协作         | 认领→成员执行→提交→评审→集成→组投递；成员不关闭群契约 |
| 上下文       | 个人/群隔离；预算/信任/顺序/调用次数未退化            |
| 成果链       | 预览、保存、编辑版本、下载一致；真实 PPT 渲染另验     |

记录 current SHA / dirty diff 指纹 / 测试文件 / 命令 / 数量 / 失败与未跑原因。修复生产源码后相关证据失效，须重跑；不得把旧 SHA Package6 或模拟结果当当前真实终验。

真实模型、真实渠道、协作真实终局、PPT 实物是独立运行格。未授权或环境不具备就标 GAP；源码结构验收通过不等于上线完成。

## 11. 执行批次、交付物和放行

| 批次 | 范围  | 独立验收放行                             |
| ---- | ----- | ---------------------------------------- |
| A    | T0—T2 | 权威、消费者、分类目录准确后开 B         |
| B    | T3—T4 | 个体准入/状态/完成闭环后开 C             |
| C    | T5—T6 | 协作三作用域及事务闭环后开 D             |
| D    | T7—T8 | 供给边界和退役证据通过后开 E             |
| E    | T9    | 同版本源码验收；运行缺口另列，不自动部署 |

每批一个明确负责人；旧组件所有者交接后才改，保持小步绿色提交。不同时修改个人和协作热文件，跨批依赖通过已核准接口衔接。

建议在 spec 下提交以下成果（不要重复造已有表，优先更新并标明版本）：

1. `execution-authority-inventory.md`：所有决策、写入口和消费者。
2. `component-migration-matrix.md`：组件原意、归属、依赖、处置和状态。
3. `rule-catalog-coverage.md`：机器目录覆盖及未盘点项。
4. `retirement-disposition.md`：归档、删除、保留理由及恢复资产。
5. `acceptance-<source-sha>.md`：命令、原始日志位置、结果与 GAP。

每项状态只用：未开始、核准中、实施中、待验收、通过、阻塞、保留有因。不得用“目录已齐”代替“权威已收口”。

## 12. 独立验收方检查清单

- [ ] 任一任务控制行为能指出唯一权威和真实执行位置。
- [ ] 任一状态写入可追到受控事务；跨作用域部分失败有明确定义。
- [ ] 普通交流不进入任务执行；修订和控制不被重复分类。
- [ ] 各场景共享受控生命周期，但没有强并成一种参数形状。
- [ ] 规则可查、可追踪、可依法替换；配置无脚本和隐藏调度。
- [ ] 必要历史设计已承接；重复和冲突机制归档而非硬迁。
- [ ] Gateway/旧门面没有残留第二套任务控制权。
- [ ] 保留的 CLI/embedded/协作后端身份明确，不误算成重复主链。
- [ ] 三板分离，验收与实际投递分离。
- [ ] 当前 SHA 证据齐全；真实运行 GAP 与源码结论分别陈述。

最终结论必须分别回答：结构是否统一、权威是否唯一、主链是否闭环、旧控制路径是否退役、运行上线是否具备条件。不得以其中一项通过代替全部通过。
