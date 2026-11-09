# Turn completion 验收边界只读审计

Contributor runtime-mainline-audit。对象 `src/agents/turn-completion/contract.ts`；本文件是迁移建议，不批准改变验收语义、不将现有交付契约升级为通用任务完成状态。

## 现状事实

该文件是混合用例，不能整文件搬进delivery/acceptance然后宣称纯验收。

| 领域               | 代码位置           | 性质                                                                               |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| 合同/输入/结果类型 | :26–110            | delivered/permanent_block/true_fork、BlockerGrade、输入含函数与env；不仅纯DTO      |
| SLA参数与clock     | :135–187           | module Map、读env、set/delete；进程级生命周期状态                                  |
| 语义判定           | :224–350、:490–538 | side-path、fork、terminology、progress、blocker；部分依赖skill glossary且影响stall |
| 路径/权限探测      | :381–436           | stat/open(O_WRONLY                                                                 | O_APPEND)/close；真实FS权限探测，不是纯字符串判断 |
| 默认环境探测       | :540–565           | process.versions/cwd、playwright目录stat                                           |
| 工具结果注释       | :460               | 可能调用上述探测；不能仅因返回string迁context                                      |
| 成果写入           | :576–601           | mkdir/write/stat；结果/降级文件创建                                                |
| 结果组装           | :618–677           | deliveredResult会clearSkillSmokeClock；permanent文字含人类等待门禁语义             |
| 适用条件           | :679–730           | 看似predicate但默认调用env探测和env SLA；不纯                                      |
| settlement         | :736+              | OGUI registry、trial gate、sidePathAttempt回调、FS写入、SLA和回执、clock清理       |

## settlement顺序必须保留

1. OGUI WAIT flag/registry优先，直接保持原文；不得先写成果或清clock。
2. 检查适用范围与trial；普通回复透传。
3. 执行sidePathAttempt并捕获receipt，再形成empty-success/side-refusal证据。
4. 获取probes/SLA/now，计算fork/cleared/lsOnly。
5. 显式deliverable写入成功先交付。
6. trial gate结果可能产出成果或permanent block。
7. 既有路径、true fork，然后主线降级/强制降级等后续逻辑。

仅提取“纯decision”而提前算好所有IO可能改变短路、探测次数、写入和clock时序，不接受为了纯度重排。输入.sidePathAttempt是既有源码调用依赖，不应扩大成外部配置脚本接口。

## 推荐完整组件候选

**范围受控的turn-final settlement用例**可归delivery/acceptance，但必须先固定原环境端口和状态端口，而不是把混合文件裸搬。

- 业务入口保留settleTurnCompletion(input)兼容，具体调用仍rewrite-visible-reply原位置。
- 定义固定源码ports：isOguiWait(session)、resolveEnvProbes、resolveSla/now、writeDeliverable、applyTrial、clearSmokeClock；保持调用惰性与原顺序。
- 纯合同/格式投影可供delivery，但clock仍原生命周期拥有；不能新增第二Map或新文件状态。
- 语义判断被execution-stall-continue消费，因此不能将全部predicate拖入delivery运行IO闭包。应明确纯policy边界与legacy facade，先审真实消费者。
- 输出continueExecution字段不等于自动再跑；delivery不调用queue或runner，恢复由原执行链决定。
- 不把路径存在直接提升为全内容验收；此是现有局限，重构保持、功能修复另立失败证据。

为避免本阶段一次大量ports抽象，允许先迁**完整只读阻塞定性组件**（gradeBlocker及其必要纯predicates/类型，明确env probe由caller提供），但不能把它宣称完整settlement迁完。不要拆field/format等微helper作为主要成果。

## 阻塞与验收门槛

- 先列所有export消费者，特别execution-stall对silent fishing/glossary及reply-visible的settlement；避免循环和新增FS加载。
- baseline/candidate验证OGUI WAIT时无write/trial/clock清除；side-path失败不阻断正文；显式文件先于trial；fork不写降级；SLA到期及部分成果路径；取消不会被settlement伪交付。
- 端口顺序与错误传播契约须测试，不能只有输出快照。
- clock的start/read/clear与sessionKey绑定不变；env默认/Date.now调用时机不变；写出路径、正文结尾LF、回执格式逐字等价。
- 重构不借机改变权限探测或引入新的停/恢复状态枚举。

## 既有测试噪音

已知e2e八项失败与mock缺isModelEntitlementEmptyError同源，owner在HEAD复现；这是测试mock基线问题，不据此认定产品bug，也不把未实际成功的e2e报绿。修mock应单独记录原因与测试边界。

## 结论

整搬contract.ts阻塞：它拥有FS写入、默认探测、clock、OGUI和trial side effects，且被执行层predicate消费。下一完整验收用例先固定副作用端口与调用矩阵；若范围超出可控检查点，选完整阻塞定性子组件，不做空壳统一验收器。

## First executable preservation contracts

The original contract test suite now explicitly locks two effect sequences before migration:

- OGUI WAIT prevents probe evaluation, side-path callbacks and supplied-artifact writes, while retaining the existing smoke clock.
- A side-path callback executes before supplied-artifact creation; failure becomes a bypass receipt, successful artifact creation retains original trailing-newline normalization and clears the smoke clock.

These are real adapter tests using a temporary workspace and original clock registry, not mocked policy results. They are not proof that every settlement branch has coverage. The next implementation should isolate existing effects behind a cohesive acceptance adapter only after early-return/trial/existing-artifact/degradation paths are similarly understood; do not split every predicate into a component or introduce configurable callbacks.
