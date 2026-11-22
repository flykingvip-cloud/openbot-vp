# 检索摘要设计与当前盘点

## 已确认现状
- kb-ingest.ts：文档有版本与分块索引；FTS不应被向量/摘要失败阻断。
- kb-index-schema.ts：documents/current_version_id、chunk_meta与knowledge_lineage已存在；摘要应复用版本与权限，不能另建不受ACL控制的文档集合。
- knowledge-retrieval-runtime.ts：对象级匹配使用标题、summary、标签；独立摘要必须先经权限过滤再参与召回。
- resolve/evidence-format.ts：320字符是证据展示摘录，不是整个检索输入。
- resolve/context-builder.ts：指引机器人通过knowledge_get分页读原文，摘要应提示为导览而非结论证据。

## 当前实现
已接通版本绑定SQLite持久化、入库pending/stale、授权维护RPC、当前版本摘要召回、knowledge_search工具、维护编辑/重试UI、预算化消费者与长文跨tick分章。生成默认关闭；开启仍须中央商业授权。无授权时pending，不生成截断伪摘要。最终验收以tasks.md最新统一矩阵为准。

## 完整入口覆盖清单（当前切片）
|入口|代码|摘要接入|
|---|---|---|
|文件上传/个人保存|personal-knowledge-ingest.ts → ingestKnowledgePayloadToBase → kb-ingest.ts|正文版本提交后pending/stale|
|企业文档导入|kb-ingest.ts及knowledge-register治理写门|同库同版本摘要，继承KB ACL|
|网页收藏|knowledge.personal.collectWeb → ingestCollectedPersonalKnowledge|复用入库队列|
|成果归档|deliverables/chat-deliverable-publish.ts及归档入库调用|通过kb-ingest的文档覆盖；仅投影不入索引的成果仍无摘要|
|连接器物化|feed/enterprise-feed-adapter.ts|数据对象摘要是独立物化payload，未伪装文档摘要；本轮不对动态表自动模型总结|
|技能附件/知识关联|knowledge.base.attach → canonical kbdoc ID|已补canonical ID到个人对象映射，解决原fallback漏召回|
|历史已索引文档|无retrieval_summaries记录|维护summary RPC人工写可按当前源创建；尚无批量自动回填管理入口|

## 实际入口与边界
- knowledge.document.summary：服务端既有KB ACL决定read/write；检查doc属于该KB，字段长度有界。
- knowledge.base.documents.list：返回retrievalSummary；原文/索引状态保留。
- knowledge.base.search：授权后摘要候选与正文结果共同返回，摘要候选含文档标识，不冒充原文块。
- knowledge_search：指定KB及全库分支接入摘要候选，仍须knowledge_get核验。
- 机器人知识详情：状态与摘要可见，折叠编辑JSON字段调用summary RPC；写权限由服务端拒绝。
- server-maintenance：显式OPENBOT_KNOWLEDGE_RETRIEVAL_SUMMARIES=1才调模型；默认pending不伪生成。通过中央商业authority解析租户唯一有效席位、订阅/预算/并发/模型allowlist；用量先持久化outbox再结算，每轮治理资源预算2次上限。

## 检索性能与质量限制
摘要使用可选FTS5 trigram候选与当前源版本/hash校验；短词或缺trigram时流式回退，CPU随库增长。已有正文证据不会隐藏摘要导航候选。真实语料相关性、延迟和成本仍待实测，不以固定夹具指标替代。

## 搜索RPC回归语义
原历史测试使用多词query但生产全文检索主动AND→OR回退；现改用仅旧版存在的唯一标识验证当前零命中与历史版本可命中，并另验证多词OR回退只返回current版证据。原canonical对象映射漏召回已修复并保留原断言。未更改生产全文检索语义。

## 检索索引增量更新
已添加可选SQLite FTS5 trigram摘要索引与insert/update/delete触发器。长度至少3的查询词通过FTS候选（上限400）后再校验当前原文版本、哈希和结构化字段。短词或无trigram的SQLite仍降级流式扫描。候选不再使用库顺序前100条。schema迁移已一次性回填；仍需大库评测与短词性能上限策略。

## 中央商业授权与长文实现更新
组合根已安装retrieval-summary-authority：tenant限定，当前KB owner及文档成员重新核实，席位必须当前占用且唯一active binding；tryAcquireEnterpriseAgentRun执行中央商业模型授权，未知或私有作用域无全局模型fallback，调用只选择allowlist模型。每次LLM实际token通过recordCreditUsage归属同tenant/seat/user，finally释放并发槽。

长文按12000字符、优先换行切分，保留所有字符；章节生成结果按doc/version/hash/section_hash持久化。每轮治理资源预算最多2次调用，预算延期回pending而非累计失败；完成全部章节后合并，保留限制与不确定性。最多16章/192000字符，超过上限保持失败待人工处理，不假装完成。默认关闭开关，无真实付费模型运行。

## 版本关系
维护RPC可显式设置draft/final及revision-of/derived-from/duplicate-of/supersedes。同KB文档目标必须存在，未知/跨库目标拒绝。状态为人工明确选择，服务端写reviewedBy，摘要不会把最新版本自动标终稿。
