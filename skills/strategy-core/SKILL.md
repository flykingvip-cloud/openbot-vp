---
name: strategy-core
description: >-
  当用户需要战略选择、情景规划或竞争分析（SWOT/PESTEL、方案对比、决策备忘录、不确定下建议）时务必使用本技能。
  遇到「战略评审」「SWOT」「PESTEL」「方案对比」「决策备忘录」「情景分析」「竞品战略」「优先级取舍」务必使用。
  与 product-manager 等垂直技能重叠时按 MERGE-PLAN：本技能偏通用战略框；销售/供应链/产品细节走既有技能。
  不要用于纯证据收集（research-core）或日常项目周报（productivity-core）。
---

# strategy-core（战略分析与决策备忘）

先框定决策，再选框架与情景；只用能改进决策的工具。产出决策向备忘：情境、证据、选项、权衡、建议、风险、下一步。禁止编造市场数据或把假设当事实。本技能吸收并取代 merges 中的 `strategic-analysis`。

## 概述

- **战略分析**：现状、关键力量、可行选项与权衡。
- **情景规划**：只变动会改变决策的少数不确定因素，并定义可观测信号。
- **竞争分析**：客户、产品、经济性、渠道、能力与可防御性对比。
- 外部事实可先交 research-core 补证再回流；量化模型用 spreadsheets。

## 前置

1. 确认决策者、截止时点、成功标准、硬约束、已知假设。
2. 盘点证据包；缺口大则先走 research-core 或声明「基于假设的情景」。
3. 列出可行选项（含「维持现状」）；淘汰明显不可行项并写原因。
4. 与垂直技能划界：通用决策框用本技能；产品路线细节移交对应技能。

## 流程

1. **决策框**（见 `references/decision-frame.md`）：问题、决策者、时界、成功标准、约束、假设、非目标。
2. **证据分层**：sourced 事实 / 估计 / 解读；关键事实尽量有源或标「用户提供」。
3. **选框架**：SWOT、PESTEL、选项×准则矩阵等，只用能改变选择的；禁止堆砌。
4. **选项对比**（见 `references/options-matrix.md`）：影响、成本、时机、可逆性、依赖、风险。
5. **情景**（不确定高时）：变量、触发信号、各情景最优选项与监测指标。
6. **竞争透镜**（若相关）：相对替代方案的客户价值与经济性，勿只列功能清单。
7. **建议**：明确推荐 + 备选；写清在何种信号下切换。
8. **风险与下一步**：owner 与缓解；3–7 天可执行动作（可交 productivity-core 落计划）。
9. **诚信检查**：无数据不编造；假设置顶；缺口对信心的影响写清。

## 输出

```text
output/strategy/<decision-id>/
  decision-memo.md
  options-matrix.md       # 或 .xlsx
  assumptions.md
  scenarios.md            # 可选
  competitive-lens.md     # 可选
```

决策备忘顺序：情境与问题 → 关键证据（含缺口）→ 选项与权衡 → 建议与条件 → 风险与监测 → 下一步。

## 边界

- **做**：决策框、框架选用、选项对比、情景、竞争透镜、决策备忘。
- **不做**：编造市场规模/增速；把假设写成事实；替代项目执行跟踪。
- **相邻**：补证据 → research-core；落执行 → productivity-core；例行刷新 → office-automation-core；正式 PPT → cyber-ppt。
- **警告：** 勿使用 Codex artifact 协议 / `openai.yaml`；交付用工作区文件。未经授权勿外发。

## 触发样例

- 「做一份进入新市场的决策备忘录」
- 「三个方案按影响/成本/可逆性对比并给建议」
- 「SWOT + 情景：若监管收紧我们怎么切」
- 「竞品战略对比：经济性与可防御性写清楚」

## 参考

- `references/decision-frame.md` — 决策框字段
- `references/options-matrix.md` — 选项对比列
- `ATTRIBUTION.md`
