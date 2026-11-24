# 知识库检索摘要实施与验收

## 目标

在保留原文分块检索的基础上，建立可追溯的结构化检索摘要。截图建议是待验证假设，不代表当前能力缺失。摘要失败不得阻断正文全文检索。

## 角色

- codex-kb-review：验收负责人；审核实现、权限边界、测试与迁移证据。
- 实施子代理：实施负责人；通过 loom 注册实际路径，核查现有代码后实现，不自行合并或部署。

## 待实施清单

- [ ] 1. 盘点全部文档入口：文件上传、个人保存、企业导入、网页、成果归档、连接器投影；列明摘要/索引/权限/版本现状和实际代码位置。
- [ ] 2. 定义统一摘要契约：主题用途、核心内容、覆盖范围、关键实体、适用边界；按制度SOP、报告、纪要、数据表适配，未知值不推断。
- [ ] 3. 独立检索摘要与预览摘录，新增向后兼容字段；结构化实体、日期、版本保留独立元数据。默认150–300中文字为软质量目标，不作硬入库门槛。
- [ ] 4. 摘要溯源：绑定文档版本和内容哈希，记录生成方式/模板版本、生成时间、人工修订；原文变化标记待更新。
- [ ] 5. 建立异步生成/更新状态：待生成、处理中、可用、失败、过期；失败可重试，禁止用简单正文截断冒充生成摘要，正文始终可检索。
- [ ] 6. 接入实际入库与更新链，优先复用现有队列/模型调用/预算治理。历史文档按需或批量补齐，幂等、不覆盖人工编辑，不触发未授权外发。
- [ ] 7. 检索接入：摘要及授权元数据参与文档召回，正文块提供证据；去重避免摘要压倒原文；结果可回溯原始段落和引用。
- [ ] 8. 统一机器人可见状态：文档ID、库归属、来源、版本、可访问性、解析/全文/向量/摘要状态、时效与治理状态。不得通过诊断泄漏未授权文档信息。
- [ ] 9. 梳理版本关系：修订、提炼、重复、替代、终稿与事实冲突分别表达；复用现有lineage，禁止自动将最新标终稿。
- [ ] 10. 提供维护入口：查看摘要、生成失败原因、重试、人工修改及过期提示；异步过程不阻断导入。
- [ ] 11. 补充回归与评测：长文后半部、否定条件、无摘要、摘要失败、版本变化、人工编辑、重复、跨租户与撤权、仅摘要命中后原文核验、旧数据迁移。
- [ ] 12. 输出评测证据：固定问题集，对比召回/排序/引用准确性、延迟与成本；不编造提升指标。

## 验收门槛

- 所有入口有明确覆盖或有理由的待办，不得把局部实现标为全量完成。
- 摘要事实可溯源；没有模型配置时如实待补，不回退成伪摘要。
- 权限先于召回/展示，摘要继承原文权限，删除与撤权及时失效。
- 现有正文检索、版本及治理能力不回归。
- 测试有关键行为证据；类型、lint、构建检查通过。修复前后对照或明确新功能用例。
- 独立验收通过后才提交发布建议；不自动部署，不批量修改真实知识库。

## 实施约定

先产出代码盘点与设计说明，再分阶段实现，每个检查点在此记录证据与未完成项，并签名。业务必要的范围调整由验收负责人审查。不得为赶进度降低断言或隐藏失败。

## 实施检查点

