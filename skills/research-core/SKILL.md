---
name: research-core
description: |
  当用户需要把已有或多源材料综合成可决策证据（证据简报、来源核验、主张—证据表）时务必使用本技能。
  遇到「证据简报」「来源核验」「主张证据表」「文献扫描综合」务必使用。
  明确要联网调研、比较当前价格、最新政策/行业动态、或阅读指定网页时先走 web-research，不要抢路由。
  与 multi-source-fusion / source-lock-and-cite / finance-research 重叠时按 MERGE-PLAN：本技能偏通用调研综合；垂直金融或知识库融合走对应技能。
  不要用于纯战略选项拍板（strategy-core）或伪造引用。
---

# research-core（调研与证据综合）

先澄清问题与决策语境，再广搜、择优、溯源、对照矛盾，最后按「先答问题」结构交付。每条重要主张可追溯来源；禁止伪造引用。本技能吸收并取代 merges 中的 `research-synthesis`。

## 概述

- **调研综合**：围绕用户问题整合多源，而非各自摘要后拼接。
- **行业研究**：结构、参与者、客户、驱动、约束、经济性与近期变化。
- **来源核验**：关键主张追溯一手/权威证据；检查日期、方法与冲突。
- 交付：工作区 Markdown/DOCX + 引用表；可视化再接 visualize/cyber-ppt。

## 前置

1. 澄清研究问题、决策者、时效（数据截止日）、范围、可接受来源类型。
2. 确认是否已有 multi-source-fusion / source-lock-and-cite / finance-research：垂直场景按 MERGE-PLAN。
3. 约定引用风格（链接+标题+日期即可）与是否允许二手综述。
4. 确认输出：简报 / 长报告 / 对比表；是否需要 spreadsheets 数值附表。

## 流程

1. **问题卡**：一句可检验问题 + 子问题 + 非目标。
2. **搜证策略**：先广后深；记录检索式与时间盒。
3. **来源分级**（见 `references/source-quality.md`）：一手/官方 > 权威二手 > 媒体/博客；利益冲突单标。
4. **主张—证据表**（见 `references/claim-evidence.md`）：主张、证据、来源、日期、方法、置信、反证。
5. **矛盾处理**：并列呈现；说明权重差异；禁止静默删除不利来源。
6. **行业透镜**（若适用）：地图结构与经济性，再落到对用户决策的含义。
7. **核验关**：关键数字尽量回一手；不可得全文则降置信并声明。
8. **综合写作**：先答问题 → 关键证据 → 竞争解释 → 局限与缺口 → 对决策的含义。
9. **定稿检查**：关键结论有源；过期已标；推断未伪装成事实。

## 输出

```text
output/research/<topic-id>/
  brief.md
  claim-evidence.md        # 或 .xlsx
  sources.md
  appendix/                 # 长摘录以摘要为主，注意版权
```

简报骨架：直接回答（含置信与截止日）→ 关键发现 → 分歧与不确定 → 局限与**保留缺口** → 含义/下一步调研。

`sources.md` 只收已打开或用户提供的全文。搜索命中进候选，不进来源表。缺口保留披露，禁止用推断补齐后删掉「未核实」。联网抓取走 `web-research` 三分流，不要在本技能里下载媒体。

## 边界

- **做**：通用调研、行业扫描、溯源核验、对比表、证据简报。
- **不做**：伪造引用；超限复制受版权保护全文；把假设写成已证实事实。
- **重叠**：知识库融合 → multi-source-fusion / source-lock-and-cite；金融垂直 → finance-research；战略备忘 → strategy-core。
- **相邻**：正式 Word → documents；PPT → cyber-ppt。
- **警告：** 勿使用 Codex artifact API / `openai.yaml`；交付用工作区文件。

## 触发样例

- 「调研国内竞品定价并给带引用的对比」
- 「行业扫描：参与者、驱动与近期变化」
- 「这条主张的一手来源能核到吗」
- 「一页证据简报，结论先行，附来源表」

## 参考

- `references/claim-evidence.md` — 主张—证据表
- `references/source-quality.md` — 来源分级与时效
- `ATTRIBUTION.md`
