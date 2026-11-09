# DQ0 交付质量契约与身份映射

状态：调用链已核实；原验证登记、签发与匹配组件归入交付验收层。报告/PPTX新增质量能力及版本写入修复尚未实现。
基线：8762fffde。责任人：codex-runtime-manager。

## 生产调用链

```text
Skill frontmatter required-validators
  -> skill-contract.ts 解析固定合同数据
  -> resolve.ts 检查host注册并写入 preflight.requiredValidators
  -> 原 attempt.ts 执行
  -> runProductionValidatorsForAttempt(preflight, workspace)
       -> 实际validateJsonCanvasBytes结果
       -> 交付层 issueValidationReceipt(task/path/bytes/validatorVersion/result)
  -> resolveAttemptDelivery
       -> evaluateDeliveryEvidence(preflight.requiredValidators, 原件检查)
       -> 交付层 matchRequiredValidators(task/path/hash/注册版本)
  -> 原 delivery/completion gate
  -> 原 TaskOutcome acceptance 与独立 transport delivery receipt
```

必需项先来自Skill合同，不由已生成的回执反推。当前唯一已核实的生产validator为 `json-canvas-structure` v1；受原 `OPENBOT_CANARY_VALIDATORS` 灰度开关控制，未设置时不注册/不强制原canvas合同。保持该行为，未扩大灰度或把任何新格式默认设为通过。

下游 `task-outcome/chat-entry.ts:resolveTurnContractFromRunMeta` 从 hookDelivery.validatorReceipts提取ID作为合同摘要，并结合原decisionCode/validatorsRequired。这不是上游以receipt决定必需项的证据；继续保留单独的元数据完整性审计，不凭摘要重建代码就宣称已发现绕过。

## 组件责任与迁移

| 原组件                                         | 规范归属/兼容方式                                                          | 保留语义                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| execution-preflight/types.ts:ValidationReceipt | agent-runtime/contracts/quality.ts；旧types type re-export                 | 字段不变：taskId、artifactPath、artifactHash、validatorId/version、timestamp、result |
| execution-preflight/validation.ts              | agent-runtime/delivery/acceptance/validation.ts；旧文件仅公开入口re-export | 唯一trusted Map、receipts数组、decisionCounts；原hash/签发/匹配/查询/重置            |
| production-validators.ts签发                   | 直接调用delivery/acceptance/index                                          | 仍由固定host注册、真实validator运行后传入判定；不是配置回调                          |
| execution-preflight/delivery.ts匹配            | 直接调用同一交付公开入口                                                   | 每个预声明必需项逐一匹配；缺失/失败/过期/版本变化不通过                              |
| preflight/tool/completion控制                  | 保持原执行与合同适配器                                                     | 不把工具授权、生成写入、发送控制等整个混合模块搬入纯交付                             |

本轮逐字保留原算法，包括“先找passed再找failed”的历史优先级、默认签发passed、查询时不以timestamp筛选、进程内生命周期和测试reset。回执签发不是校验执行本身；未来修正这些语义须独立证据与用例，不能混入等价迁移。

## 成果身份和版本映射