- 基线 fetch 成功，origin/main 为当前HEAD祖先；已通过loom登记 codex-kb-implement。
- 已实现第一阶段摘要结构与版本/哈希失效、人工编辑保护基础模块。3项回归测试通过，lint通过。尚未接入数据链路，不计为端到端完成。— codex-kb-implement
- 待办：全部入口完整盘点、持久化、异步生成、历史补齐、真实召回、维护UI、权限与版本矩阵评测。— codex-kb-implement
- 第二检查点：新增SQLite摘要持久化，入库正文完成后best-effort pending/stale入队，读取要求授权KB集合，注入异步生成器通过claim+version+hash原子落库，失败不抛回入库链。5项摘要测试通过。尚未接真实调度器、维护UI与召回；人工编辑持久化维护入口待补。— codex-kb-implement
- 第三检查点：补处理租约超时回收；生成器接收服务端授权读取的正文，前后各复核源与授权；人工摘要保留旧稿并单独暴露当前源版本/hash；队列写异常输出不含内容的告警。6项摘要回归与lint通过。真实调度器、维护入口及召回仍待接入。— codex-kb-implement
- 第四检查点：租约恢复前先检查KB授权并服务端读取源；新增未授权调用不得修改其他库processing租约测试；人工摘要维护写入原语要求服务端授权当前源。7项摘要测试通过。尚未接RPC/调度，不计功能闭环。— codex-kb-implement
- 第五检查点：接入 knowledge.document.summary RPC（既有KB ACL read/write），支持人工字段读取/编辑；documents.list返回retrievalSummary状态；授权KB检索的substring回退读取当前ready摘要（不作正文证据）。人工v1→源v2→人工修订v2回归通过，失败保留稳定码。8项摘要测试、变更lint、全仓类型检查通过。待补RPC完整集成测试、队列调度和UI。— codex-kb-implement
- 第六检查点：摘要召回改成单DB streaming扫描、固定topK，移除首100文档截断；即使已有正文命中也继续摘要候选，二者分别返回（摘要不伪造证据）。新增第103文档唯一命中、跨KB及源更新失效测试，9项摘要测试通过。机器人知识详情显示摘要状态与用途。尚未完成统一排名、RPC集成测试、维护编辑UI、实际队列消费者。— codex-kb-implement
- 第七检查点：摘要候选不再依赖bundle对象，返回稳定docId/title/sourceUri，按相关性合并去重。新增真实knowledge.base.search + knowledge.document.summary RPC纵向用例：人工写入→无对象投影召回→跨KB伪造不返回→超长拒绝→撤权后读写拒绝。新用例单独通过；同文件另两项既有搜索行为测试失败，需继续定位。尚未接knowledge_search工具、调度消费者与编辑UI。— codex-kb-implement
- 第八检查点：HEAD隔离对照确认原搜索RPC两失败均原已存在。已修复其中canonical文档ID与个人对象投影ID映射导致的漏召回，原断言保留且通过；剩余历史测试期望AND但全文实现自动OR回退，暂不全局修改语义。knowledge_search指定KB分支已消费摘要候选并提示需knowledge_get核验。现有普通tool mock尚待同步。— codex-kb-implement
- 第九检查点：队列消费者接入server-maintenance（默认关闭，显式OPENBOT_KNOWLEDGE_RETRIEVAL_SUMMARIES=1才允许模型生成），复用现有AgentKnowledgeLlmCaller和其超时边界，每轮2次调用上限，超长源拒绝而非截断冒充全文摘要。人工编辑UI调用summary RPC，knowledge_search全库分支也消费授权摘要候选。模型真实运行未触发。仍需生成schema严格校验、中央预算记账接入、维护UI行为测试与工具mock更新。— codex-kb-implement
- 第十检查点：knowledge_search 14项既有回归通过，指定KB与全库分支均消费摘要；UI折叠编辑字段持久化；消费者接真实维护tick默认关闭、调用上限与现有治理token记账，模型输出结构严格校验。入口盘点、CPU扫描限制与基线AND/OR语义已记录design.md。尚待RPC更广矩阵、UI行为测试、FTS性能实现、商业预算与批量历史回填。— codex-kb-implement
- 第十一检查点：UI编辑行为测试通过（初始化实际详情状态→读取摘要→编辑调用RPC→重读显示新值），knowledge_search 14项回归通过。HEAD对照搜索RPC原两失败已定位并修好canonical ID漏召回，剩余历史查询AND/OR基线语义单列。— codex-kb-implement

## 逐项状态（实施中）

