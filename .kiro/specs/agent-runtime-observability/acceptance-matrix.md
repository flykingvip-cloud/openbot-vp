# Agent Runtime 独立验收矩阵

审阅人：codex-observe-contract；日期：2026-11-07（Asia/Shanghai）。
本轮源码审阅基线：73734031d；追加核验成本 collector 提交 3860879c1；可信隔离宿主装配测试已提交为 17828d3b1。
本报告不是上线说明，不授予生产配置写入、自动实验、推送或部署权限。

## 证据等级与验证范围

- 代码：本工作树源码与原方案 P0–P4 条目逐项对照。存在接口不代表生产有数据。
- 隔离测试：临时目录、注入端口、组件和 Chromium 验证；不能描述为生产验证。
- 总控最新联合回归：31个文件、249项测试全部通过；P4针对性15项通过，项目tsgo及五文件Lint/格式通过。此前UI Chromium21项与UI build通过属于各自验证范围（pin sync skipped；既有构建警告保留），不与历史测试数累加。被动活动接线不等于连续探测分母或在线率已实现。独立贡献者本轮仅更新文档，未重复上述代码验证。
- 真实网关：本任务未提供已运行网关的请求/事件/版本回读验收记录。
- 生产：未部署、未验证；观测开关未由本任务在生产开启。
- 原始 16 份材料的完整清单未提供；已定位和审阅的候选不能代替完整材料验收。

## P0 口径与数据

| 原条目                   | 实际实现及源码                                                                           | 隔离验收                                             | 真实网关/生产 | 判断与剩余缺口                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| P0-1 指标字典            | src/observation/metric-dict.ts：三项版本化定义、窗口、分母、来源、门禁及 UI 映射         | 字典契约测试；保持现有 finite-latency 技术完成率算法 | 均未验        | 字典已实现；业务闭环聚合仍受来源和 cohort 门禁，不能称已采集业务指标                            |
| P0-2 telemetry 时间窗    | src/gateway/agent-runtime-store.ts 按真实样本时间过滤；保留 agent-runtime.list-telemetry | 窗外和边界测试                                       | 均未验        | 过滤实现；真实持续 telemetry 写入覆盖未证明                                                     |
| P0-3 provenance          | 类型及 seed/injected/record 路径区分，旧缺失来源 unknown                                 | 来源与混入反例                                       | 均未验        | 来源标识契约成立；unknown 不升级 live                                                           |
| P0-4 execution_only 语义 | ui/src/ui/observation/model.ts、stream.ts 保留连接窗口语义及未知业务/成本                | UI/契约测试                                          | 均未验        | 未将工具或 lifecycle 完成冒充任务成功                                                           |
| P0-5 现状矩阵            | out/agent-runtime-observability-optimization-plan.md 存在；本报告增量核验                | 文件审阅                                             | 不适用        | out/ 仍未跟踪，不能声称方案文档已提交；历史 tasks.md 注记描述阶段当时状态，最终判断以本矩阵为准 |

## P1 运行级证据投影

| 原条目                      | 实际实现及源码                                                                                                                                                      | 隔离验收                                                                                        | 真实网关/生产 | 判断与剩余缺口                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 Assembler              | sample-assembler.ts、outcome-reader.ts：不可变 task/version、scope/run/attempt 检查、四类资格、断链原因、显式 lookup 窗                                             | 重复冲突、乱序、重试、取消、版本冲突、phantom attempt、跨窗支持证据                             | 均未验        | 只读关联实现；fully_linked 是结构资格，improvementEligible 仍 false                                                                      |
| P1-2 执行挂点与有界耐久历史 | runtime-evidence、execution-evidence-store/projection、execution-journal/runtime 及 runner 挂点；独立事实先于显式版本 receipt，专用耐久旗标默认关闭，固定服务器目录 | journal 跨进程/重启/半写/TTL/容量/冲突与权限测试；异步 query 的输入冻结、tip 变更和最终认证反例 | 均未验        | 默认关闭的 bounded durable journal 已实现并接入异步查询；不等于完整历史或 Fabric 耐久化。模型内部 retries 与未覆盖入口仍须单列           |
| P1-3 最小查询               | query.ts、query-gateway.ts：diagnosis.observation.query，精确引用、认证重检，coverage/source/retention                                                              | ACL、跨 scope、权限撤回、精确版本、旧客户端兼容反例                                             | 均未验        | 查询后端成立；不能把 unknown 门禁当采集完成                                                                                              |
| P1-4 UI 增量                | diagnosis-panel、企业宿主、evidence-panel：四层、来源、资格、业务结果、lookup 与保留范围                                                                            | 企业真实 surface 与组件浏览器测试                                                               | 均未验        | 工作台原三 Tab、暂停/继续、诊断入口保留；组件通过不等于真实网关链路验收                                                                  |
| P1-5 成本归属               | e6b099490投影、3860879c1实际预算/最终结果挂点、358b476e5来源时间修正                                                                                                | 最终联合28文件235项包含collector8项；此前针对性31项不累加                                       | 均未验        | budget_command_association不计可靠usage分母；observedAt为回调观察时间，occurredAt可空；tokens/金额仍null，query/UI金额和耐久成本历史仍缺 |
| 来源证明补充                | outcome-source.ts、098d6ebe2：提交路径声明绑定 agent/scope/task/version 及元数据指纹，独立于执行源                                                                  | 指纹、版本、过期、声明混入反例                                                                  | 均未验        | 进程内声明不是耐久提交来源证明；重启/TTL 后不可补猜；不能作为真实改善合格集证明                                                          |