| 现有字段/数据                                         | 权威含义                                       | 不可替代/后续适配                                               |
| ----------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| taskId / attemptNumber / sessionKey / group scope     | 原任务、执行轮次与授权作用域                   | 不将个人看板与协作合同合并，也不由文件名补造任务身份            |
| UI artifactId / assistant-doc hash / legacyArtifactId | 聊天预览与兼容去重身份                         | 不是持久deliverableId，不是原Office文件的字节指纹               |
| logicalId                                             | 原件与归档的逻辑关联                           | 必须带原授权scope，不能跨用户按相同logicalId合并                |
| capture返回的deliverableId                            | 既有成果持久身份                               | 复用resolveSaveArchiveDeliverableId；禁止预览ID覆盖正式ID       |
| birth workspace locator / relativePath                | 原件受权限约束的定位                           | 标题/文件名不作为跨scope全局ID；仍由Gateway可信上下文授权       |
| envelope.version、UI version                          | 各自的声明/展示版本                            | 尚未证明贯穿编辑RPC；不是可依赖的原子写入版本                   |
| 原件bytes完整SHA-256                                  | validator回执匹配对象                          | 不用规范化正文短hash或语义HTML hash冒充原件字节hash             |
| archive rawHash / expectedRawHash                     | 原归档内容指纹及覆盖决策前置条件               | 当前不能证明同时保护出生工作区的PPTX编辑；两处权威需要显式区分  |
| KB documentId / knowledgeBaseId                       | 原KB文档及授权归档位置                         | capture成功不等于KB归档完成；归档完成不等于索引可查询           |
| sourceLineageId / citedKnowledge / dataSource         | 来源链路、引用、lineage/live/reconstructed标记 | 不自动证明关键claim得到原文支持；原文位置/版本/时间口径仍需补齐 |
| ValidationReceipt                                     | task/path/bytes/validator版本绑定的检查结果    | 不是投递回执，不是完整排版/真实性报告，也不持久跨重启           |

DQ1不得直接将archive expectedRawHash当作编辑CAS；必须由原文件读取入口产生当前原件指纹，并在原patch写入临界区对同一原件比较。审计的group/steward patch请求目前只有slides和定位参数，未见此前置条件。先做同一原件的双请求与旧预览写回反例，再处理原写路径。

## 类型与质量矩阵

以下是实施用分类矩阵，不是新增运行时validator注册，也没有把未实现的规则变成自动门禁。

| 成果/维度       | 已核实基础                                        | 尚缺的必需能力（依任务合同选择）                                       | 当前可作何结论                                      |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| JSON Canvas结构 | 实际字节解析/schema校验及原灰度validator          | 其内容事实、可视审美等独立能力                                         | 只能在原合同、灰度和真实回执满足时说结构通过        |
| 报告输出规范    | 原envelope、语言净化、可读原件、回合合同          | 章节/字段/单位/时效的显式profile和校验绑定                             | 不声明已有统一报告质量通过                          |
| 报告来源/数字   | 既有lineage、citedKnowledge、data治理及引用基础   | claim→原文位置/快照、数据口径/时间、复算、冲突/未知披露的实际validator | 检索相关或URL可访问只证明各自事实                   |
| PPTX完整性/编辑 | 原件字节、文本提取、语义HTML、group/steward patch | 全链版本映射、编辑前置条件/原子写、刷新/保存/归档同版本证据            | 可证明已支持的格式/操作，不能外推像素质量和并发安全 |
| 文档/PPTX排版   | 原Office预览与原文件下载                          | 真实原格式渲染、逐页裁切/遮挡/字体/图表标注检查                        | HTML/文字预览不能充当真实版式QA                     |
| 审美            | Skill/模板指导、用户偏好输入                      | 版本化tokens/rubric、实际页图模型或人工评审与证据                      | 单列建议/偏好评价，不充当事实或投递证明             |
| 全类型使用体验  | 原保存/归档/冲突决策与预览入口                    | 同成果同版本跨入口闭环、分离回执、失败恢复与重试幂等实证               | 各单点绿不代表闭环已通过                            |

质量profile须在指挥层明确目标/验收时选择，内容是类型、规则ID、版本、适用条件、必需或建议、阈值与模板引用。不存在的validator标缺失/未检查；不注入脚本、动态模块、表达式执行或第二调度逻辑。普通对话不因此被强制走文件质检。

## 下一项完整用例

DQ1：PPTX同一原件生成→预览→编辑→保存→刷新→原KB归档→再次编辑冲突。先沿当前group/steward入口写失败反例；所有改动保留既有鉴权、原件格式、保存决策和独立任务生命周期。需要同进程/协作写入范围明确的临界区证据，不能声称能阻止绕过协议的任意外部写入。
