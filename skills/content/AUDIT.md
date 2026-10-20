# 源码审计：Content

审计对象：`alchaincyf/huashu-skills` 内容生产子集
仓库：https://github.com/alchaincyf/huashu-skills
审计日期：2026-09-15
GitHub API：52 个 skill 量级；仓库 `license` 字段为 **null**
目标企业技能：`skills/content/`

审阅过的原文：`huashu-research`、`huashu-proofreading`、`huashu-info-search`、`huashu-article-edit`、`huashu-topic-gen`（raw）。其余按 README/目录只做能力边界判断。

## 1. 项目结构

根目录每个花叔技能一份文件夹 + `skills.json` + `assets/`。内容相关且用户点名：

| 目录                            | 原职责             | 企业去向                           |
| ------------------------------- | ------------------ | ---------------------------------- |
| huashu-research                 | 调研增量落盘       | 思想吸收；执行交接 `deep-research` |
| huashu-info-search              | 多渠道搜索+知识库  | 同上，不重建搜索引擎               |
| huashu-topic-gen                | 3–4 个选题+大纲    | 角度/大纲留在 content              |
| huashu-article-edit             | 确认范围后增量改稿 | 留 Edit 关                         |
| huashu-proofreading             | 三遍审校+去 AI 味  | 留 Edit / AI 味，去「花生风」      |
| huashu-data-pro                 | 数据处理           | 删除（非内容生产核心）             |
| huashu-slides                   | 幻灯片             | 交接 `cyber-ppt` / `pptx`          |
| huashu-wechat-image / xhs-image | 平台配图           | 删除或交接视觉技能                 |
| huashu-material-search          | 素材搜索           | 交接 `content-ops`                 |

另有人物视角技能、口播/视频技能：全部禁止纳入 content。

## 2. SKILL.md

单技能较短（约 80–200 行），但集合膨胀。共同页脚：「花叔出品 / 30 万粉 / 小猫补光灯」。

## 3–6. References / Scripts / Templates / Assets

调研与写作分离、先建文件再搜索、阶段摘要，是可保留的工序思想。素材库指向作者本机：`/Users/alchain/Documents/写作/`、即刻 CSV。不可入库。

## 7–10. 依赖

无统一开源 LICENSE。绑定个人知识库路径、公众号工作流、GPTZero 等检测工具（可选）。平台：Claude Code 写作工作室。

## 11. License

**仓库无 SPDX 许可证。** 禁止复制原文、页脚、案例标题、个人素材路径。只允许思想级重写。

## 12–13. 第三方与风格

「花生风格」：实践导向、口语、敢下判断、个人经历。成功案例绑定作者文章。人物模仿技能是明确红线。

## 14. 重复功能

research/info-search 重叠；topic-gen 与 content-ops 选题重叠。OpenBot 已有 `wechat-article`（发布）、`research-core`、`summarize`。

## 15. 可删除功能

人物模仿、花生口吻、检测率 30% 指标、个人素材库、平台配图/PPT、花叔品牌页脚、把调研重做成第二套 deep-research。

## 16. 核心工作流

Brief → Research（可交接）→ Angle → Outline → Draft → Fact Check → Edit → Final。

## 17. 核心 Prompt

先确认 brief 与角度，再写。事实/观点/推测/案例/引用必须分栏。不为流畅补造事实。

## 18. 核心判断规则

- 调研与写作分离（原 research skill 的正确边界）
- 先列修改项再动手（article-edit）
- AI 味：套话、机械首先其次、虚假权威、低信息密度
- 企业中性：不模仿任何作者

## 19. 核心输出结构

大纲 + 分标类型的正文 + 事实检查表 + 审校记录。不默认公众号 HTML。

## 20. 测试方法

- 给定带错误数字的 brief，Fact Check 必须标「无法验证」而非改圆
- AI 味稿应改掉「首先其次最后 / 综上所述」
- 未要平台稿时不产出小红书/PPT
- `quick_validate.py`

## 能力拆分

| 类       | 内容                                                 |
| -------- | ---------------------------------------------------- |
| A 方法论 | 研究与表达分离；事实分层                             |
| B 工作流 | Brief→…→Final                                        |
| C Prompt | 中性企业语气；事实检查 + AI 味检查                   |
| D 规则   | 不补造；先确认再改                                   |
| E–H      | 花生风、人物 skill、配图/PPT、个人路径、无许可证原文 |

只保留 A+B+C+D。

## 保留 / 修改 / 删除 / 禁止采用

**保留**

- 调研/写作分离、增量落盘思想
- 选题给多角度并等待选择
- 三遍审校里「内容 / 腔调 / 节奏」分层（重写清单）
- 先确认编辑范围

**修改**

- 合成单一 `content`
- Fact Check 升为一等关，独立于「降 AI 味」
- 语气改为企业中性

**删除**

- 人物视角、花生素材库、检测率 KPI、平台图片技能

**禁止采用**

- 无许可证原文 verbatim
- 作者品牌页脚与个人绝对路径
- 为降 AI 检测而编造个人经历
