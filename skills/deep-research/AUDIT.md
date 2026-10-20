# 源码审计：Deep Research

审计对象：`KKKKhazix/khazix-skills` → `hv-analysis/`
仓库：https://github.com/KKKKhazix/khazix-skills
焦点路径：https://github.com/KKKKhazix/khazix-skills/tree/main/hv-analysis
审计日期：2026-09-15
本地快照：`/tmp/enterprise-skills-audit/khazix-skills`（shallow clone）
目标企业技能：`skills/deep-research/`

## 1. 项目结构

仓库含 6 个独立 Skill：`leader`、`storage-analyzer`、`aihot`、`neat-freak`、`hv-analysis`、`khazix-writer`。本次只审 `hv-analysis/`。

```
hv-analysis/
├── SKILL.md                 # 核心流程 + 文风 + PDF 交付
├── references/schema.json   # 横纵分析数据骨架
└── scripts/md_to_pdf.py     # WeasyPrint Markdown→PDF
```

## 2. SKILL.md

约 320 行。Frontmatter 触发覆盖「深度研究 / 竞品分析 / 帮我了解」。正文规定：必须联网、子 Agent 三分工、纵轴 6k–15k 字、横轴 3k–10k 字、交汇 1.5k–3k 字、全文 1–3 万字、最终 PDF。

## 3. References

`references/schema.json`：纵轴（起源/时间线/阶段/路径依赖/叙事线索）+ 横轴（画像/竞品/矩阵/格局）+ 交汇（历史塑造位置、优劣势根源、三剧本）。这是最有长期价值的结构化资产。

## 4. Scripts

`scripts/md_to_pdf.py`：WeasyPrint + 内置 CSS 封面/页眉页脚。绑定作者默认「数字生命卡兹克」。企业交付不依赖 PDF。

## 5. Templates

无独立 templates 目录。报告结构写死在 SKILL.md：封面 → 目录 → 一句话定义 → 纵向 → 横向 → 交汇 → 来源。

## 6. Assets

无。

## 7. 外部依赖

Python：`weasyprint`、`markdown`。系统字体 fallback：`Droid Sans Fallback`。

## 8. API 依赖

建议调用 arXiv `export.arxiv.org/api/query`。无强制付费 API。

## 9. MCP / 工具依赖

绑定 Claude Code 工具名：`WebSearch`、`WebFetch`、子 Agent。硬编码路径 `/mnt/.claude/skills/web-access/SKILL.md`。

## 10. 平台依赖

Claude Code / Codex / AgentSkills 兼容声明。PDF 与 WeasyPrint 偏桌面本地。

## 11. License

MIT。Copyright (c) 2026 数字生命卡兹克。可改编，须保留版权与许可声明。

## 12. 第三方内容

方法论自称融合索绪尔历时-共时、社会科学纵/横截面、商学院案例、竞争战略。属思想融合，非代码抄袭。arXiv API 为公共接口。

## 13. 个人风格化内容

- 「卡兹克文风」：节奏、回环、文化升维、「我觉得」姿态
- 默认作者署名卡兹克
- 禁止部分公众号口吻，但仍要求「作品感」而非咨询简报
- 质检要求「有节奏感、有可读性」

## 14. 重复功能

与仓库内 `khazix-writer` 文风重叠。与 OpenBot `research-core`（证据综合、来源分级）高度重叠；本技能多出「双轴交汇判断」与超长叙事。

## 15. 可删除功能

万字默认、PDF/WeasyPrint、卡兹克文风、人物研究默认项、子 Agent 平台绑定、web-access 硬路径、文化升维、固定字数质检。

## 16. 核心工作流

问题定义 → 范围 → 联网搜证 → 来源分级 → 纵向时间线 → 横向格局 → 交汇判断 → 来源清单。

## 17. 核心 Prompt

「纵向追时间深度，横向追同期广度，最终交汇出判断。」先事实后判断，搜不到标「暂缺」，不编造。

## 18. 核心判断规则

- 一手 > 二手；防循环印证
- 竞品场景 A/B/C（无/少/多）
- 信息充分性自检：故事完整、竞品不漏、关键事实有源
- 交汇必须产出新判断，禁止缩写复述

## 19. 核心输出结构

一句话定义 + 时间线 + 竞争格局 + 交汇洞察 + 来源。原项目默认 1–3 万字。企业默认改为「结论优先、证据够用即止」。

## 20. 测试方法

- 用同一公司名跑两轮，检查来源是否可点开、事实/判断是否分离
- 禁止项：无来源市场规模、把推测写成事实
- 用户未要求详细时，输出应远低于万字
- `quick_validate.py` 校验 frontmatter

## 能力拆分

| 类       | 内容                                                        |
| -------- | ----------------------------------------------------------- |
| A 方法论 | 双轴：历时深度 × 共时广度 → 交汇判断                        |
| B 工作流 | 定义问题 → 搜证 → 纵轴 → 横轴 → 变量/反例 → 判断 → 不确定性 |
| C Prompt | 先事实后判断；暂缺显式标注                                  |
| D 规则   | 来源分级、证据强度、反例、不确定性质检                      |
| E 工具   | WeasyPrint PDF、arXiv curl、Claude 子 Agent                 |
| F 平台   | Claude Code 工具名与路径                                    |
| G 风格   | 卡兹克叙事文风、文化升维                                    |
| H 非核心 | 万字报告、PDF 封面、人物研究、写作技巧大段                  |

企业只保留 A+B+C+D。

## 保留 / 修改 / 删除 / 禁止采用

**保留**

- 双轴方法论与 `schema.json` 中的变量骨架（重写为 references，不整文件复制）
- 来源优先级、充分性自检、交汇必须有新判断
- 「搜不到标暂缺、不编造」

**修改**

- 默认篇幅改为结论优先
- 输出改为工作区 Markdown，不默认 PDF
- 工具改为 OpenBot 通用搜索/读取，不绑 Claude 子 Agent
- 与 `research-core` 分工：本技能管未知问题的横纵判断，证据表可交接 `research-core`

**删除**

- 1–3 万字强制区间
- PDF 脚本与卡兹克署名
- 文风、文化升维、作品化质检
- `/mnt/.claude/skills/web-access` 绑定

**禁止采用**

- 整份 SKILL.md / 文风段 verbatim
- 把原作者口吻写成企业默认
- 无来源市场规模或编造引用
