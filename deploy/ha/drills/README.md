# OpenBot Cloud HA — Stage B lab drills (16L–19L)

Lab-form drills exercising the Dual Controller failover path with measurable
evidence (INV-CS oracle, `T_old_txn_drain`, RPO ledger, dual-controller
takeover). Depends on Stage A.1 CommitSafety SQL + Stage C Dual Controller.

## Red lines

| Rule                                         | Status                      |
| -------------------------------------------- | --------------------------- |
| Production Auto Failover                     | **OFF / NOT APPROVED**      |
| Default controller `mode`                    | **`manual`**                |
| Business tables                              | **Do not gate**             |
| Cloudflare / cloud fencing credentials       | **Not enabled** (lab stubs) |
| Real Network Fence (SG/NACL)                 | **Stage D**                 |
| Managed PG vendor failover RPO (Lost=0 sync) | **Stage D**                 |

This package is the **lab form** of drills 16–19 from
`OpenBot_Cloud_HA_V2.1.2_CommitSafety_Hardening.md` §19.2.
Production-form counterparts (real Network Fence, real CF, Managed PG kill)
are explicitly deferred to **Stage D**.

## Layout

```
deploy/ha/drills/
  README.md
  requirements.txt
  lab_adapters.py    LabFenceAdapter (Network/CF=lab; terminate/VERIFY=real SQL)
  injectors.py       pause-before-gate / pause-before-commit / long writers
  inv_cs_oracle.py   logical-decoding INV-CS auditor
  rpo_ledger.py      external ACK ledger + Lost@W100/W1000
  report.py          §19.4 markdown/json
  tests/
    run-ephemeral.sh
    setup.sql
    harness.py       DRILL-16L .. 19L
```

## LabFenceAdapter

| Step                                             | Lab behaviour                                             |
| ------------------------------------------------ | --------------------------------------------------------- |
| FENCING_APP / NETWORK / COMPUTE / CF / PROMOTING | Receipt stubs only                                        |
| DRAIN_WAIT                                       | Sleep `T_wait` only if `app_fence_acked` (else 0; §3.5.1) |
| TERMINATING_OLD_SESSIONS                         | Real `openbot_ha_terminate_holder_sessions`               |
| VERIFYING                                        | Real `holder_sessions=0` + `pg_prepared_xacts` empty      |

## Run (ephemeral PG)

```bash
deploy/ha/drills/tests/run-ephemeral.sh
# or:
PG_BIN=/usr/local/opt/postgresql@14/bin deploy/ha/drills/tests/run-ephemeral.sh
```

Requires PostgreSQL ≥ 14 with `initdb` / `pg_ctl` (`wal_level=logical` for the
INV-CS oracle). Hosted CI may be dark — local ephemeral evidence is the
acceptance path for this stage.

## Drill criteria (lab)

| ID      | Check                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **16L** | Ephemeral FO + lab Network; ≥100 pause-before-gate + ≥100 pause-before-commit; **INV-CS violations = 0**. Production-form real Network Fence → Stage D.     |
| **17L** | Long write txns on old node; order wait→Network(lab)→Compute(skip/lab)→terminate→release→epoch++; **`T_old_txn_drain ≤ 8.5s`**; new writer writes same row. |
| **18L** | `ha_rpo_probe` + external ACK ledger; **lab-partial** primary fault (clearly labeled); fill §19.3 metrics; Managed PG vendor FO → Stage D.                  |
| **19L** | C1 domain kill → C2 completes FO alone; winner dies mid-run → loser takeover after lease expiry finishes; zombie resume → **no DB writes / epoch change**.  |

## Out of scope (Stage D)

- Real Cloudflare pool / Origin API credentials
- Real SG/NACL Network Fence + Compute stop
- Managed PG vendor-forced primary kill with sync-replication Lost=0 proof
- Production Auto Failover admission
