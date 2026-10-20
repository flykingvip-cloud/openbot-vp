---
summary: "CLI reference for `openbot skills` (list/info/check) and skill eligibility"
read_when:
  - You want to see which skills are available and ready to run
  - You want to debug missing binaries/env/config for skills
title: "skills"
---

# `openbot skills`

Inspect skills (bundled + workspace + managed overrides) and see what’s eligible vs missing requirements.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- ClawHub installs: [OpenBot Skills CLI](/tools/skills-cli)

## Commands

```bash
openbot skills list
openbot skills list --eligible
openbot skills info <name>
openbot skills check
```
