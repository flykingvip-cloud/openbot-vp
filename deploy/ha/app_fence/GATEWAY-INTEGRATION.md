# Production gateway integration (E1 follow-up note)

**Status:** documentation only in E1. Reference server: `deploy/ha/app_fence/`.
**Auto Failover:** OFF / NOT APPROVED.

OpenBot HTTP gateway lives at:

- `src/gateway/server-http.ts` — probe map `/health` `/healthz` `/ready` `/readyz`
- `src/gateway/server/health-state.ts` — health broadcast helpers
- `src/gateway/control-ui-routing.ts` — root probe path set

## Recommended production shape

1. **Keep** Controller → `HA_APP_FENCE_URL=https://<node>:8443/internal/fence` with mTLS
   (`HA_APP_MTLS_*`), matching `HttpAppFenceClient`.
2. **Either:**
   - **A (sidecar):** run `python -m app_fence` beside the node (or under systemd) on an
     internal port; reverse-proxy mTLS to it; CF/L1 probes still hit gateway `/healthz`
     **or** the sidecar `/healthz` if that is the Origin probe target.
   - **B (in-process):** port `AppFenceState` semantics into a small TS module and register
     a request stage **before** Control UI SPA catch-all in `createGatewayHttpServer`
     request pipeline (~`requestStages` in `server-http.ts`).

## In-process hook sketch (B — do not land blindly)

```ts
// New: src/gateway/ha-app-fence.ts (future PR)
// - in-memory role: PRIMARY_WRITER | FENCED
// - Map<idempotencyKey, receipt>
// - handleHaAppFenceHttpRequest(req, res): boolean
// - isHaAppFenced(): boolean

// server-http.ts — insert early stage:
// { name: "ha-app-fence", run: () => handleHaAppFenceHttpRequest(req, res) }

// handleGatewayProbeRequest — when path is /healthz|/health:
// if (isHaAppFenced()) { statusCode = 503; body = { ok:false, status:"fenced", role:"FENCED" }; ... }
```

Contract to preserve (must stay aligned with Python client + this reference server):

| Item        | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| Path        | `POST /internal/fence`                                                      |
| Idempotency | `X-Idempotency-Key` + body `idempotency_key` (`{execution_id}:FENCING_APP`) |
| Success     | `{ acked:true, role:"FENCED", healthz:503, ... }`                           |
| Health      | FENCED → `/healthz` **503**                                                 |

## E1 acceptance without gateway code change

- Reference server unit tests green
- `HttpAppFenceClient` against local server → `acked=true`; replay → `replay=true`
- `/healthz` → 503 after fence
- Stage B drills + Stage C DC + Stage D fence unit still green on default `lab`