P1 历史范围：4903a15dc/13b394a78 已实现并接通默认关闭的有界耐久执行 journal；7538c1efb 固定异步输入并重检 tip/权限。持久 payload 有 TTL/容量截断，保留水位不表示全历史；内存源、耐久源保持身份和冲突引用，不恢复执行权。真实网关启用、长期连续性、磁盘故障演练与全入口覆盖仍未验。

## P2 改善承接

| 原条目                 | 实际实现及源码                                                                                                                                                                                              | 隔离验收                                                                                                                                                                         | 真实网关/生产 | 判断与剩余缺口                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 ActionIntent      | action-intent.ts、action-intent-store.ts：纯状态机、scope/revision journal、审批/diff/version、命令回执/回读、失败历史                                                                                      | 状态机、冻结工厂、跨进程存储 CAS、重启 replay、跨 agent 引用                                                                                                                     | 均未验        | 关联记录成立；恢复记录不自授执行资格或可信成功状态；普通生产转换继续受证据门阻断                                               |
| P2-2 一条原控制路径    | action-intent-control.ts 复用原 WorkingDNA plane；working-style-store.ts 双层锁及内容 CAS；bb9335ec1 将 intent 精确 expectedVersion 贯穿原 adapter CAS                                                      | 临时目录 finding/注入证据→用户审批→原 apply→独立回读→回滚；inspect 后同候选写入反例 fail-before/pass-after；真实子进程竞争                                                       | 均未验        | 隔离最小路径已接；未扩展所有 Models/Fabric/runtime 控制面，未发生生产动作                                                      |
| P2-3 状态展示          | action-intent-panel/model 与 workbench 治理区只读承接，持久查询精确 agent/task/version                                                                                                                      | 收据与回读缺失、伪 verified 历史、撤权清理的组件测试由总控汇总                                                                                                                   | 均未验        | 不包含自动 apply 或实验授权按钮；记录状态与可信验证需分开                                                                      |
| 中断恢复与显式关联修复 | action-intent-recovery.ts 只读检查；5d3b2f50c 的 association-recovery 服务在显式 restore_association 授权下追加真实 receipt/readback；df2cdb20b 隔离授权端口输入、保留 observedAt、锁内提交门与 replay 重检 | 新增可信隔离宿主装配：重启 durable store/原 plane、宿主授权台账、独立回读、拒绝未授权及撤回 replay；12 项恢复测试通过，断言零新 apply/rollback、executionAuthorityRestored=false | 均未验        | 修复服务及隔离装配已实现，不能再称执行器未实现；实际操作宿主的重新授权 UI/可信管理入口未接线，不新增生产写 RPC，不恢复执行资格 |

P2 限制：内容 CAS 不检测 ABA；style/change record/adapter application/ActionIntent journal 并非跨文件事务。恢复服务只修复关联，审批通过后仍在提交锁内重新检查；这不等于外部授权系统与文件提交形成原子事务。已发生动作不能自动重放。宿主装配测试仅使用临时目录、injected 证据和可信测试授权台账，不代表生产审批或真实业务样本。

## P3 对照与进化

