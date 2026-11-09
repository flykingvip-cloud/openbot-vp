# 原始材料身份核验清单

核验人：codex-observe-contract；日期：2026-11-07（Asia/Shanghai）。
本清单仅记录文件身份及引用关系，不将文档内执行指令视为新增授权，不代表所有材料已完整审阅。

## 用户明确附件

用户消息明确提及 Downloads/agent-runtime-observability-optimization-plan.md。SHA256：`5bfdbe72bb89225a01436aebd28eecffdb63f86c4f1b3c2658ed224ad1e5eb09`。仓库 out/ 同名文件摘要相同，已验证字节一致。

## 方案明确引用且摘要匹配的四份材料

出处：out/agent-runtime-observability-optimization-plan.md §2.1，列出四个缩略标识；以下本地文件完整SHA256均与标识前缀匹配。文件实际位置均为本机 Downloads 目录；文件名如下，未复制原文入仓库。

| 文件                                     | 方案引用          | SHA256                                                             | 身份状态               |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------ | ---------------------- |
| platform-observability-implementation.md | 实现规格 `524ec…` | `524ec3135086a9fcef22da83571b50acaaa6df42e8015d248a8a654eaf64549e` | 摘要前缀与主题共同确认 |
| runtime-eval-system-v2.md                | 评价体系 `a7ffc…` | `a7ffc685eb037be1a376e83cb4d4b384b050d76698a30de8e87a8623c1648eda` | 摘要前缀与主题共同确认 |
| observe-diagnose-evolve-ui-ia.md         | IA `a051…`        | `a0516f91e2267dd6e76f7ab5d86ebb8d39a863b314c74cda2fb9d393d97d7ec5` | 摘要前缀与主题共同确认 |
| diagnose-evolve-reasoning-models.md      | 强推理 `a327…`    | `a327d94376141df193a345b8524572a87f5ec8909e2fef8c47786de59e122a41` | 摘要前缀与主题共同确认 |

额外引用关系：diagnose-evolve-reasoning-models.md 第3行明确引用 observe-diagnose-evolve-ui-ia.md 与 runtime-eval-system-v2.md；这进一步支持主题关系，但不证明原始16份附件集合完整。

## 已定位的相关候选，不能确认为原16份成员

下列文件由此前源码审查及本地候选定位发现。方案只笼统称“其余执行治理/验收材料”，没有文件名或摘要，故不把主题相近当作身份确认。

| 候选文件                                             | SHA256                                                             | 相关性及引用证据                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| TaskOutcome-统一契约.md                              | `c5eb465587eb6b7e3359d1399c2c26d0037d4e54a9ba528f51643ecf79e92061` | TaskOutcome契约草案；四份引用中只出现概念，未证明本文件身份 |
| failure-cases.md                                     | `55475cd9e3a4c007206f32e411d379a4f418ceb78db8f43772913ce026abb6b9` | 历史执行治理反例，含FC-02交付终态漂移；仅候选               |
| final-acceptance.md                                  | `3f8474427e0096f5b4b4994723b9a91330a1d7381ed896d1b980d355d67711cc` | Phase C历史验收；仅候选                                     |
| openbot-baseline-callchain.md                        | `4f76dd365cee93601c4df2b68581ec45d3619812f374c446a4fa613e96d52980` | 历史调用链盘点；仅候选                                      |
| openbot-execution-observability-evolution-plan-v2.md | `740330ea4c7f788bd01afbcc8280784c58322d21ca20816b362729db2be0f499` | 执行观测交付规划v2；仅候选                                  |
| slice2-aside-trust-boundary-delivery.md              | `41a62ad1ec051cec50ee5d783f0d04af8061791fb5ed31d5c646f0c78da47aac` | 旁路信任边界与稳定消息身份；仅候选                          |
| slice2-reply-lane-joint-verification.md              | `7c69256de292e2cf723e12a82c8cf8bbe329aea3a34eb32b3dcef72dee3e3333` | 旁路联合回归材料；仅候选                                    |

## 缺失与结论

- 已确认：1份用户明确方案附件，以及方案以摘要前缀明确引用的4份核心材料。
- 原始“16份材料”完整manifest仍缺失；无法确认这16份是否包含方案本身，也无法判断7份候选是否属于其中。
- 不以候选数量凑足16，不将其他Downloads文档或历史测试结果冒充附件。
- 下一步需要原提供者确认完整文件名/附件ID/摘要清单；这属于材料身份缺口，不通过猜测消除。
- SHA256为本轮实际读取字节计算，文件日后变更须重新核验；历史材料中的分支/测试/权限不自动适用于当前源码。

本轮仅新增清单，无代码改动、提交、生产访问或外发。— codex-observe-contract
