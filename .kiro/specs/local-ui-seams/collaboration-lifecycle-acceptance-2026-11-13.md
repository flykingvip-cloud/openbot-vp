# 协作入口生命周期分类整改与验收

Task: local-ui-seams-peer-display-20261112；Agent: codex-runtime-manager。记录日期采用客户端时区 Europe/Berlin：2026-11-13；原始 Gateway 日志保留宿主时区，不混用时间解释版本。

最终受测源码：`51ea171da062e999de8871ace3ae769d6b2244d6`；此前生命周期候选 `e6937e345529061f130fb49e95d9524837a3a8d7` 的证据另列，不倒算。开工 HEAD `e24673a396771170d0e4c82771b5c074157e2dd9`；主干同步提交 `c04bb0279a76be043c8be035c7725d14708400cd`。最新核准 `origin/main=8a686145c33f8c7e1d776a5aca2502d9091f11b0` 为候选祖先。只加载本地Gateway；未推送、未云部署、未向真实外部渠道发送。

## 1. 目标与原断点

普通交互直接回答，小任务当前回合执行；只有语义理解与编排已识别为需要持续承担目标的长程任务才建立看板。多人、调用工具、交付文件、出现“团队／交付”等词，都不是单独建板依据。

原协作入口在成员执行前按动词／团队词／交付条款分类，不能区分一次性动作与长程责任。反例“请团队整理这三行数字，交付一段当场答复，只做本轮、不持续跟踪”仍进入正式建任务门禁。个体 `turn / long_task` 修复不会自动覆盖此入口，因为成员回合正确地跳过个人准入。

## 2. 现役主链收敛

```text
可信群消息／组访问核准
  → 共享模型治理的一次交互理解（身份、组参考视图、历史、bootstrap、Skill指导）
    ├─ reply / clarify → 持久化并返回，不启动成员执行或正式任务
    ├─ execution_request / turn → 原参与者与成员执行后端，本轮返回
    └─ execution_request / long_task → 原群写授权、来源绑定、正式任务激活
                                      → 原工作项／认领／计划／Wake／审查
```

执行后端、模型租约、预算、回退、计费、取消与清理保持共用。群任务、成员私有计划、个人看板没有合并；没有新调度器、第二模型执行环或自动确认模式。模型提议不授予工具、写入或发布权限。

- `command/prepared-interaction.ts` 抽出同一次受治理推理适配；个人路由及组理解复用。
- `command/authorized-interaction.ts`、`governed-interaction.ts` 共享租约与模型策略顺序；组理解不调用个人任务写入。组身份和Owner模型权益继续显式传递，不替换为发言成员权益。
- `wiring/interaction-turn.ts` 仅固定绑定；组宿主 `gateway/collaboration-learning/group-interaction-understanding.ts` 读取有权组上下文，调用公开command能力的接线入口。
- `server-methods/chat.ts` 消费一次决定；直接回答不再进入成员工具执行。成员不重复理解原始人类请求。
- `discuss-to-task-chat-hook.ts` 仅为语义 `long_task` 进入原正式入口；缺决定时不回退旧关键词建板。旧显式结构化API仍保留字段提取与权限核验，未称全部旧分类函数退役。
- 原来源缓存增加本轮生命周期，首次可信登记的turn不能被模型工具升级为long_task。`collaboration_board` 对此来源拒绝正式写动作；原群ACL和停止门禁仍在。

## 3. 实测驱动补齐的两个接缝

第一候选 `b99849d0c` 的真实G276A已直接回答30；G276B虽未建板，却被工具防重复保护拦住：上下文装配器按当前认领人选取了旧任务的已确认步骤，给新文件写入注入旧写入指纹。旧计划不能成为新动作的责任来源。

修复 `d4eca3552`、`b6d79b7ec`：可信本轮生命周期经MsgContext传到上下文装配，turn不查询／注入旧交付步骤，且清掉旧DeliveryToolSideEffect；新long_task必须按本次实际接纳的组taskId匹配步骤。无关旧任务不能通过“最新认领”兜底。已有内部恢复回合未携带新的人类生命周期时保留原路径；没有关闭原防重复保护。

另发现提及成员的Wake登记发生在语义决定前，G276B的Wake错误携带旧taskId。`e6937e345`将任务Wake登记移到理解与接纳之后，turn不登记任务Wake；long_task只用本次taskId。成员回合结束后的库存续醒、自动正式提交和旧目标关联也受同一范围约束。

## 4. 证据矩阵

