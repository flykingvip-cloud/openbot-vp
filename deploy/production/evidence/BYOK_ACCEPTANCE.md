# BYOK acceptance evidence (provenance close-out)

Date: 2026-07-26

## Provenance / SHA alignment

| Item                     | Value                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Freeze tag               | `provenance/sha-225de96b270f` → `225de96b270f` (BYOK runtime + v119 UI)                                        |
| Live tip tag             | `provenance/sha-5b5fcfb1af40` → `5b5fcfb1af40` (P1 BYOK agent RPC close tip)                                   |
| Live image               | `localhost/openbot:rc-amd64-provenance-3624c454fefd`                                                           |
| Live `build-info.commit` | `3624c454fefdc3e075e4dc2c095ea5cb74b0c217`                                                                     |
| Prior gap                | v118/v119 declared `e7e8e6d` + dirty BYOK fixes — closed by tagged freeze + provenance rebuilds (**not v120**) |

BYOK runtime fixes (`7b0957c9e5` … `518cdb6b45` …) **are ancestors of** `225de96b270f`. Follow-up commits on the same SoT branch wire `agent` RPC to honor `sessions.patch` model + resolve `ent/*` before the embedded runner.

## Status — **PASS** (P1 cloud BYOK closed)

| Layer                                                         | Result                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Code on tagged freeze                                         | **PASS** — `provenance/sha-225de96b270f`                                                       |
| SecretRef → env-file materialize                              | **PASS** — `materialize-byok-canary-env.sh` (key never in chat/SSH argv/evidence)              |
| Canary scripts                                                | **PASS** — `--env-file` injection; `agent.wait` for terminal status                            |
| Full cloud E2E (staging :18790)                               | **PASS** — create→probe→register→grant→agent→Credits Δ=0→budget cap=0 block→restart persist    |
| Credits disk A/B (no platform debit)                          | **PASS** — Δ=0                                                                                 |
| Budget block (cap=0)                                          | **PASS** — `EnterpriseModelError: enterprise model monthly budget exceeded (spend=0¢, cap=0¢)` |
| Persist after restart                                         | **PASS**                                                                                       |
| Audit trail (create/probe/register/grant/invoke/budget-block) | **PASS** — `auditHints` all present; no key leakage                                            |
| Evidence redaction                                            | **PASS** — no `BYOK_API_KEY=` / long `sk-` in evidence files                                   |

## Green evidence (host paths; no secrets)

| Artifact               | Path                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| Staging canary summary | `/var/lib/openbot-staging/evidence/BYOK_CANARY_20260726T084459.md`        |
| Repo copy              | `deploy/production/evidence/BYOK_CANARY_LATEST.md`                        |
| JSON result            | `/var/lib/openbot-staging/evidence/byok-canary-full-20260726T084459.json` |
| Restart log            | `/var/lib/openbot-staging/evidence/byok-restart-20260726T084459.log`      |

Observed ids (non-secret): `connectionId=f139df0b-…`, `runtimeModelId=ent/20107f4cdd/deepseek-v4-flash`, `tenant=001`.

## Canary operator path (no key in shell history of laptop)

```bash
# On gateway host only:
bash deploy/production/scripts/materialize-byok-canary-env.sh
export OPENBOT_GATEWAY_CONTAINER=openbot-gateway-staging
export OPENBOT_STATE_DIR=/var/lib/openbot-staging/state
export OPENBOT_ENV_FILE=/var/lib/openbot-staging/staging.env
export BYOK_EVIDENCE_DIR=/var/lib/openbot-staging/evidence
export BYOK_GATEWAY_URL=ws://127.0.0.1:18790
export BYOK_HEALTH_PORT=18790
export BYOK_ENV_FILE=/root/.openbot-canary-secrets/byok.env
export BYOK_CLEANUP=0
bash deploy/production/scripts/byok-canary.sh
```

## Live methods observed

- `enterprise-model-provider.{list,create,update,test,rotate-credential,disable,delete}`
- `enterprise-model-catalog.{list,discover,register,update,enable,disable}`
- `enterprise-model-grant.{list,grant,grantBatch,revoke}`
- `agent` + `agent.wait` (terminal lifecycle)
- `sessions.patch` / `sessions.get` (pin `ent/*`)
