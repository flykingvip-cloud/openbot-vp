# Runtime 全量完成门槛与可退役候选

只读基线 `10ae0b5af7bea5735abcade4bcd6a58ab5d4eddb`。Contributor runtime-mainline-audit。当前已完成部分context/command/execution preparation+recovery/delivery candidate+turn settlement/policy提取，不能据目录或wrapper宣布三层贯通完成。

## 必须剩余（非锦上添花）

1. **主链唯一性总表**：原Gateway→auto-reply→fallback→attempt→payload真实链仍在，new runtime为局部承接。逐项固定“消息关联/计划变更/运行/恢复/验收/投递”唯一实现及旧入口状态。语义分类、权限、原子变更、外部副作用仍分别负责；不能让barrel/facade变新总控。
2. **state归属与存储闭环**：运行时仍由conversation-task/session-task-board拥有实际文件锁、读取、epoch、墓碑、constraints。需要确定是否保留为合法state adapter或迁state仓库；两者择一并写契约，不为目录齐全新增空state。验证所有生产RMW、旧数据读取/恢复、并发complete/cancel/focus、不同tenant/session隔离。群shared contract/private todolist保持不同scope，不能粗合表。
3. **通用任务验收真实缺口**：已迁settlement是适用回合契约，含文字/路径检测与降级文件，不是统一用户目标验收。`recordCheckedTaskCompletion`仍在`session-task-board.ts:999`，实际消费者`reply-completion.ts:283/286`与`task-orchestration/complex-task-loop.ts:241`。须列每个调用方的适用门禁、证据、task/attempt/artifact version绑定，不能根据文件路径/模型“完成”关闭不相干任务。验收通过与渠道投递成功要分别记录，投递失败不重做业务。
4. **等待恢复真实合同**：stall、跨回合continue、协作wake、Cron/Heartbeat、外部job不可混预算；选一真实长作业补“task/job身份→等待→修订→过期回调→合法恢复→主动交付”证据，重启能力不明则如实限定，不先造job engine。
5. **扩展控制权退役证据**：hook/transform/Lobster/OpenProse/CLI agent源码面已盘，实际启用/消费者/外部持久状态仍未知。完成范围应明确源码收敛或生产收敛，不能既未核实又说隐藏执行器已杜绝。按清单迁受审查ID或退役，原能力不能静默丢失。
6. **运行器混合职责剩余**：preparation base params不是整准备，recovery loop不是整执行；模型admission/auth/fallback、session lock/manager、sandbox/tools、计费/audit/finalizers还在原实现。需要完整ports/所有权矩阵和明确允许的legacy适配，禁止整个attempt搬新runner作完成标志。
7. **最终等价/缺口分证据**：当前纯迁移与审批卡独立修复分别记录。最终candidate与基线诊断差量、构建warning增量、真实Gateway+UI+模型和取消/恢复/历史场景需对最终SHA验证，不用helper绿代替主链。已有基线红不能被说成全部绿。

## 主链与状态P0

- 一个业务动作只有一个授权/副作用路径；多个接入适配不等于多执行器。
- 模型提出计划与行动，已接受变更经state落盘；历史仅数据，不能覆盖当前授权。
- SessionManager主转录与task state不同权威；不能raw append破坏parentId。
- tombstone不可被旧回调撤销；task identity/attempt/version不靠同session推导。
- “约束记录成功”不是逐tool强制屏障；此既有局限需以真实工具前检查证明或另修，不能靠文案宣称完成。

## 可本轮安全执行的退役候选（源码消费证据）

rg范围：全仓代码/脚本（排除md/lock），生产另排test。这里只提出可回退源码退役，不保证仓外消费者。

| 旧路径                                          | rg结果                                                          | 安全动作/门槛                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/auto-reply/reply/untrusted-context.ts`     | 无仓内生产或测试import命中；get-reply直接新context              | 最低风险删除候选。先核package exports无显式导出、构建引用检查；函数实现已新位置单源 |
| `src/auto-reply/reply/agent-runner-payloads.ts` | 仅`agent-runner-payloads.test.ts:2`引用；主runner已新delivery   | 将原行为测试import改delivery公开入口后删除旧兼容文件；独立可revert；不是删除测试    |
| `src/agents/execution-stall-continue-loop.ts`   | 仅loop.test.ts:2和attempt.test.ts:6引用；产品attempt新execution | 测试导新execution公开入口、确认无mock路径依赖后删除旧兼容；保留协议/attempt回归     |

不建议本轮删除：inbound-text（仍有session/inbound-context消费者）、agent-runner-utils（仍有多种真正逻辑/消费者）、turn-completion contract（仍有FS/clock适配与执行predicate消费者）、mid-task-dialogue（ack逻辑/strip消费者仍存在）、task board（真实state）。不得将“兼容文件”标签作为删除依据。

## 推荐完成判定

对每个目标区列 DONE / LEGACY-ADAPTER / GAP / RETIRE-CANDIDATE，并提供实际消费者。允许本轮声明“规范组件迁移第一阶段完成”，不能声明“三层执行主线、能力治理和通用任务验收全部完成”，除非上述必需项有明确完成或经用户接受的边界。