| 核验                 | 源码／证据                                       | 结果及边界                                                                                      |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 原分类断点先红       | `/tmp/openbot-collab-lifecycle-red.log`          | turn决定被忽略，返回正式任务开关阻塞而非null；1失败／1通过                                      |
| 旧已确认步骤继承先红 | `/tmp/openbot-collab-old-binding-red.log`        | 新turn上下文包含旧“执行三件套”；1失败／1通过                                                    |
| 最终同源码联合回归   | `/tmp/openbot-collab-e693-same-sha-tests.log`    | e6937e345，14文件／183项通过；真实状态／模型替身，不是全库通过                                  |
| 隔离WS初轮           | `/tmp/openbot-collab-lifecycle-ws.log`           | b99849d0c，8项通过                                                                              |
| WS扩展轮             | `/tmp/openbot-collab-lifecycle-ws-final.log`     | 增失败注入后8通过／跨身份用例超时；单独复跑通过，日志`ws-dual-retest.log`同前缀；不抹去超时记录 |
| 任务身份与旧步骤隔离 | `/tmp/openbot-collab-identity-final.log`         | 新long_task不拿旧步骤，明确绑定原任务仍取原计划；2文件／46项通过，与联合回归有重叠              |
| 构建                 | `/tmp/openbot-collab-final-candidate-build.log`  | e6937e345完整构建通过，8192MiB堆；动态导入／chunk警告仍存在，未以关闭告警通过门禁               |
| 类型与lint           | `collab-scope-final-tsgo.log`及定向oxlint        | 修改文件类型感知lint通过；全仓tsgo仍有扩展依赖及exec-protocol既有错误，不称全仓通过             |
| 架构                 | `/tmp/openbot-collab-lifecycle-architecture.log` | 32条违规导入均已在本轮基线存在；没有新增违规导入，不称架构全绿                                  |

主要命令：`OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test <14个定向文件>`；隔离WS使用`pnpm exec vitest run --configLoader runner --config vitest.gateway.config.ts`；构建`GIT_COMMIT=<源码SHA> NODE_OPTIONS=--max-old-space-size=8192 pnpm build`。

最终e6937e345的隔离WS四条消费者路径（普通答复、一次性动作、正式建任务、理解失败不回退）均通过，日志`/tmp/openbot-collab-e693-ws-tests.log`；该命令另外5项明确跳过，不写成9项全绿。

真实G276C在e6937e345上已完成文件写入和读取校验；组`tasks.json`与任务Wake日志字节哈希未变，没有新增工作项／私有计划／任务Wake。执行链日志记录了真实exec成功。但独立读取沙箱挂载后确认：8字节`G276C_OK`落在同一主人`main`工作区，而不是实际发言成员`bot-2`，因此此候选不能宣称工作区隔离通过。证据：`/tmp/openbot-collab-e693-real-artifact.json`、`/tmp/openbot-collab-e693-group-changes.json`、`/tmp/openbot-collab-G276C-pass.png`。

## 4.1 真实执行成员与共享会话键的身份接缝

`account-worker-embedded`及`sandbox/context`原本从共享群会话键`agent:main:space:…`重算机器人身份，忽略了服务器已经指定的执行成员。限定修复`51ea171da062e999de8871ace3ae769d6b2244d6`将可信agentId透传到沙箱策略、账户执行租约和挂载选择；未添加模型／工具参数入口，不改tenant/user授权，浏览器仍按原账户共享规则。

先红：执行成员bot-member、共享会话键main时，实际租约agentId返回main；1失败／7通过。修复后3文件／14项通过，覆盖同一反例的租约与工作区均为bot-member。日志：`/tmp/openbot-collab-member-workspace-red.log`、`/tmp/openbot-collab-member-final-retest.log`。扩展补测中出现一次临时ENOSPC写缓存错误，以及未修改Dockerfile的既有桌面镜像字符串断言失败；后者不在本轮修复范围，不改断言规避。未把扩展补测记成全绿。

## 4.2 最终同版本验收

- `51ea171da` 上17文件／197项定向测试全部通过：`/tmp/openbot-collab-51ea-same-sha-tests.log`。源码与测试覆盖分类、共享模型治理、临时动作不写正式状态、任务身份范围、原步骤幂等保护、成员沙箱身份及原正式任务链；不等同于全库或完整真实组终局通过。
- 同版本完整构建通过：`/tmp/openbot-collab-member-build.log`，实际`dist/build-info.json`为51ea171da。本地LaunchAgent已切到该构建，未切云端。
- 真实DeepSeek G276D：通过员工端向数字人战队提交一次性文件动作，市场助手实际创建并读取文件后回报。宿主独立读取对应账户的bot-2工作区，文件严格为`G276D_OK`、8字节、无换行；main工作区无同名文件。SHA256：`79c65fdddac41876d8dcc337add790d7dd0104aba0a9c6558dfa32e836f8c85d`。
- 对照运行前组文件快照，`tasks.json`及任务Wake日志哈希未变，没有新增正式工作项、私有计划或任务Wake。变化仅为会话、参与记录、普通回合记录、行为缓冲及operating-state等常规运行投影，不能把“无看板任务”理解为没有执行／审计记录。
- 最终证据：`/tmp/openbot-collab-51ea-real-result.json`、`/tmp/openbot-collab-G276D-member-pass.png`。此前G276B旧步骤拦截、G276C错误main工作区记录均保留，不删除或改写来制造通过。

## 5. 保留边界

没有修改组计划确认模式、交接开关、审查身份或业务验收条件；没有把成员run成功当组验收成功，也没有将投递失败写成执行失败。旧有任务资产及未完成计划没有清空。

组任务修订／控制继续需要组权威入口的有效绑定，不能通过个人taskTarget或新建长任务绕过。完整协作真实认领→计划→成员→审查→组终稿投递仍需独立终验，不能用本轮分类与一次性动作验证顶替。

— codex-runtime-manager
