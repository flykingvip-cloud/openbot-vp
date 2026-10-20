# Dashboard / data storytelling 路由（office-core presentation-visual）

**不单独入库 `presentation-visual-core`**（与 cyber-ppt + visualize 重叠）。本文件提供路由：

| 用户意图                             | 权威路径                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 咨询风/高密度可编辑 PPTX             | **cyber-ppt**（本技能）                                                                                                  |
| 薄入口「做个 ppt」                   | `pptx` → 立刻改走 cyber-ppt                                                                                              |
| 仪表板指标/刷新/筛选定义             | 先定决策、指标、owner、刷新、数据质量信号；视觉落地：管理汇报页用 cyber-ppt；交互探索若已装 **visualize** 则走 visualize |
| 数据叙事（最小图说清对比/序列/因果） | 标签、单位、期间、来源显式；避免装饰图与误导轴；终稿在 PPT 内则 cyber-ppt 质检；单图探索可用 visualize                   |

## 仪表板设计前必问

1. 要支持什么决策？谁看？
2. 指标口径与刷新频率？
3. 筛选维度与默认视图？
4. 数据质量/延迟如何展示？

## 叙事原则

- 一页一个主信息；图只在比表更清晰时用。
- 渲染后检查裁切、重叠、可读性与跨页一致（见 pack-layout-qa / 既有 QA）。

合并进 live 时保留本 reference；勿另起 presentation-visual-core 目录。
