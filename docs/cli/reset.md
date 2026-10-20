---
summary: "CLI reference for `openbot reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `openbot reset`

Reset local config/state (keeps the CLI installed).

```bash
openbot backup create
openbot reset
openbot reset --dry-run
openbot reset --scope config+creds+sessions --yes --non-interactive
```

Run `openbot backup create` first if you want a restorable snapshot before removing local state.
