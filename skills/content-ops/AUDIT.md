# 源码审计：Content Ops

审计对象：`kangarooking/kangarooking-skills`
仓库：https://github.com/kangarooking/kangarooking-skills
审计日期：2026-09-15
GitHub `license` 字段为 null；README 声明原创默认 MIT，第三方以各目录 NOTICE 为准
目标企业技能：`skills/content-ops/`

审阅：README、`viral-topic/SKILL.md`、`viral-title/SKILL.md`、`ai-article-daily/SKILL.md`。其余按目录做保留/删除判断。

## 1. 项目结构

约 16 个互不兼容的个人工作流。用户点名：

| 目录                       | 原职责                | 企业去向                         |
| -------------------------- | --------------------- | -------------------------------- |
| viral-topic                | 跨平台爆款选题路由    | 收敛为 trend/topic               |
| viral-title                | 30 标题池 + 平台适配  | 收敛为 topic 的标题子步          |
| ai-article-daily           | 热点→公众号日更全链路 | 拆开：热点归 ops，写作归 content |
| twitter-monitor            | X 抓取+飞书表         | 删除平台绑定；思想留「源监控」   |
| video-downloader           | 多平台下载+ASR        | 素材收集思想；不内置下载器       |
| book-illustration-workflow | 书稿配图+飞书         | 删除                             |
| multi-agent-image          | 多 Agent 生图         | 删除（视觉生产）                 |
| task-harness               | 长任务拆解            | 删除（Agent 工程，非内容运营）   |

## 2. SKILL.md

质量分化：`viral-topic`/`viral-title` 有清晰路由与护栏；`ai-article-daily` 绑死「AI 公众号博主」、本机路径、固定文风 URL、2500 字、禁止 Markdown。

## 3–6. References / Scripts / Templates / Assets

`viral-title` 的公式库、feedback 脚本、eval JSON 是完整子系统，企业只留「标题不得改写事实」+ 少量公式，不搬 30 标题强制与标题库 JSON。`viral-topic` 子技能按平台拆分，token 过重。

## 7–10. 依赖

各平台 API/cookies、飞书、APIMart、混元 3D、本机 CSS：`/Users/kangarooking/...`。MCP 未统一。平台：Claude/Codex + 个人工作室。

## 11. License

README 称 MIT，根目录未见 LICENSE 文件。改编须在 ATTRIBUTION 记录；不复制其标题库、文风范文、本机路径。第三方技能（混元、scroll-world）禁止纳入。

## 12–13. 第三方与风格

袋鼠 IP、真人头像封面、拾景纸刊、人生重塑：个人品牌。`ai-article-daily` 第一人称口语 + 指定历史文章，禁止作为企业默认。

## 14. 重复功能

日更流程覆盖了 content 的 Brief→Draft。选题/标题与 huashu-topic-gen 重叠。OpenBot 已有各平台 marketing skills、`wechat-article`。

## 15. 可删除功能

下载器、飞书同步、生图/3D/动效站、书稿插图、task-harness、人生技能、30 标题强制、本机 workspace 路径。

## 16. 核心工作流

trend → topic → source → **repurpose** → planning。同一事实源，多种表达。

## 17. 核心 Prompt

「同一事实源 → 多种表达。禁止为平台改事实。每条衍生能回溯到 Source of Truth。」

## 18. 核心判断规则

- 平台证据不合并成一个分数（viral-topic 护栏）
- 标题不编造数字/结果（viral-title）
- 不整篇复制爆款
- 写作长文交接 `content`；深度未知问题交接 `deep-research`

## 19. 核心输出结构

选题表 + 源材料索引 + 多平台衍生包 + 回溯表 + 内容日历。

## 20. 测试方法

- 一篇带 3 条硬事实的报告，衍生公众号/X/脚本后，事实不得变
- `source_trace` 脚本：衍生稿中的数字/专名必须能在源文件命中
- 未提供源材料时不得「为了完整」补造热点数据
- `quick_validate.py`

## 能力拆分

| 类       | 内容                                          |
| -------- | --------------------------------------------- |
| A 方法论 | Source of Truth + 多平台再表达                |
| B 工作流 | trend / topic / source / repurpose / planning |
| C Prompt | 不改事实；保留 URL 与时间窗                   |
| D 规则   | 平台证据分离；禁整篇抄袭                      |
| E–H      | 下载/飞书/生图、日更写作、个人 IP、本机路径   |

只保留 A+B+C+D。

## 保留 / 修改 / 删除 / 禁止采用

**保留**

- 跨平台选题时保留原始证据列
- 标题服务事实，不发明结果
- 再分发 / 日历思想
- 「先选题确认再扩写」的人工关（扩写交 content）

**修改**

- 合成单一 `content-ops`，REPURPOSE 为一等能力
- 默认输出 5–8 个标题而非 30
- 去个人工作室路径

**删除**

- 视频下载实现、飞书、生图链路、task-harness、日更全文写作

**禁止采用**

- 作者本机绝对路径与指定范文 URL 作为默认文风
- 整份标题库 JSON
- 无 LICENSE 文件时的大段原文粘贴
- 为平台传播改写事实
