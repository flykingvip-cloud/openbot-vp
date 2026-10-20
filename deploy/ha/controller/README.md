# OpenBot Cloud HA — Dual Controller runtime (Stage C)

Implements **P1-DC Dual Controller** from
`OpenBot_Cloud_HA_V2.1.2_CommitSafety_Hardening.md` §12:

- Heartbeat → `ha_controller_instance`
- Claim-first `INSERT … ON CONFLICT DO NOTHING RETURNING` (§12.4.1)
- LOST_CLAIM → **OBSERVING**, **zero side effects**
- Owner lease renew 5s / TTL 20s; `rowcount=0` → **TAKEN_OVER**
- `owner_gen` CAS transitions; takeover when `owner_lease_until < now()`
- State machine covering §12.2 (lab stubs for Fence / CF)
- Crash-recovery plans on start/takeover (§12.6)

Depends on Stage A.1 CommitSafety SQL under `deploy/ha/commitsafety/`
(`ha_controller_instance`, `ha_failover_execution` + INV-ONE index,
`openbot_ha_bump_epoch`).

## Red lines

| Rule                            | Status                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Production Auto Failover        | **NOT APPROVED / OFF**                                                                |
| Default `mode`                  | **`manual`**                                                                          |
| Business tables                 | **Do not gate** (HA tables stay exempt)                                               |
| Cloudflare / cloud fencing APIs | Default **lab** stubs; Stage D adapters under `fence/` (real OFF unless enable flags) |

`python -m controller run-once --mode auto` is refused.

## Layout

```
deploy/ha/controller/
  config.py        controller_id, failure_domain, version, DATABASE_URL, mode
  db.py            psycopg helpers
  claim.py         §12.4.1 Claim
  lease.py         heartbeat, renew, CAS transition, takeover
  adapters.py      RecordingStubAdapter / NullAdapter
  fence/           Stage D Fence/CF adapters (default lab; real OFF)
  recovery.py      §12.6 reconcile plans
  runtime.py       Controller + run_manual_failover() / resume_failover()
                   (adapter_factory restores LabFenceAdapter on takeover)
  __main__.py      CLI
  tests/
    run-ephemeral.sh
    harness.py     DC-01..07
```

## Run two instances across failure domains

Terminal A (failure domain `az-a`):

```bash
export DATABASE_URL='postgresql://openbot_controller@…/openbot'
export HA_CONTROLLER_ID=controller-1
export HA_FAILURE_DOMAIN=az-a
export HA_CONTROLLER_VERSION=stage-c-dev
PYTHONPATH=deploy/ha python -m controller heartbeat
PYTHONPATH=deploy/ha python -m controller run-once   --to-holder node-b --to-db-role openbot_app_b
```

Terminal B (failure domain `az-b`):

```bash
export DATABASE_URL='postgresql://openbot_controller@…/openbot'
export HA_CONTROLLER_ID=controller-2
export HA_FAILURE_DOMAIN=az-b
export HA_CONTROLLER_VERSION=stage-c-dev   # same digest as A
PYTHONPATH=deploy/ha python -m controller heartbeat
PYTHONPATH=deploy/ha python -m controller run-once   --to-holder node-b --to-db-role openbot_app_b
```

Exactly one Claim wins (INV-ONE). The loser stays OBSERVING and must not
change CF / fence. If the winner’s owner lease expires (TTL 20s without renew),
the other instance may `takeover` and resume from §12.6.

Or from this directory:

```bash
PYTHONPATH=. python -m controller run-once   --controller-id controller-1 --failure-domain az-a   --database-url "$DATABASE_URL"   --to-holder node-b --to-db-role openbot_app_b
```

## Local tests (ephemeral PG)

Requires PostgreSQL ≥ 14 (`initdb` / `pg_ctl` on `PATH`, or set `PG_BIN`):

```bash
deploy/ha/controller/tests/run-ephemeral.sh
# or:
PG_BIN=/usr/local/opt/postgresql@14/bin deploy/ha/controller/tests/run-ephemeral.sh
```

Harness cases:

| ID    | Check                                             |
| ----- | ------------------------------------------------- |
| DC-01 | Dual Claim → exactly one live execution (INV-ONE) |
| DC-02 | Loser `side_effect_count = 0`                     |
| DC-03 | Zombie `owner_gen` CAS + bump → fail (OB010)      |
| DC-04 | Takeover after lease expiry; zombie renew blocked |
| DC-05 | Heartbeat upsert                                  |
| DC-06 | Manual winner path → DONE (stubs, skip compute)   |
| DC-07 | §12.6 recovery plan `resume_fence` for CLAIMED    |

## CLI

```bash
PYTHONPATH=deploy/ha python -m controller heartbeat
PYTHONPATH=deploy/ha python -m controller recover
PYTHONPATH=deploy/ha python -m controller run-once   --to-holder node-b --to-db-role openbot_app_b [--observed-epoch N] [--skip-compute]
```

## Stage D Fence / CF adapters

See [`fence/README.md`](fence/README.md). Default `HA_FENCE_BACKEND=lab` keeps
Stage B drills unchanged. `backend=real` requires enable flags + env and still
keeps AWS/CF **live mutate OFF** unless explicitly opted in.

```bash
cd deploy/ha/controller && python -m unittest discover -s fence/tests -v
```

## Out of scope / deferred

- Live Cloudflare pool mutate (`HA_CF_LIVE_MUTATE`) and production tokens
- Live AWS SG/NACL / EC2 stop (`Aws*Client(live=True)`)
- Production-form drills 16–18; Managed PG vendor kill
- App `/internal/fence` **server** (HTTP client + mock shipped)
- Production Auto Failover admission

## Production wiring (compose profile `ha`)

The production pack wires this controller as an **opt-in** sidecar:

- Image: `deploy/ha/controller/Dockerfile`
- Compose service: `openbot-ha-controller` in `deploy/production/docker-compose.prod.yml`
- Profile: **`ha`** — default `docker compose … up -d` does **not** start it
- Entrypoint: `python -m controller heartbeat-loop` (lease heartbeat only)
- Mode: **`manual`** via `HA_CONTROLLER_MODE` (default). `auto` is still refused.
- Env template: `deploy/production/env.production.example` (HA block, commented)

```bash
docker compose -f deploy/production/docker-compose.prod.yml \
  --env-file /path/to/.env --profile ha up -d
```

This is **deploy wiring**, not Production Auto Failover approval. Auto FO stays
**NOT APPROVED / OFF**. Manual `run-once` remains an explicit operator action.
