# Batch 1 灰度单草稿（准备，不执行）

- 起草时间：2026-11-16 18:55 CST（Asia/Shanghai）
- 状态：草稿。生产部署、灰度启用和 `deploy/production/releases.jsonl` 账本变更仍保留为授权人最终批准步骤，本轮未执行。
- 起草人 / 隔离交付 owner：`auditbot-batch1`

## 候选版本

- 基线：freshly fetched `origin/main` = `a78c5b66959dac3db4ecb2ecd2065aaec029b3c3`
- 候选分支：`batch1/capability-enablement-20261116`
- 候选 SHA：合入 PR 后以 `origin/main` 新 tip 为准（推送后回填本分支 tip）。不得使用 `commit=null`。
- 网关 / UI SHA：与候选 SHA 相同，待构建后回填。
- 镜像 ID：pending（本轮未构建生产镜像）
- Registry digest：pending（不得用镜像 ID 冒充 digest）
- `OPENBOT_BUNDLED_VERSION`：仅作自报版本证据，不能替代 digest。

## 试点与负责人

- 试点租户：待授权人指定（建议非 LIVE 业务租户，或内部 canary `001` 仅用于诊断只读/人工处置，不打开外部投递）
- 负责人：待授权人指定；隔离准备 owner 为 `auditbot-batch1`

## 配置差异（隔离已验证 / 生产默认不要自动复制）

| 项                                 | 生产当前默认              | 隔离验证取值                             | 恢复方法            |
| ---------------------------------- | ------------------------- | ---------------------------------------- | ------------------- |
| `OPENBOT_PROGRESS_LEDGER_ENABLED`  | 关（unset / 非显式真）    | 测试内设为 `1`，测后恢复                 | 删除该 env 或设 `0` |
| ConversationTask activation 五开关 | 默认关；activation 仍禁止 | 未打开                                   | 保持 unset          |
| `OPENBOT_KNOWLEDGE_AUTO_GENERATE`  | 关                        | 未打开                                   | 保持 unset          |
| 诊断自动修复执行                   | 关                        | 未打开                                   | 保持关              |
| 诊断外部投递 / 活 Daibai           | 不在本轮启用              | 未打开；官方路径本身使用 `deliver:false` | 保持关              |
| 四个编排主开关                     | 默认关                    | 未打开                                   | 保持关              |

## 按闭环的成功标准

1. 任务进度与交付物：用户可发起任务，看到进行中/完成/失败，取得真实交付物，刷新后状态仍正确。
2. 知识复用：后续任务可按官方 cite / logical id 找到先前交付物；跨租户读取被拒绝。
3. 基础诊断：可查询报告、看到问题解释、提交人工处置并追踪状态；不依赖自动修复或外部投递。

## 费用上限与停止条件

- 费用上限：待授权人填写。隔离测试未调用付费 web search / 活模型。生产灰度建议先设明确 USD 与迭代上限，超限必须 fail-closed。
- 停止条件：跨租户写入或读取成功、不可逆删除、自动修复被触发、外部频道投递发生、生产执行模式拒绝被绕过、或费用超限。
- 回滚：关闭 `OPENBOT_PROGRESS_LEDGER_ENABLED`；保持其余本批未批准开关关闭；回退到本灰度前的可追溯镜像（digest 待构建后填写）。回滚演练：隔离测试已验证 ledger 关闭时不投影（既有 `progress-ledger` 单测），本轮未做生产回滚演练。

## 与当前 LIVE 的兼容

- 本批代码变更：注释/示例文案 + 隔离测试与 Loom 登记，不改变生产运行时默认值。
- 现网 digest / bundled SHA 不以卫生附件追认；新候选必须另做可追溯构建后再填。
- 诊断 Conversation UI 旧版本状态未知，不能推定新版本已安全可用。
