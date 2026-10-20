# HA V2.1.2 E1 — App Fence reference server

Minimal **node-side** `POST /internal/fence` that matches Controller client
`deploy/ha/controller/fence/app_fence.py` (`HttpAppFenceClient`).

| Red line                         | Status                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| Production Auto Failover         | **OFF / NOT APPROVED** — this PR is **not** Auto FO admission |
| Default Controller fence backend | Remains **`lab`**                                             |
| Secrets in git                   | **Forbidden** — tokens/certs via env only                     |
| Live AWS / CF mutate             | **Out of scope** (E2)                                         |
| Prod-form drills 16–18           | **Out of scope** (E3)                                         |

## Why a reference server (not only TS gateway)?

OpenBot gateway (`src/gateway/server-http.ts`) already exposes `/healthz` / `/readyz`,
but has **no HA role / FENCED state**. E1 ships a stdlib Python reference server under
`deploy/ha/app_fence/` so Controller lab/staging can exercise App Fence end-to-end
**without** changing production gateway defaults. Production wiring notes:
[`GATEWAY-INTEGRATION.md`](./GATEWAY-INTEGRATION.md).

## Endpoints

| Method       | Path                    | Behaviour                                                                              |
| ------------ | ----------------------- | -------------------------------------------------------------------------------------- |
| `POST`       | `/internal/fence`       | Fence node → role `FENCED`; idempotent on `X-Idempotency-Key` / body `idempotency_key` |
| `GET`/`HEAD` | `/healthz` (`/health`)  | **200** live; **503** when `FENCED`                                                    |
| `GET`/`HEAD` | `/readyz` (`/ready`)    | **200** ready; **503** when `FENCED`                                                   |
| `POST`       | `/internal/fence/reset` | Lab failback only; requires `HA_APP_FENCE_ALLOW_RESET=1`                               |

### Request (matches client)

```json
{
  "execution_id": "<uuid>",
  "from_holder": "node-a",
  "to_holder": "node-b",
  "owner_gen": 1,
  "to_epoch": 3,
  "action": "fence",
  "idempotency_key": "<execution_id>:FENCING_APP"
}
```

Header: `X-Idempotency-Key: <same as body.idempotency_key>` (required unless body key alone is set; if both set they must match).

### Success response

```json
{
  "acked": true,
  "role": "FENCED",
  "healthz": 503,
  "execution_id": "...",
  "from_holder": "...",
  "to_holder": "...",
  "owner_gen": 1,
  "to_epoch": 3,
  "idempotency_key": "...:FENCING_APP",
  "node_id": "node-local",
  "replay": false
}
```

Replay of the same key returns the same receipt with `"replay": true` (no second side effect).

## Run (lab)

```bash
# From repo root — package lives at deploy/ha/app_fence
PYTHONPATH=deploy/ha python -m app_fence --host 127.0.0.1 --port 8443 --node-id node-a

# Point Controller client at it
export HA_APP_FENCE_URL=http://127.0.0.1:8443/internal/fence
# Optional shared token (lab):
# export HA_APP_FENCE_TOKEN=...
# Client today does not send the token — use mTLS or proxy auth in staging/prod.
```

### TLS / mTLS knobs

```bash
# HTTPS only (server cert):
python -m app_fence --tls-cert /path/server.crt --tls-key /path/server.key

# mTLS (require client cert) — preferred for production Controller→node channel:
python -m app_fence --tls-cert ... --tls-key ... --tls-ca /path/client-ca.crt
# Client: HA_APP_MTLS_CERT / HA_APP_MTLS_KEY / HA_APP_MTLS_CA
```

**Production recommendation:** terminate mTLS at the node reverse-proxy / TS gateway and
forward to this process (or the native gateway handler once wired). Do not commit PEMs.

## Auth

| Mode                                 | Behaviour                                                     |
| ------------------------------------ | ------------------------------------------------------------- |
| `HA_APP_FENCE_TOKEN` unset (default) | Allow (plain lab HTTP)                                        |
| `HA_APP_FENCE_TOKEN` set             | Require `Authorization: Bearer <token>` or `X-HA-Fence-Token` |
| mTLS (`--tls-ca`)                    | Require client certificate                                    |

## Tests

```bash
bash deploy/ha/app_fence/tests/run-unit.sh

# Regression (default lab backend — Auto FO still OFF)
cd deploy/ha/controller && python -m unittest discover -s fence/tests -v
PG_BIN=/usr/local/opt/postgresql@14/bin bash deploy/ha/drills/tests/run-ephemeral.sh
PG_BIN=/usr/local/opt/postgresql@14/bin bash deploy/ha/controller/tests/run-ephemeral.sh
```

## Env cheat-sheet (never commit values)

```bash
export HA_APP_FENCE_HOST=127.0.0.1
export HA_APP_FENCE_PORT=8443
export HA_APP_FENCE_NODE_ID=node-a
export HA_APP_FENCE_TOKEN=           # optional lab shared token
export HA_APP_FENCE_ALLOW_RESET=0    # lab failback only when 1
export HA_APP_FENCE_TLS_CERT=
export HA_APP_FENCE_TLS_KEY=
export HA_APP_FENCE_TLS_CA=
export HA_APP_FENCE_VERBOSE=0
# Controller side (Stage D):
export HA_APP_FENCE_URL=http://127.0.0.1:8443/internal/fence
export HA_CONTROLLER_MODE=manual
export HA_FENCE_BACKEND=lab
```
