# Readyz capture

**URL:** `http://127.0.0.1:18799/readyz`  
**When:** 2026-07-20T12:42:24Z / 12:42:56Z UTC  
**Image:** `openbot:rc-convergence-20260720` @ tip `9aceda7349…`

## Response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```

```json
{ "ready": true }
```

## Assessment

| Rule                    | Observation                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Allowed failing set     | ⊆ `{wecom}` or empty                                                                                     |
| Actual failing          | **none** (ready true)                                                                                    |
| Expand failure surface? | **No**                                                                                                   |
| wecom waiver            | Not exercised in local token sim (channels not loaded as prod); prod waiver still expires **2026-08-20** |

## Companion healthz

```json
{ "ok": true, "status": "live" }
```

HTTP 200.
