# 源码审计：Design

审计对象：`pbakaus/impeccable`
仓库：https://github.com/pbakaus/impeccable
文档：https://impeccable.style
审计日期：2026-09-15
仓库体量约 371MB，未做完整 clone；已审 `skill/SKILL.src.md`、`skill/reference/audit.md`、reference 目录清单、LICENSE
目标企业技能：`skills/design/`

## 1. 项目结构

完整产品：Rust/JS 引擎、多 Agent 适配目录（`.claude` / `.cursor` / `.codex` …）、`skill/`、`cli/`、`tests/`、`browser-bundle`、hooks。企业只要「规则 + 审查 + 可执行整改」，不要整个 harness。

```
skill/
├── SKILL.src.md          # 编译前主技能
├── agents/               # 各 Agent 适配
├── reference/            # 20+ 命令 playbook
└── scripts/              # impeccable CLI / detector
```

## 2. SKILL.md

`SKILL.src.md` 是路由层：Setup（跑 `impeccable context`）、Modes（Persuade/Operate/Read/Experience）、Commands 表（20+）。默认「award-winning design director」、go all out。

## 3. References

高价值：`audit.md`（可测量技术检查 + P0–P3）、`critique.md`（启发式评审）、`polish.md`、`adapt.md`、`hooks.md`。低价值（本次删除）：`overdrive`/`delight`/`bolder`/`quieter`/`live`/`generate` 及大量 Enhance 命令。

`audit.md` 五维：A11y、Performance、Theming、Responsive、Implementation Integrity；健康分 /20；P0=阻断任务，P1=发布前，P2=下次，P3=打磨。

## 4. Scripts

自包含 `impeccable` binary / detector / hooks。企业禁止 vendoring 该二进制。吸收「能规则检测的不要丢给 LLM」的思想，自写轻量 HTML 扫描脚本。

## 5–6. Templates / Assets

`PRODUCT.md` / `DESIGN.md` 作为项目设计真源。思想可保留为「先读已有设计约定」，不强制生成 Impeccable 文件格式。

## 7–10. 依赖

Node 可选（launcher 号称无 Node）。浏览器 live 迭代、native iOS/Android 分支。平台绑定极深：Cursor/Claude 插件、hooks 改项目。

## 11. License

Apache 2.0。Copyright 2025 Paul Bakaus。改编须：保留 NOTICE/版权、标明修改、附 Apache 2.0 文本（ATTRIBUTION 指向即可，不复制引擎）。

## 12–13. 第三方与风格

「out-of-distribution craft」「dream big and bold」是作者审美，不是企业验收标准。企业默认：可用性与一致性优先，视觉夸张可选。

## 14. 重复功能

20+ 命令大量重叠（layout/typeset/colorize/polish）。OpenBot 无对等 design skill；`visualize` 是图表不是 UI 审查。

## 15. 可删除功能

live/generate 浏览器变体、overdrive/delight、native 全套、doctor/pin/hooks CLI、PRODUCT.md 强制初始化、完整 detector binary。

## 16. 核心工作流

发现问题 → 分级 → 提出修改 → 执行修改 → 再检测。命令收敛为 `audit | critique | improve | polish`。

## 17. 核心 Prompt

先确定性扫描，再 LLM 判断视觉层级与文案。Audit 只报不改；Improve 按 P0→P3 改；再 Audit 验证。

## 18. 核心判断规则

P0 可用性/功能；P1 明显 UX/WCAG AA；P2 一般视觉；P3 可选。检查：Layout、Typography、Spacing、Color、Contrast、Responsive、A11y、Interaction、Hierarchy、Consistency。

确定性优先：touch target、标题层级、对比度线索、过宽内容、重复色、间距离散、overflow、缺 breakpoint。

## 19. 核心输出结构

问题清单（级别/位置/类别/影响/改法）→ 修改方案 → 复检 delta。

## 20. 测试方法

- 对含小按钮、跳级标题、无 `@media` 的 HTML fixture 跑 `design_audit.py`，应出 P0/P1
- 修后再跑，对应项消失
- 不把审美偏好标成 P0
- `quick_validate.py`

## 能力拆分

| 类       | 内容                                                 |
| -------- | ---------------------------------------------------- |
| A 方法论 | 规则检测 + 分级审查 + 整改闭环                       |
| B 工作流 | audit → improve → re-audit                           |
| C Prompt | 先硬规则后 LLM；P0–P3                                |
| D 规则   | 十类检查 + 确定性清单                                |
| E–H      | impeccable CLI、20+ 命令、live、作者审美、多平台插件 |

只保留 A+B+C+D。

## 保留 / 修改 / 删除 / 禁止采用

**保留**

- 确定性检测思想
- P0–P3 与「audit 不改、improve 才改、再 audit」
- 可测量项：a11y、响应式、touch、语义标题

**修改**

- 命令收到 4 个
- 自写脚本，不依赖 `npx impeccable`
- 语气改为企业产品设计审查，非获奖导演

**删除**

- live/generate/overdrive/delight/bolder/quieter
- hooks 自动改仓库、doctor/pin
- native 全套 playbook

**禁止采用**

- 整份 SKILL.src.md / detector binary / 插件目录
- 把 Impeccable 商标当企业技能名
- 未经 NOTICE 的大段原文粘贴
