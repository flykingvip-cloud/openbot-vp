---
name: data-analysis-core
description: >-
  当用户需要清洗、分析或解释业务数据（表结构探查、KPI/方差、趋势、决策向分析报告）时务必使用本技能。
  遇到「分析这张表」「数据清洗」「KPI 复盘」「方差分析」「趋势解读」「分析路由」务必使用。
  与 spreadsheets 分工：本技能是分析路由与洞察交付；spreadsheets 是制作/编辑可审计表格文件。
  需要新建或精修 .xlsx 版式与公式时移交 spreadsheets；需要图表叙事时可接 visualize / cyber-ppt。
  不要把未核验的脏数据直接当结论，也不要编造缺失指标。
---

# data-analysis-core（数据分析路由）

先探查结构与口径，再清洗与度量，最后把「观察到的结果」与「假说」分开写清。可编辑工作簿承载结构化分析；图仅在比表更清晰时使用。

## 概述

- **表分析**：结构、公式、单位、日期范围、粒度（grain）先于指标计算。
- **数据清洗**：保留原始输入、记录变换、查重/缺数、校验行数。
- **KPI 分析**：定义指标、基线、对比期、分部落与驱动因素后再解释变动。
- 与 `spreadsheets`：文件制作/公式/样式 → spreadsheets；分析问题路由与解读 → 本技能（可调用 spreadsheets 产出中间簿）。

## 前置

1. 确认决策问题、受众、对比期、成功/告警阈值（若有）。
2. 拿到原始文件路径；确认可否写工作区副本（默认：不覆写用户原件）。
3. 标明单位、币种、时区、财年口径；未知则显式「未知」并降低置信。
4. 约定输出：分析简报 md、清洗后 xlsx、KPI 表、可选图表说明。

## 流程

1. **问题卡**：要回答的问题、非目标、可用数据、截止时效。
2. **结构探查**：表/列/类型/主键候选；抽样异常；公式错误与循环引用。
3. **口径冻结**：每个 KPI 写定义、分子分母、筛选、grain、对比基线。
4. **清洗**（见 `references/cleaning-checklist.md`）：
   - 复制 raw → staging → mart；变换写在变更日志。
   - 缺数/重复/越界进 quarantine，禁止静默填 0 冒充。
   - 核对行数与合计勾稽。
5. **分析**：
   - 描述：水平、趋势、构成、异常点。
   - 驱动：按段落/因子拆解；区分相关性与因果措辞。
   - 方差：实际 vs 预算/同期/目标；标重大项。
6. **诚信层**：观察结果 vs 假说分栏；披露排除项、假设、数据质量限制。
7. **交付路由**：结构化结果 → spreadsheets；叙事报告 → documents；管理层 PPT → cyber-ppt；单图探索 → visualize（若已装）。

## 输出

```text
output/data-analysis/<analysis-id>/
  question.md
  cleaning-log.md
  workbook.xlsx           # staging/mart；或指出由 spreadsheets 生成
  kpi-definitions.md
  findings.md             # 决策向
  quarantine.csv          # 可选
```

`findings.md` 顺序：直接回答 → 关键数字（含口径）→ 驱动与方差 → 局限 → 建议的下一步（数据或业务）。

## 边界

- **做**：探查、清洗设计、KPI 定义、方差/趋势解读、分析简报。
- **不做**：编造缺失序列；把清洗猜测写成事实；替代 spreadsheets 做复杂版式精修主交付。
- **相邻**：表格文件工艺 → spreadsheets；预算/管线业务框 → business-finance-core；调研证据 → research-core。
- **警告：** 勿使用 Codex artifact API / `openai.yaml`；交付用工作区文件。勿在技能正文写凭证。

## 触发样例

- 「这张销售表明细有脏数据，清洗并解释上月下滑」
- 「定义并复盘这三个 KPI，相对预算的方差」
- 「先别改原表，给我分析路由和结论简报」
- 「趋势是否成立？口径和排除项写清楚」

## 参考

- `references/cleaning-checklist.md` — 清洗与勾稽
- `references/kpi-definition.md` — 指标口径卡
- `ATTRIBUTION.md`
