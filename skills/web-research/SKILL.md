---
name: web-research
description: "识别意图后按「意图 + 信息时效性 + 用户要求」自动触发网页调研，不要只靠关键词。明确说调研/研究、比较产品当前价格、问最新政策或行业动态、或要求阅读指定网页并分析时务必使用。遇到「检索不等于下载」「调研三分流」务必先分流再抓取。改写已提供文本、可基于已有材料完成、分析上传文档时不要使用；稳定基础知识通常不联网。输出可追溯报告。证据表交接 research-core；战略纵深交接 deep-research；金融标的交接 finance-research；单页提取交接 defuddle。"
metadata: { "openclaw": { "emoji": "🔎", "promptPriority": 90 } }
---

# 网页调研

先澄清问题，再搜证。默认结论优先、证据够用即止。禁止编造来源、数据、引用或“已访问”记录。未实际打开的 URL 不得声称已阅读。

识别意图后按 `references/routing.md` 的三维度规则自动触发：意图、信息时效性、用户要求。不要只搜关键词。触发之后按 `references/stages.md` 做调研三分流：发现 → 归档 → 转写。检索不等于下载。

## 先判断

1. 用户真正要回答什么？范围（时间/地域/对象）是否够写进报告？
2. 缺关键范围且会显著改结论时，先问一句；否则写明默认值后继续。
3. 这是未知网页问题（本技能）还是已有材料精读（`knowledge`）？
4. 垂直金融走 `finance-research`；只要来源分级细节走 `research-core`。

## 工具优先级

`web_search` 和 `web_fetch` **二选一即可**。没有搜索 key 不算整条链路挂了；只要能用 `web_fetch` 读到公开页，就继续调研。禁止因为缺 Brave 去 `exec`+curl 刮搜索页。

| 需要                       | 优先                                               | 回退                                                               |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| 全网检索                   | OpenBot `web_search`（已配置时）                   | 跳过检索，直接 `web_fetch` 官方站 / 文档 / GitHub / 用户给出的 URL |
| URL → 可读正文             | `web_fetch` / `summarize` / `defuddle`             | Jina `https://r.jina.ai/<URL>`                                     |
| 规划检索式 / 校验任务 JSON | `python3 {baseDir}/scripts/run_research.py --plan` | 按 `references/` 手写                                              |
| 综合报告                   | 本会话模型 + 证据矩阵                              | 脚本 `--synthesize`（需模型 API，否则只出骨架）                    |

`run_research.py` 默认 `MOCK_MODE=true`，只用于 `--plan` / `--validate`。mock 结果不是证据，禁止写进 `sources.md` 或当成已访问。

**不要空转：** `web_search` 缺 key 时只记一条限制「未检索，仅阅读已知 URL」，立刻改走 `web_fetch`。连续 2 次公开页 `web_fetch` 都失败才停：写 `report.md`（结论=抓页阻塞、原因、已核实项、未核实项），`<<DELIVERABLE>>` 后结束。禁止再用 `exec` 循环搜索/抓取。

不要另起 FastAPI/本地 8000 演示站。交付写到工作区，不要假装已联网。

## 三分流（先选阶段）

| 阶段 | 默认动作                                                                    |
| ---- | --------------------------------------------------------------------------- |
| 发现 | `web_search` 只写入 `candidates.md`，状态=`unfetched`                       |
| 归档 | 仅对用户点名或清单勾过的 URL 做 `web_fetch` / `defuddle`，写入 `sources.md` |
| 转写 | 工作区已有音视频才交接 `openai-whisper`，并遵守其「不改投」                 |

细则读 `references/stages.md`。搜索命中不得当作已阅读来源。`report.md` 必须单列未核实 / 未归档 / 未转写。

## 工作流

问题澄清 → 研究计划（3–8 个子问题）→ 发现（可选检索）→ 对确认 URL 归档 → 证据抽取 → 主张—证据矩阵 → 必要时再搜或再归档 → 综合 → 引用校验

细则读 `references/workflow.md`。提示词读 `references/prompts.md`。接口约定读 `references/tool-contracts.md`。

每个来源至少记录：`source_id`、title、url、publisher、published_at、accessed_at、摘录、支持的主张、可靠性备注。Schema 见 `references/source_record.schema.json`、`references/claim.schema.json`。

主张状态只用：`verified` / `partially_verified` / `disputed` / `unverified`。主张类型只用：`fact` / `opinion` / `inference` / `uncertainty`。

## 脚本

规划检索式（不联网）：

```bash
python3 {baseDir}/scripts/run_research.py --plan --question "调研问题" --depth standard
```

校验任务 JSON：

```bash
python3 {baseDir}/scripts/run_research.py --validate {baseDir}/references/example_task.json
```

在已配置搜索/抓取 API 时跑流水线（默认 `MOCK_MODE=true`，mock 结果不得当真实证据）：

```bash
MOCK_MODE=false python3 {baseDir}/scripts/run_research.py --question "调研问题" --depth standard --out-dir output/research/<topic-id>
```

环境变量（可选，不设则脚本走 mock 或只输出计划）：`SEARCH_API_URL`、`SEARCH_API_KEY`、`MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`、`MAX_SOURCES`、`REQUEST_TIMEOUT_SECONDS`。

## 必须交付

```text
output/research/<topic-id>/
  report.md
  candidates.md
  sources.md
  claims.json
  archive/run-N/          # 仅当用户要保存原文
```

报告骨架：调研摘要 → 范围与方法 → 核心发现（带来源 ID）→ 分主题 → 冲突与限制 → 结论（含置信与数据截止日）→ 来源表。

用 `<<DELIVERABLE title="调研：主题" type="document" file="output/research/<topic-id>/report.md">>` 声明成果。

搜不到写「暂缺」，不要补齐数字或链接。

## 交接

| 需求                    | 去向               |
| ----------------------- | ------------------ |
| 精读已有 PDF/纪要       | `knowledge`        |
| 证据表/来源分级细节     | `research-core`    |
| 公司/产业战略纵深       | `deep-research`    |
| 股价/财报/金融研究      | `finance-research` |
| 单页去噪提取            | `defuddle`         |
| 只想打开网页/多平台阅读 | `agent-reach`      |
| 写成对外文章            | `content`          |