| 原条目                  | 实际实现及源码                                                                                                                                                           | 隔离验收                                                                                        | 真实网关/生产                | 判断与剩余缺口                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 baseline/candidate | metric-compare/query/gateway；95e618042 从不可变 TaskOutcome contract/policy/entrypoint、可信 scope/agent 与 metric 派生服务端 cohort；0032dd27f 绑定字典/分母与样本证据 | 同版本 cohort 冲突、validator 规范化、异步指纹变化、缺样本整体拒绝、unknown/seed/不合格阻断测试 | 均未验                       | 权威契约 cohort 已接通；不能再称仅同 agent 标签。matched 只说明契约维度一致，来源或改善资格不足仍 blocked；没有因果、晋升或生产改善证据 |
| P3-2 原进化控制面       | 既有 evolution.perception/confirm 保留；本任务只读展示与隔离 WorkingDNA 路径                                                                                             | 隔离原控制面测试                                                                                | 均未验                       | 观测→真实进化预览/授权/晋升的完整新适配未实现；不得从现有路由仍在推断本次闭环完成                                                       |
| P3-3 可选强推理         | reasoning-pass.ts、e67dcc64a显式假设gateway及a2403f546显式UI；默认关闭、严格schema、整单回退rule_v1                                                                      | 注入模型端口及显式UI测试；本轮Chromium21项及tsgo/Lint/格式/build由总控验证                      | 无真实外部模型调用；生产未验 | 显式请求接线已实现；真实模型resolver未配置默认关闭，不自动调用模型、不写裁决或apply；角色质量和用量证据仍缺                             |

## P4 容量与连续证据

| 原条目         | 实际实现及源码                                                                                                                                | 隔离验收                                                                                   | 真实网关/生产 | 判断与剩余缺口                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-1 心跳/健康 | bbd1add76活动模块；2ffad48cd平台活动只读授权适配；26cc71248生命周期组合；05aa43053在server.impl默认关闭被动接线，用户已明确精确接管该宿主文件 | 总控联合31文件249项通过；tsgo和五文件Lint/格式通过                                         | 均未验        | server被动生命周期与既有observation RPC严格platformActivity读取模式均已接线；连续expected分母、normal、uptime保持unknown，不称P4全部完成    |
| P4-2 配额/并发 | capacity-reader.ts 认证后只读 agent-run registry、runtime entitlement snapshot、subscription，并校验有效期与 scope；无信用额度 fallback       | 缺/损坏/过期源、合法分母、登记运行 stale 反例                                              | 均未验        | 原始文件来源仍 unknown，真实权威余额未采集；实际并发余量不能从登记快照直接宣称正常                                                          |
| P4-3 耐久评估  | b577649c6读取前stat超限预检；c34076b24本地可复现容量探针及证据                                                                                | journal/Fabric各256条、容量64；TTL/restart/损坏unknown实测；最终observation31文件249项通过 | 均未验        | journal有界耐久保留已测，Fabric仍内存环；maxBytes+1有界句柄读取及根目录协作预算已实现；非OS硬配额，外部绕锁、解析内存和生产断电证据仍有限制 |

## 项目反例与证据结论

| 反例族                                  | 当前证据                                                                           | 尚不能宣称                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 重复/乱序/重试/取消/跨版本              | Assembler 与事件 store 单测                                                        | 生产所有入口覆盖                                       |
| 无 tip/无投递/enqueue_only/成本不可归属 | 业务与成本未知、投递状态保留契约                                                   | 业务闭环已验证或成本采集完成                           |
| seed/injected/live 与来源声明冲突       | 来源门、指纹声明、测试 cohort 标识                                                 | injected 测试等同真实业务                              |
| 旗标关闭/TTL/容量淘汰/重启              | 有限保留和未知水位门禁                                                             | 耐久完整历史                                           |
| 权限撤回/跨 scope/跨 agent              | 查询重检与精确三元组测试                                                           | 真实网关授权撤回演练已完成                             |
| 回执与生效版本不符/rollback 覆盖        | 隔离原控制面回读与 CAS 反例                                                        | 多文件事务、生产实例全覆盖                             |
| 中断关联恢复/伪 verified 历史           | 只读检查、显式再授权修复、锁内/replay 授权重检、冻结工厂；本轮可信隔离宿主装配通过 | 自动恢复执行权、生产宿主恢复入口或跨系统原子事务已完成 |
| 同口径对照/模型 schema 错误             | 比较 blocked、推理整单回退                                                         | 同 cohort 实际改善或根因确诊                           |

## 验收决定

可以确认：分阶段只读投影、错误口径门禁、有限独立执行证据、隔离控制面最小路径、纯比较与推理回退、容量未知门禁均已有代码和相应隔离验证。

