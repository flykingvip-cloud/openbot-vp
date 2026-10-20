---
name: spreadsheets
description: >-
  当用户需要创建、编辑、分析或核验独立电子表格（.xlsx/.csv/.tsv）时务必使用本技能。
  强调公式可审计、类型正确、渲染抽查。与 data-analysis-core 分工：本技能=制作/编辑可审计表格；分析问题路由与洞察简报走 data-analysis-core。
  不要用于操控本机 Excel 桌面会话的实时控制。
---

# spreadsheets

OpenBot 化表格技能。优先 **openpyxl**（或用户环境已有的等价库）编写本地 `.xlsx`；分析可用 pandas。**警告：** 勿捆绑或调用 Codex `@oai/artifact-tool` 专有 API 树；以 openpyxl 写工作区文件。

## 何时用

- 新建模型、登记表、仪表摘要、CSV→XLSX（**文件工艺**；KPI 解读主路径见 data-analysis-core）
- 改已有簿：加列/公式/校验，保持既有风格
- 只读问答：先读再答，不擅自覆写

## 工作流

1. 弄清受众、决策、输入、计算、输出、检查。
2. 能一页说清就不要拆太多表；按读者工作流排 tab。
3. 原始数据与假设分区；计算用公式驱动，便于改输入即更新。
4. 数字/百分比/日期存类型化值，不用预格式化字符串冒充。
5. 导出 xlsx 后抽查关键区域与公式错误；必要时截图/渲染核视觉。
6. 只交最终工作簿。

## 公式原则

- 简单可读、可追溯；复杂计算拆辅助单元格。
- 跨表引用加引号：`='Sheet Name'!A1`。
- 勿用 IFERROR 把异常吞成假零；缺数显式处理。
- 编辑时匹配既有公式惯例；无关既有错误先报告再问是否修。

## 样式摘要

见 `references/style.md`、`workflows/create.md`、`workflows/edit.md`。

## 依赖

```bash
uv pip install openpyxl pandas
```

## 参考

- `references/style.md`
- `references/formulas-and-checks.md`
- `workflows/create.md`
- `workflows/edit.md`
- `references/openbot-delivery.md`
- `ATTRIBUTION.md`
