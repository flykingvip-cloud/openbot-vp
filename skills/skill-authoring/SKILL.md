---
name: skill-authoring
description: 编写、拆分、演化 OpenBot Agent 技能，或把聊天里的工序固化成可触发 SKILL.md 时使用。遇到「怎么写 SKILL」「三级加载」「metadata.openclaw」「技能演化」务必使用本技能。通用 AgentSkills 卫生以 bundled `skill-creator` 为准，本技能只补 OpenBot 层。
user-invocable: true
---

# 技能编写与演化

技能是可版本化的工序资产。确定性步骤写成 `scripts/`，不要让模型每次重写。不要另起第二套作者规范：结构、命名、打包跟 `skills/skill-creator`。

## OpenBot 必须满足

- 目录名 = `name`，kebab-case，≤64，字母数字连字符
- 必须有 `SKILL.md`
- 可选 `scripts/` `references/` `assets/`。不要 README/CHANGELOG
- Frontmatter 触发只看 `name` + `description`（何时用写进 description）
- OpenBot 额外字段：`user-invocable`、`disable-model-invocation`、`command-dispatch` / `command-tool`、`metadata.openclaw`（`requires.bins/env`、`install` brew/node/go/uv/download）
- 禁止 `name: agent`（撞库 tab）
- 禁止目录名 `openbot-skills`（那是 ClawHub CLI）

初始化与打包：

```
python skills/skill-creator/scripts/init_skill.py <name> --path skills/
python skills/skill-creator/scripts/package_skill.py skills/<name>
```

发布（有 CLI 时）：`clawhub publish ./skills/<name> --slug <name>`。`skills.install` 不会替你拉 registry。

## 加载优先级（低到高，同名覆盖）

plugin/extra < bundled（包内 `skills/`）< managed < `~/.agents/skills` < 项目 `.agents/skills` < **workspace `skills/`**

bundled 可被 `skills.allowBundled` 白名单裁剪。SKILL.md ≤256KB。prompt 约 150 个技能 / 3 万字符。路径逃逸直接 skip。

本套件产品级放仓库 `skills/<name>/`。租户映射、别名表放 workspace，不要 bundled。

## 正文

祈使句。对上真实 `knowledge.*` 名。没有的 RPC 写「没有」，不要 invent。行为与 description 一致，无未声明副作用。接近 500 行就拆 `references/`，并写明何时去读。

知识宇宙技能只编排 Gateway，不改 ingest schema，不碰 S01 memory-workspace，不改 LIVE。

## 演化

同一错误 ≥3 次写入技能。变更可审计。废弃方案进 archive。用 2–3 条真实用户话测触发。