不能确认：原方案 P0–P4 全部完成、真实网关业务闭环、生产改善、可靠逐次任务成本的全链采集、无截断的执行完整历史、生产宿主恢复入口、真实同 cohort 晋升验证、强推理在线接线、连续健康/权威心跳采集、权威额度余额或 Fabric 耐久方案。耐久 journal、显式关联恢复服务、权威契约 cohort 已有实现，剩余问题必须具体称为挂点、覆盖或真实证据缺口，不能混称完全未实现。

报告仅作独立验收记录，未新增生产授权。— codex-observe-contract

## 本轮可信隔离宿主装配

宿主装配测试已提交为 17828d3b1，仅在 observation 的恢复服务测试文件中增加装配用例，不导出生产恢复入口。实际复用 restarted durable store、原 Evolution plane/application、真实 WorkingDNA 文件回读，授权只来自宿主闭包台账；请求不能提供授权、scope、store 或 apply 端口。先拒绝缺恢复授权，再追加关联、重放幂等、撤回后拒绝 replay。断言配置不变、原 application 数量仍为一、零新增 apply/rollback、无 verification、恢复对象不属于可信执行工厂。

实际运行：action-intent-association-recovery.test.ts 12 项通过；该文件 type-aware Lint 0 warnings/errors，格式检查通过。此结果不扩大为真实网关或生产验收。— codex-observe-contract

## 本轮兼容性与回退边界

- e6b099490：新增 exact-version 成本证据投影契约；3860879c1 追加真实 post-call charge/final outcome 挂点与默认关闭的有界内存 collector。因原 API 无 winner 身份，所有 tokens/金额保持 null，只能证明 partial 结构关联。query/UI 金额和耐久成本历史尚未接通。回退时先停用/回退 collector 挂点，再按依赖移除投影，不删除其他任务文件。
- df2cdb20b：恢复服务授权输入隔离、真实 observedAt、锁内提交及 replay 授权门。store 新增的 precondition 是可选可信服务端端口，不是请求字段，旧调用保持兼容。回退会撤销这些安全修复，必须同时停用关联恢复入口，不能保留旧不安全恢复路径继续使用。
- 0032dd27f：比较绑定指标字典、分母和实际样本证据。回退后应关闭比较适配或维持 blocked，不把旧宽松比较当作可验证结果。
- 17828d3b1：仅隔离宿主装配测试，回退只移除该测试证据，不新增或撤销生产功能。
- 上述提交不新增生产写 RPC，不改变 TaskOutcome 权威 schema，无数据库或事件数据迁移。回退均由 owner 按依赖顺序评审，不在本报告中执行，不清理或覆盖其他任务文件。

本轮 Chromium 与 UI build 结果为总控报告，独立贡献者未重复执行；构建既有警告不等于无警告构建，也不等于部署验收。— codex-observe-contract

## 成本 collector 追加验收

3860879c1 已提交；总控报告成本加原 runner/outcome 26 项测试通过，项目 tsgo、相关 Lint/格式检查通过。本报告未重复运行这些命令。真实 post-call charge 与 final outcome 仅提供调用命令/版本结构关联；原 API 缺 winner 身份，collector 不猜 provider/model winner，不伪造 usage，不重定价，tokens 和金额均为 null，资格保持 partial。

collector 默认关闭、容量/TTL 有界且只保留进程内状态。成本 query/UI 金额读取与耐久写入仍未接通，不能据此称为完整成本观测。未启用生产旗标、未验证真实网关或生产金额、未执行生产配置变更或自动实验。— codex-observe-contract

## 最新提交与兼容回退边界

- 358b476e5：预算关联使用budget_command_association，observedAt与可空occurredAt分离，排除可靠usage调用分母；旧usage/billing记录兼容。回退前停用相关展示，不能恢复误标usage或精确发生时间断言。
- 32190ad14：提交锁内独立配置回读及授权重检，保留真实observedAt；配置与journal非共同事务，不能宣称消除跨系统竞态。回退安全门时停用恢复入口。
- e67dcc64a/a2403f546：显式假设gateway/UI已接，真实模型resolver未配置默认关闭；不新增生产写RPC、不自动apply、不改TaskOutcome权威schema、无数据迁移。回退可选入口保留rule_v1。
- bbd1add76：heartbeat活动模块9项通过，仍无server生命周期接线和连续分母。回退活动投影不能用其他活动冒充探测。
- 总控最终联合28文件235项PASS，包含collector8及heartbeat9；此前联合232与针对性31是不同运行，不累加。UI21项Chromium、tsgo、相关Lint/格式与build通过，pin sync skipped。独立贡献者本轮仅更新文档，未重复这些验证。无生产启用、外部模型运行、自动实验、推送或部署。— codex-observe-contract

## P4 默认关闭被动接线追加验收

