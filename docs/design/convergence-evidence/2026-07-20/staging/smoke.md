# Staging smoke

**Target:** local sim `http://127.0.0.1:18799` · image `openbot:rc-convergence-20260720` · SHA `9aceda7349…`  
**Captured:** 2026-07-20T12:42Z UTC

## Matrix

| #   | Check                              | Expect                          | Result                                                                                                                                                                                  |
| --- | ---------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /healthz`                     | 200                             | **PASS** `{"ok":true,"status":"live"}`                                                                                                                                                  |
| 2   | `GET /readyz`                      | 200 or only `failing:["wecom"]` | **PASS** `{"ready":true}` (no failing set)                                                                                                                                              |
| 3   | Login / platform auth reachability | success or documented block     | **PASS (handler)** `POST /__openbot/platform-auth/login` → HTTP 404 JSON `PLATFORM_AUTH_DISABLED` (token-mode local sim; smoke script accepts JSON handler). Control UI config **200**. |
| 4   | `chat.history` sample              | non-5xx                         | **PASS (capability)** tip WT vitest `chat.history-d3.test.ts` **2/2** (no live session token for WS RPC in minimal sim)                                                                 |
| 5   | localFolder K1/K2                  | success or config gap           | **PASS (capability)** tip WT `local-folder-import.golden-path.test.ts` **6/6** (K1–K6)                                                                                                  |
| 6   | Rollback notes                     | documented                      | **PASS** — see `rollback.md`                                                                                                                                                            |

## Scripted local smoke

```text
deploy/production/proxy/smoke.sh --local-only --gateway http://127.0.0.1:18799
Summary: PASS=4 FAIL=0 (local-only)
```

## Control UI config (excerpt)

`GET /__openbot/control-ui-config.json` → 200  
`serverVersion`: `2026.7.12-rc.2` · `authMode`: `token` · `dataSpace.mode`: `local`

## Gaps (not FAIL for STAGING_ENV=MISSING path)

- No live browser login against `admin.staging.*`
- No authenticated gateway WS `chat.history` against sim (token available; RPC client not wired this wave)
- Image is `linux/amd64` on arm64 Docker Desktop (qemu); healthy but not native arm64
