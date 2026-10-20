# 入库后接哪些知识工程技能

`wechat-personal-kb` 只负责：私有库 + 明文导出 bind/sync + 核验 preview/consume。后面按现有 KE 技能接力，不要在本技能里复制它们的正文。

| 接下来                          | 技能                     |
| ------------------------------- | ------------------------ |
| 条款/段落引用、`raw_hash`       | `source-lock-and-cite`   |
| 新域刚开始、先标几份            | `knowledge-cold-start`   |
| 从导出里抽实体/关系（规则优先） | `scalpel-hybrid-extract` |
| 抽完要纠错                      | `agent-reflection-qa`    |
| lint / 引文必须能 grep          | `five-layer-qa`          |
| 上线后谁改库                    | `knowledge-gardener`     |
| 全流程依赖                      | `enterprise-kb-pipeline` |
| 不知道下一刀                    | `enterprise-kb-catalog`  |

派生摘要用 `knowledge.base.agent-knowledge.generate`（`conversation_summary` / `auto_analysis`），不是定本。

禁止：把 KE 技能当微信扫码入口；为微信 invent 新 kind；先 embedding。
