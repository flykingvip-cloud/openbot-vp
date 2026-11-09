# 原任务编排与验收设计意图保全审计

只读审计；未实现、未删除。Contributor runtime-mainline-audit。依据当前源码注释、测试及可见Git历史；配置/生产实际启用未核实，不把名称loop等同第二执行器。

## 证据强度

- complex-task-loop.ts历史仅见 `dd6c85cae recovery tree snapshot...`，无法由此可靠还原最初动机；其意图主要由文件注释与测试证明。
- executor-private-todolist历史有 #136身份投影/推进失败/终交回执、#133 active confirmer、#27 unattended advance修复，说明确认/身份/推进门禁是既有兼容面，不是可随意裁掉的重复包装。尚未逐提交复现生产问题。

## complex-task-loop 的真实作用

`src/task-orchestration/complex-task-loop.ts:applyComplexTaskLoop` 是受observe gate准入的**回复后处理与有限协作标记生成**，不是工具派发循环：directSend明确不调用。它按当前关系生成理解/计划/执行/验收说明；群分支最多两个depth-1 collab_edge，私聊没有sessions_spawn时明确不能委派，列出工具也不假称已spawn。验收对齐失败会替换看似完整草稿；成功可调用现有recordCheckedTaskCompletion。shapeAdmittedComplexTaskReply未准入/异常保持原payload。

测试明确锁住：flags off透传；tenant allowlist+kind准入；最大两条depth-1 edge；不直接私发；无spawn说不可委派；有spawn不假称已派；不匹配草稿不关闭任务；匹配才记完成；leaf spawn限制与不写evolution proposal。

不能直接删的意图：

- 防假派工、防越过已有协作路由私发。
- 协作深度/扇出边界，防递归扩张。
- 目标/验收对齐失败不能以完成稿出场。
- checked completion与用户可见回执，不凭模型一句话关闭。
- 启用门禁和失败退化行为；shadow/observe不能暗启live。

局限也须保留证据：当前以长度、验收句及assessTaskOutputAlignment作启发式验收，不是通用内容质量证明；此逻辑即使需替换，也要先承接原门禁/回执与失败保护，不整体删掉。

## 原计划与治理对象不得压成一张Todo

| 对象                    | 已证设计意图                                                                                                                                                                                            | 新主链保留位置                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| SessionTaskBoard        | amend/aside保持current；new_work park旧任务；恢复取停点与路径而非旧transcript；cap归档明确告知；task/version/attempt绑定迟到完成；停止/墓碑/恢复重检                                                    | command维护会话目标/控制，state原子保存；execution恢复前重查；delivery按身份提交完成                                      |
| 群ClaimContract         | shared Goal/Acceptance/Constraints/Due及责任；口头已派工/collab_edge不是板事实；submission_id+artifactVersion；accept/return绑定当前提交；accepted终态；blocked须明确unblock；peer review门（配置决定） | command编排/授权领取；execution按确认计划；delivery提交审核并保留review治理；公共机制强制actor/版本                       |
| ExecutorPrivateTodolist | owner私有step计划；主答confirm/revise；未经确认不能markInProgress；bag=shared contract+context pointer+owner current step；ACL防串读；insight沿原WakeContract唤醒                                       | command中协作计划适配，不强加私聊确认；context投影已授权task bag；execution原plan gate不可丢；state群日志不直接并会话文件 |
| 模型内部计划            | 提议行动和修正，不是已派工、已确认、已提交或已验收事实                                                                                                                                                  | 模型经原core校验后请求变更，不能自授责任/确认/完成                                                                        |

会话原测试见session-task-board.test.ts：same-goal no cut、真实switch park、resume auth/stop、C1 focus revision、C4 late A不能完成B等。这些是重构不变式而非可删冗余。

## 映射与安全退场门槛

| 当前实现                      | 应保留/补全归属                     | 旧逻辑退出前必须证明                                |
| ----------------------------- | ----------------------------------- | --------------------------------------------------- |
| complex relation/title/report | command relation + delivery可见说明 | 同输入结果/门禁等价，不能报告已执行不存在的动作     |
| collab_edge生成               | 原协作分发适配与公共fanout规则      | 成员/深度/扇出/leaf限制和无directSend仍生效         |
| 对齐与替换坏草稿              | delivery acceptance                 | 失败草稿不会交付成品；验收使用当前目标/版本         |
| recordCheckedTaskCompletion   | state completion port               | 当前任务/attempt绑定，迟到不关错；与投递回执区分    |
| propose/confirm/revise        | command协作计划用例                 | 确认actor ACL、旧计划superseded、版本和读取范围保持 |
| submit/review/return/block    | delivery协作验收+state              | 三件套/版本/非作者review/显式unblock/人类升级保持   |

不建议直接迁“理解→计划→执行→验收”四句为新控制器；它们目前是结果报告，不能因文字完整就新建执行循环。真实流程贯通需以已存在任务/操作回执与状态迁移承接。

## 必须继续核实

实际observe/claimContract/peerReview/自推进开关、allowlist和生产消费者；shape调用是否涵盖所有渠道；当前group传入members与fromAgentId是否足够；checked completion现有调用方身份绑定；承接后能否去除启发式长度验收而无回归。未知不等于无用，更不是删除授权。

## 推荐下一步

先建一个“治理行为→唯一负责组件→真实消费者→回归证据”清单。优先将验收和协作标记从complex后处理定位到明确delivery/协作适配，但原门禁/副作用顺序先保持。只有新消费者已承接全部上述能力、原实现无业务消费者且具可回退证据，才可退役旧入口；不能仅按目录重复或loop命名清理。
