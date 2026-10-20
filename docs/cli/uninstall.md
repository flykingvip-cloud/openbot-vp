---
summary: "CLI reference for `openbot uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "uninstall"
---

# `openbot uninstall`

Uninstall the gateway service + local data (CLI remains).

```bash
openbot backup create
openbot uninstall
openbot uninstall --all --yes
openbot uninstall --dry-run
```

Run `openbot backup create` first if you want a restorable snapshot before removing state or workspaces.
