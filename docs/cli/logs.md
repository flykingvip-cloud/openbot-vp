---
summary: "CLI reference for `openbot logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `openbot logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
openbot logs
openbot logs --follow
openbot logs --json
openbot logs --limit 500
openbot logs --local-time
openbot logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