| 任务        | 状态     | 证据与未完成项                                                                  |
| ----------- | -------- | ------------------------------------------------------------------------------- |
| 1入口盘点   | 部分     | design.md覆盖上传/保存/企业/网页/成果/连接器/技能关联；需逐入口集成测试         |
| 2统一契约   | 完成基础 | retrieval-summary.ts，五类字段、文档类型、版本/hash、状态                       |
| 3独立字段   | 部分     | 独立SQLite记录与文档列表返回；结构化日期/版本元数据仍待扩展                     |
| 4溯源       | 部分     | 版本/hash/模板/方法/生成时间；人工跨版本测试通过；人工作者ID待加                |
| 5异步状态   | 部分     | pending/processing/ready/failed/stale、lease恢复、稳定失败码；重试UI待加        |
| 6入库与历史 | 部分     | kb-ingest成功后队列；maintenance默认关闭消费者；商业中央预算及批量补齐未完      |
| 7检索       | 部分     | 指定KB和全库knowledge_search接入；FTS5 trigram+源校验；相关性实证与短词性能未完 |
| 8机器人可见 | 部分     | 详情状态/摘要，列表摘要；统一正文/向量状态返回未完                              |
| 9版本关系   | 未做     | 已复用当前版本与hash，不自动标终稿；revision/derived/supersedes关系契约待补     |
| 10维护UI    | 部分     | 详情折叠编辑JSON→RPC→重读测试通过；结构化表单及retry未完                        |
| 11回归      | 部分     | 摘要生命周期、ACL、RPC、UI、tool测试；跨入口/删除消费者/长文待补                |
| 12评测      | 未做     | 尚无固定问题集与前后指标；不得声称检索提升                                      |

## 当前测试总表

- retrieval-summary.test.ts：3项通过。
- retrieval-summary-store.test.ts：5项通过。
- retrieval-summary-recall.test.ts：1项通过（第103条、跨KB、版本失效）。
- retrieval-summary-worker.test.ts：2项通过（无配置、预算拒绝、授权生成）。
- knowledge-consume-tool.test.ts：14项通过。
- knowledge-base-search-rpc.test.ts：新增纵向用例通过，原canonical回退已修好；剩余一项历史AND/OR基线失败。
- my-bot-data-surface.node.test.ts：2项通过（含编辑刷新）。
- 全仓类型检查通过；修改文件lint通过，最终集成构建尚待运行。
  — codex-kb-implement
- 第十二检查点：模型及人工共用strict fields校验，空用途/超长/非法数组拒绝；源删除during generation测试通过。knowledge_search摘要导航保留docId/kbId/标准ku://版本引用，避免hitFromObject丢失引用。5文件24项当前回归通过；UI2项通过。商业预算尚未完成，生成默认关闭。— codex-kb-implement
- 第十三检查点：实际消费者加入每轮至多100条历史缺失摘要pending回填，仅针对仍归属KB且当前版本的文档；默认开关关闭时不扫描不生成。固定合成问题集1项通过（只证明导航字段覆盖，不证明真实语料质量）。类型检查通过；生成中央商业预算、长文分章及统一多版本关系仍未完成。— codex-kb-implement
- 第十四检查点：维护UI显示稳定失败码，提供“重新排队生成”；RPC retry只允许KB写权限，人工稿不被自动重试覆盖。原文已读但摘要RPC暂不可用时保留正文展示。每轮历史补齐及strict schema已接。— codex-kb-implement
- 第十五检查点（安全收紧）：删除仅凭环境开关使用全局cfg模型的调用路径；维护tick现在还必须有组合根注入的tenant/model/transmission/billing authority，未注入保持pending不遍历KB不调用模型。尚未找到能直接复用且承载该authority的现成自动摘要预算入口，因此商业预算接入仍未完成，不允许开启生产生成。失败指数退避、自动最多3次，显式维护重试重新计数。— codex-kb-implement
- 第十六检查点：摘要契约增加revision-of/derived-from/duplicate-of/supersedes与draft/final的可选人工状态，默认不自动标终稿；目前尚未接版本维护RPC与UI，因此任务9仅部分。失败重试消费者新增次数/退避行为测试；未配置商业authority时真实维护tick不会枚举租户资料。— codex-kb-implement

## 历史基线变化（已解决）

远端main推进3819dbcf7（#333）后曾暂停；根代理已整合为fef98b972，WIP恢复并复验。该暂停已解除，后续最终构建通过。未提交、未部署。— codex-kb-implement

- 第十七检查点：组合根已安装中央商业authority，逐调用验证当前KB/文档、唯一有效租户席位、订阅/预算/并发/模型授权，只选allowlist模型，recordCreditUsage绑定同租户/用户/席位。私有未知作用域自动生成仍fail-closed。2项商业适配测试通过，无真实调用。长文持久化分章map/reduce与预算延期2项通过；类型化提示已接。版本关系RPC同KB目标约束、人工终稿和审阅人真实纵向测试通过。— codex-kb-implement

## 当前实施状态（主干整合后，替换前述旧暂停说明）

