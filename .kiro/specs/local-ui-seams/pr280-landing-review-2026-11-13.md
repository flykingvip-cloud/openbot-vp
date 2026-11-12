# PR #280 合入复核

Task: local-ui-seams-peer-display-20261112；Agent: codex-runtime-manager。日期：2026-11-13，Europe/Berlin。

## A. 建议

READY FOR /landpr，适用用户本轮明确确认的标准：“仅修本 PR 回归；与 main 对照确认既有失败后合入，不绕过服务端规则”。不是全仓全绿结论，不包含部署授权。

行为版本仍为 `51ea171da062e999de8871ace3ae769d6b2244d6`。此前推送证据头 `0504a72282c6a0f19ac19d63c212e15520d3e585`；本轮测试契约修复为 `3d1f4c928` 和 `f2e4bea05`，没有新增运行时业务行为。对照主干 `8a686145c33f8c7e1d776a5aca2502d9091f11b0`。合入前须再次fetch并绑定最终PR头，服务器若拒绝则停止，不使用admin或关闭检查。

## B. 修复主张与证据

| 主张                   | 原现象／根因                                                                                        | 修复与验证                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 临时动作不自动建板     | S276N送达并回信仍产生unfinished任务；`state/mutations/admit-task.ts:42`原实现所有执行准入都插入任务 | turn默认当前回合，long_task才持久；授权、控制快照与同一执行生命周期不变；S276Q真实送达且双方板哈希不变                                              |
| 群内短动作不进正式任务 | 旧`discuss-to-task-classify`把“一段当场答复”判成正式委派                                            | `discuss-to-task-chat-hook.ts:55`只接语义long_task；无决定不回退关键词；真实G276A直接答30，隔离WS覆盖短动作及正式入口                               |
| 不继承旧任务步骤和Wake | G276B写入被无关旧step指纹拒绝，提及Wake还携带旧taskId                                               | `runtime-context-assembly.ts:211`按可信生命周期与taskId装配；round/host/工具边界一致限制范围；原步骤幂等保护回归保持通过                            |
| 成员身份贯通沙箱       | G276C实际文件落入同主人main工作区                                                                   | `sandbox/runtime-status.ts:59`及account-worker/context透传服务端执行成员；先红main租约、后绿bot-member；G276D独立读取bot-2文件8字节，main无同名文件 |
| 协议失败与历史作用域   | DeepSeek空白／供应商错误被当协议失败；新问补答旧失败请求                                            | 单次受治理推理、私有原生决定序列化、历史引用边界、失败终局与安全投影；真实查询及相关回归见既有验收报告                                              |

详细先红／后绿、真实模型、执行与存储证据见 `collaboration-lifecycle-acceptance-2026-11-13.md` 及 `peer-communication-display-review-2026-11-12.md`，不把文档说明当运行证据。

## C. 本轮合入前补齐

- 全仓lint首跑14处错误仅涉及两个旧测试文件：移除已被类型收窄证明多余的断言、显式忽略node:test注册Promise。没有改测试断言、禁用规则或运行时。
- UI旧测试要求用户看到`reading 'length'`，与本PR的错误净化冲突；改为同时验证安全提示、无原始异常、已有回复保留。
- 三个持久任务夹具（跨进程、复杂任务、暂停恢复）补显式long_task，保留全部原并发、约束、完成和恢复断言；没有恢复自动建任务旧逻辑。
- 按landpr补Unreleased末尾用户可见更新及PR关联。

## D. 保持的边界

个人看板、群工作项、成员私有计划没有合并。模型、工具、租约、预算、回退、取消、计费和清理复用原主链；不新建执行器或调度器。DeepSeek输出函数没有动作handler。模型提议不授予权限，tenant/user身份和组写ACL仍由服务器核准。正式审查、实际投递、运行结束不共用成功标志。

## E. 阻塞与风险判断

本PR已识别回归均已修复并定向复验；本轮无尚未关闭的新增BLOCKER。完整长程协作真实终局、外部渠道、既有32项架构导入债及其他原有平台问题不借本次合入声明关闭。机器分类仍可能失准；理解失败不会回退旧规则自动建板。

主干既有失败按用户授权单列，不修改其生产实现、不删除断言、不把它们标PASS。GitHub作业因付款／额度未启动，不能当作源码通过或源码失败证据。

## F. 检查记录

| 检查                     | 结果                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 行为候选定向联合         | 17文件／197项PASS，51ea171da；同版本构建及真实G276D成员工作区核准通过                                        |
| 合入补齐：UI／沙箱       | 2文件／131项PASS，`/tmp/openbot-land-targeted-gate-fixes.log`                                                |
| 合入补齐：看板跨进程     | 1文件／7项PASS，`/tmp/openbot-land-cross-process-fixed.log`                                                  |
| 合入补齐：复杂任务／恢复 | 2文件／39项PASS，`/tmp/openbot-land-long-task-fixtures.log`                                                  |
| node:test                | 6项PASS，`/tmp/openbot-land-node-tests.log`                                                                  |
| 全仓lint                 | 13255文件，0警告／0错误；`/tmp/openbot-land-main-lint-fixed.log`                                             |
| diff格式                 | `git diff --check` PASS；修改文件oxfmt与类型感知oxlint通过                                                   |
| 完整测试尝试             | 发现失败后按已确认的等价验收标准有序停止，保留日志；未宣称全量完成或通过。`/tmp/openbot-land-full-tests.log` |

主干归档第一组8文件：7失败／1通过，13个失败用例在main同样存在；第二组只读3用例在main同样失败，共16个范围外失败。记录：`/tmp/openbot-land-main-baseline-tests.log`、`/tmp/openbot-land-main-baseline-safe-extra.log`。

- 发布账本：main实际seq165，旧断言期待151；本PR不改账本或发布脚本。
- 诊断路径：macOS无Linux `/workspace`；协议锁测试缺Linux `findmnt`。
- PDF中文提取／字体环境，旧TaskOutcome源文件清单、模型桩和未准入调用契约：main归档同样失败。
- 完整运行中的reconcile-sync单例失败后独立复跑8项PASS：`/tmp/openbot-land-reconcile-retest.log`。

一次错误的对照命令把真实Git环境传给了会初始化Git夹具的测试，污染了三个本地配置键；该命令的Git夹具失败不作为main对照证据。已恢复worktree/作者配置并核准HEAD未变、暂存区为空、仅预期WIP存在；远端和生产未变。后续安全对照不传Git环境并排除该夹具。

GitHub检查注释原文：作业因近期付款失败或spending limit未启动。未关闭规则，未使用admin旁路。

合入候选完整构建：`f2e4bea05` 干净源码归档PASS，`/tmp/openbot-pr280-landing-build.log`；此后仅发布说明和本复核记录，没有运行时代码变化。

## G. 后续

主干已有测试及平台环境债继续由相应任务处理；完整真实长程协作终局另验。主干合入不是生产部署。下一次构建／上线必须从新鲜origin/main重新取SHA并执行发布门禁。

## H. PR落地记录

最终PR头与squash合入SHA以GitHub状态及落地评论为准，必须为MERGED；不使用CLOSED代替合入。本地共享`.loom/registry.yaml`改动不夹带，保留工作树现场。

— codex-runtime-manager
