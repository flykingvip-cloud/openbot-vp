---
read_when:
  - 你想查看哪些 Skills 可用并准备好运行
  - 你想调试 Skills 缺少的二进制文件/环境变量/配置
summary: "`openbot skills` 的 CLI 参考（列出/信息/检查）和 skill 资格"
title: skills
x-i18n:
  generated_at: "2026-02-03T07:45:14Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 7878442c88a27ec8033f3125c319e9a6a85a1c497a404a06112ad45185c261b0
  source_path: cli/skills.md
  workflow: 15
---

# `openbot skills`

检查 Skills（内置 + 工作区 + 托管覆盖）并查看哪些符合条件，哪些缺少要求。

相关内容：

- Skills 系统：[Skills](/tools/skills)
- Skills 配置：[Skills 配置](/tools/skills-config)
- 本地安装与同步：[OpenBot 技能库 CLI](/tools/skills-cli)

## 命令

```bash
openbot skills list
openbot skills list --eligible
openbot skills info <name>
openbot skills check
```