2ffad48cd新增平台活动只读授权适配，26cc71248组合生命周期，05aa43053在用户明确精确接管的server.impl中接入默认关闭被动观察。a50cf8778与ed0fdcb23已将同一server collector接入既有observation RPC严格platformActivity模式，平台身份须tenant=null且具operator.platform，企业身份拒绝，并在读取后重检撤权。观察只记录被动活动，不发主动探测、不改变运行策略；缺连续expected分母时normal/uptime仍unknown。

总控最新联合31文件249项PASS；项目tsgo和五文件Lint/格式PASS。测试范围分别记录，不与旧235或其他针对性计数累加。未执行真实网关/生产验证，不能验收P4全部完成。

兼容与回退：新增可选默认关闭宿主组合及只读适配，不新增生产写RPC或TaskOutcome schema迁移。回退先停用/移除server宿主接线，再按依赖撤销生命周期组合和平台读取适配，原活动/容量unknown门禁保留。共享registry含其他任务混合WIP，尚未提交；本次文档更新不清理、不覆盖或提交该登记。— codex-observe-contract

## P4 平台活动读取入口验收

a50cf8778与ed0fdcb23复用同一server collector，接通既有observation RPC的严格platformActivity只读模式。真实认证判定端口与event bus在隔离环境验收：平台身份tenant=null并要求operator.platform，企业身份拒绝，异步读取后撤权重新检查。平台读取已接线，不再列为未实现。

总控最终31文件249项PASS，项目tsgo及五文件Lint/格式PASS；独立贡献者本轮仅更新文档，未重复代码测试。默认关闭、被动活动非liveness，无合法连续expected分母，normal/uptime保持unknown，无真实网关或生产验证，不能称P4全部完成。回退先移除platformActivity读取分支和server组合，再按依赖移除适配；保留默认关闭与未知门禁。共享registry仍含其他任务混合WIP未提交，本轮不改动。— codex-observe-contract

## 本地保留容量追加验收

b577649c6已增加stat读取前超限预检，旧“先读完整文件再检查”缺口不再作为当前实现结论；433ddf16e进一步实现maxBytes+1有界文件句柄读取，文件增长不再导致无界完整读取；JSON解析对象内存仍非同等字节硬上限。c34076b24提供可复现本地注入探针：journal写入256条、容量64，保留64、discardedThrough=192，文件69177字节；重建实例仍保留64。到TTL边界后保留0、水位256，查询不写盘；半写临时文件忽略，损坏已提交JSON返回unknown。1024字节预算拒绝追加为journal_write_unknown，不冒称成功。

Fabric同样写入256、容量64时保留64，新实例为0，仍为内存环，无TTL或完整丢失水位，不能称耐久审计。telemetry为JSON快照而非耐久事件日志。journal每分区默认16MiB、1000 payload、15分钟TTL；identity tombstones达到有界门槛后拒绝新身份，TTL为逻辑过滤，后续append才重写。e326397b8已实现根目录协作逻辑预算，默认1000分区/256MiB，root→partition锁顺序，计入旧文件与临时替换空间；超限拒绝追加、不删除数据。它不是OS硬配额，外部绕过协作锁的写入仍可突破逻辑边界。

总控最终observation31文件249项PASS，项目tsgo及journal两文件/探针Lint格式PASS；本轮文档贡献者仅读取现有探针证据并更新文档，未重新执行代码测试。未做生产吞吐、进程崩溃rename或断电fsync验证，不宣称全计划或生产完成。回退探针仅移除本地证据；回退stat门禁须停用不受控journal读取，不能重新声称超限保护。共享registry混合WIP仍未提交。— codex-observe-contract

## 有界读取与根目录预算验收

433ddf16e实现maxBytes+1有界句柄读取，e326397b8实现根目录协作逻辑预算：默认1000分区/256MiB，按root→partition锁序列化，统计旧文件与临时替换空间，超限拒绝而不删除数据。不得继续将全局根预算列为未实现；预算仅约束遵守协议的journal写入，不是OS硬配额。外部绕锁写入、JSON解析对象内存、断电持久性和文件系统级空间开销仍不能据此获得硬保证。Fabric仍是独立内存环。

总控最终31文件249项PASS，journal针对性14项PASS，项目tsgo及相关Lint/格式PASS，测试范围不累加；独立贡献者本轮仅更新三份文档，未重新运行代码测试。回退时先关闭journal读写再撤销预算/有界读取门禁，保留已有数据，不自动清理其他任务或生产文件。无生产验证或全计划完成断言。— codex-observe-contract
