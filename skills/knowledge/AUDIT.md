# 源码审计：Knowledge

审计对象：`lijigang/ljg-skills` → `skills/`
仓库：https://github.com/lijigang/ljg-skills
审计日期：2026-09-15
本地快照：`/tmp/enterprise-skills-audit/ljg-skills`（shallow clone，`master`/org-mode）
目标企业技能：`skills/knowledge/`
许可证：MIT，Copyright (c) 2026 lijigang

## 1. 项目结构

仓库根不是技能根。`skills/` 下 22 个 Skill，另有 `scripts/` 安装辅助。双分支：`master`=org-mode，`md`=Markdown。

知识处理相关：`ljg-paper`、`ljg-book`、`ljg-read`、`ljg-qa`、`ljg-learn`、`ljg-is`、`ljg-think`、`ljg-structure`、`ljg-plain`、`ljg-rank`、`ljg-constraint`。

明确越界（本次不吸收进 knowledge）：`ljg-writes`（写作）、`ljg-card`/`ljg-classic`/`ljg-present`（视觉交付）、`ljg-invest`、`ljg-relationship`、`ljg-roundtable`、`ljg-teach`、`ljg-word`、`ljg-blind`、`ljg-push`。

## 2. SKILL.md

每个子技能一份完整 SKILL.md，普遍 80–300 行，外加 `ReadingGuide.md` / `Workflows/` / `references/`。触发词细、互斥声明清楚（`NOT FOR`）。

## 3. References

高质量：`ljg-paper` 的 `paper-map`、`ljg-book` 的 `coverage-map`、`ljg-qa` 的问题设计、`ljg-structure` 的结构卡。共同模式：材料地图与正文分离，检查者不看作者草稿。

## 4. Scripts

`ljg-paper`：`validate_note.ts`（Org 结构 + paper-map）。`ljg-card`：Playwright 截图。`ljg-qa`：向 `localhost:31337` 发语音通知。企业不采用这些运行时绑定。

## 5. Templates

Org/Denote 模板：`~/Context/` 或 `~/Documents/notes/`，文件名 `{timestamp}--{kind}-{title}__tag.org`。属个人笔记系统，删除。

## 6. Assets

长图/漫画/白板合同在 `ljg-card`，与知识理解无关。

## 7–10. 依赖 / 平台

- 外部：Playwright、Emacs/`org-lint`、微信读书（`ljg-blind`）
- API：无强制云 API；URL 用 WebFetch
- 平台：Codex + `bunx skills add`；org-mode 生态
- 个人路径与 localhost 通知

## 11–13. License / 第三方 / 风格

MIT，可改编。大量作者美学：八维哲学解剖、追本之箭、「失重感」、ASCII 禁 Unicode、 grok/十二岁读者。这些是个人风格，不是企业工序。

## 14. 重复功能

22 个技能大量重叠：paper/book/read/qa/is/plain 都在「把材料讲清楚」。用户要求合成 **一个** Knowledge Skill。

与 OpenBot：`summarize` 是 CLI 摘录；`knowledge-gardener` 是知识库治理。本技能处理「用户已给材料的理解」，不写库、不替代 CLI。

## 15. 可删除功能

org-mode/Denote/Emacs、八维解剖、追本文学化、语音通知、铸卡/古文长图、投资/关系/圆桌/教学/单词、写作引擎。

## 16. 核心工作流

读材料 → 判断模式（摘要/结构/解释/对比/质疑）→ 抽观点与证据 → 标逻辑与反例 → 统一八段输出。

## 17. 核心 Prompt

「先理解，再压缩。摘要不能代替理解。」案例必须映射原作角色与关系。材料不足不补现场。

## 18. 核心判断规则

- 事实 / 作者观点 / 解释 分离
- 贡献要具体，评测差异 ≠ 因果
- Challenge：假设、证据缺口、逻辑跳跃、反例、未答问题、偏差
- 独立复述检查：读者说不出问题或贡献，就重读原文

## 19. 核心输出结构

统一八段：一句话结论、核心观点、结构、关键证据、重要概念、逻辑关系、反例/问题、可迁移启示。

## 20. 测试方法

- 同一短文分别跑 summarize / explain / challenge，challenge 必须多出假设与反例
- 无原文时不得编造实验细节
- 触发：论文 PDF、拆书、讲清楚、对比、挑刺
- `quick_validate.py`

## 能力拆分

| 类       | 内容                                                  |
| -------- | ----------------------------------------------------- |
| A 方法论 | 理解先于摘要；结构/机制/边界                          |
| B 工作流 | summarize / structure / explain / compare / challenge |
| C Prompt | 八段统一输出；挑战清单                                |
| D 规则   | 不补现场；证据与观点分离；独立复述                    |
| E–H      | Org/Emacs、哲学八刀、视觉铸卡、写作与人生技能         |

只保留 A+B+C+D。

## 保留 / 修改 / 删除 / 禁止采用

**保留**

- 「讲清做了什么 / 为何要修正原有认识 / 能否自己解释」
- Q 切要害、A 带边界
- 结构 ≠ 主题；反例与改口条件
- 材料地图与成品分离的检查思想（改成轻量清单，不搬 Org 验证器）

**修改**

- 22 合 1，自然语言触发，不强制记 `/ljg-*`
- 输出 Markdown，不写 `~/Context`
- Challenge 提升为一等模式

**删除**

- org-mode、Denote、Emacs、localhost notify
- 八维/追本文学、铸卡、个人笔记路径

**禁止采用**

- 整技能复制
- 把 Emacs/Org 写成企业默认
- `ljg-writes` 进入 knowledge（写作归 `content`）
