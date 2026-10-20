# Staging-direct env (Grok executed under owner authorization)

| Field         | Value                                                          |
| ------------- | -------------------------------------------------------------- |
| Executor      | grok-evolution-closure (direct, no Cursor)                     |
| Authorization | Owner session:「授权给你，你直接执行」2026-07-20               |
| Mode          | **Local Docker sim** — no remote staging host was provided     |
| Production    | **NOT touched** (no SSH to 8.217.93.71; no openbot-gateway-rc) |

## Endpoints

| Field     | Value                     |
| --------- | ------------------------- |
| URL       | `http://127.0.0.1:18799`  |
| Container | `openbot-staging-rc0-sim` |
| Bind      | host loopback only        |