| 任务            | 状态             | 实现与待验收                                                                                                                         |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1入口盘点       | 已盘点           | design.md入口表；连接器动态数据不自动转换为静态摘要                                                                                  |
| 2统一契约       | 已实现           | 结构化字段、文档类型模板、软长度质量提示，未知值不编造                                                                               |
| 3独立字段       | 已实现基础       | 预览与检索摘要分离，RPC/列表/工具返回；额外日期实体细分仍可扩展                                                                      |
| 4溯源           | 已实现           | 版本/hash/模板/方法/时间，人工reviewedBy，更新stale不覆盖旧稿                                                                        |
| 5异步状态       | 已实现           | lease恢复、claim原子提交、前后授权源校验、失败码、退避3次上限、显式重试                                                              |
| 6入库/历史/调度 | 已实现待验收     | 正文入库best-effort排队、历史每轮100条、真实maintenance消费者、商业闸口/模型allowlist/持久化usage outbox；个人未知作用域自动生成拒绝 |
| 7检索           | 已实现待性能验收 | trigram FTS候选、当前源校验、KB/全库tool消费、无投影候选、标准引用；短词无trigram仍流式降级                                          |
| 8机器人可见     | 已实现基础       | 详情中文状态、失败提示、摘要字段；索引和治理字段保持现有机制                                                                         |
| 9版本关系       | 已实现基础       | 维护RPC同KB关系目标校验、人工draft/final及reviewedBy；无自动最新=终稿                                                                |
| 10维护UI        | 已实现基础       | 读取、JSON字段人工修改、写ACL、重试、失败可见、刷新；JSON编辑可后续改善为表单                                                        |
| 11回归          | 已实现核心       | 存储/授权/删除/撤权/人工/长文跨tick/队列/商业/工具/RPC/UI；全入口大矩阵仍需验收                                                      |
| 12评测          | 部分             | 固定合成问题集有基线对照；不称真实库召回提升，真实语料延迟/成本评测未运行                                                            |

## 汇总验证

- 摘要核心+knowledge_search：31项通过（随后新增跨tick存储1项、软质量1项，待最终统一跑数）。
- 商业authority/长文层级：4项通过；真实RPC维护与混合召回纵向用例通过（运行时跳过其余5项，未声称整文件通过）。
- 机器人数据面UI2项通过。
- 原文入库/治理/技能标题14项通过。
- 全仓类型检查通过；修改文件lint通过。
- 完整隔离构建通过（/tmp/kb-summary-current-build.log），后续商业/长文改动需最终再构建。
- 商业计费usage先enqueueUsageOutbox，再recordCreditUsage，失败由原drain重试；并发finally释放。无真实模型调用，无用户KB变更，无提交无部署。
  — codex-kb-implement

## 最终统一验证矩阵（2026-11-22，未提交待根代理验收）

| 范围                                                                                        | 结果                                   | 日志                                    |
| ------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------- |
| 13文件：摘要契约/生命周期/lease/撤权删除/FTS/预算重试/商业authority/长文/质量/工具/原文入库 | 52通过                                 | /tmp/kb-summary-final-unified-tests.log |
| 完整搜索维护RPC文件                                                                         | 5通过、1基线失败（AND/OR历史查询语义） | /tmp/kb-summary-final-unified-rpc.log   |
| 维护编辑UI                                                                                  | 2通过                                  | /tmp/kb-summary-final-unified-ui.log    |
| 全仓类型                                                                                    | 通过                                   | /tmp/kb-summary-final-unified-types.log |
| 30个修改文件lint                                                                            | 0警告0错误                             | /tmp/kb-summary-final-unified-lint.log  |
| 完整隔离构建                                                                                | 通过                                   | /tmp/kb-summary-final-build.log         |

实现边界：默认关闭自动生成；私人/未知租户scope无中央授权时pending而非出网。最长16章/192000字符，超限转人工维护；短于3字符查询或SQLite无trigram时用流式fallback，性能需后续实库评估。固定评测为合成导航字段覆盖，不提供真实库召回/排序/延迟/费用提升结论。真实付费生成与用户KB实测未授权，均未运行。
— codex-kb-implement

- 终验计费恢复修复：provider返回usage成功持久化outbox后，recordCreditUsage/markDone即时失败只保留pending并告警，允许章节持久化，避免恢复后重复生成/收费；enqueue本身失败仍抛错。新集成测试先失败后通过，验证跨tick总调用3次且首笔pending回执保留。商业admission、modelGate、creditReporting三层tenant mismatch均拒绝并释放槽，未读凭证。authority/hierarchy/store共17项通过；变更lint、全仓类型检查通过。— codex-kb-implement

## 计费终验修复后的最终统一矩阵

| 范围                                       | 结果                                   | 最终日志                                     |
| ------------------------------------------ | -------------------------------------- | -------------------------------------------- |
| 13文件摘要/商业计费恢复/长文/工具/原文入库 | 58通过                                 | /tmp/kb-summary-post-billing-final-tests.log |
| 完整搜索维护RPC文件                        | 5通过、1项已在HEAD基线复现的AND/OR失败 | /tmp/kb-summary-post-billing-final-rpc.log   |
| 维护UI                                     | 2通过                                  | /tmp/kb-summary-post-billing-final-ui.log    |
| 全仓类型                                   | 通过                                   | /tmp/kb-summary-post-billing-final-types.log |
| 31文件lint                                 | 0警告0错误                             | /tmp/kb-summary-post-billing-final-lint.log  |
| 固定本地合成评测                           | 2通过                                  | /tmp/kb-summary-fixture-eval-final.log       |
| 最终完整构建                               | 被新main基线前置阻断，未运行           | 最新main a54ee94e0，当前fef98b972非其后代    |

夹具评测严格限定：3个本地合成文档，标题/无摘要导航命中0/3，结构化摘要导航3/3，标准引用可解析3/3，外库候选0，版本替换后候选0；不代表正文检索基线，不泛化真实语料召回、延迟或费用收益。真实语料评测仍待办。

主干再次推进a54ee94e0（#331）后遵守baseline fail-closed；未做最终构建，未提交，待根代理安全整合后重跑。当前文件差异清单/tmp/kb-summary-final-main-advance.txt。— codex-kb-implement

## 历史RPC与真实合成模型内容安全终验

历史查询修复：仅旧版unique marker当前零命中，显式旧版可命中；另验证多词AND→OR回退命中且证据全为当前版本。为实现真实历史读取，kb-ingest在更新stable anchors前保存历史关键词块，默认当前增量枚举不含归档块，既有增量断言保留。完整RPC6项全通过。

真实模型合成样例进入项目parse→store→recall→citation解析的离线复验：4/6策略接受且引用可解析，Flash/Pro各1份纪要因注入引用/生成过程元话语被拒绝。不是6/6质量通过；词策略不替代人工语义审查。日志/tmp/kb-real-model-project-integration.log、报告/tmp/kb-real-model-project-integration-report.json。

最终统一矩阵：14文件66项通过（含完整RPC），UI2项通过；全仓类型通过；33文件lint0警告0错误。日志/tmp/kb-summary-delivery-final-{tests,types,lint,ui}.log。修复后最终构建再次因main推进6b926c5e1（#328）而前置阻断，未运行，不能沿用旧日志。请根代理整合当前基线后重跑。— codex-kb-implement

## 授权真实纪要复测与最终lint收尾

- Flash/Pro各1次真实合成纪要调用（总计2次），修正后hierarchy提示；两次HTTP200，字段策略接受、SQLite维护写入、摘要召回、标准ku引用解析均通过，外KB命中0。
- 人工复核：两模型保留暂不上线、权限未通过、王敏补测和发布日期未定；未把恶意引用、生成过程自述写入导航字段。仅2个样例，不泛化可靠性；原6样例2个污染纪要仍保留失败证据。
- 证据：/tmp/kb-meeting-live-retest.json、/tmp/kb-meeting-live-retest.log、/tmp/kb-meeting-live-retest-review.json。凭证仅内存读取，未打印。
- 完整RPC最终6项全通过：/tmp/kb-summary-final-rpc-confirmation.log。
- 根代理终验发现的3项type-aware lint已修复（grapheme计数Intl.Segmenter、冗余非空和类型断言），pnpm lint全仓0警告0错误：/tmp/kb-summary-final-type-aware-lint.log；pnpm tsgo通过：/tmp/kb-summary-final-type-aware-types.log。
  — codex-kb-implement

## 2026-11-23 当前交付边界

本版本仅允许人工创建和编辑检索摘要，并保留历史版本绑定摘要导航。自动模型生成、收费、后台 worker 和重试生成入口已移除；旧环境开关不能启用。历史模型摘要不代表人工审核。此前自动生成相关记录仅为历史设计和证据，不是当前能力。— codex-kb-repair
