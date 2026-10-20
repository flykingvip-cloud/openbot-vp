# HA V2.1.2 Stage A.2 — IT-CS-01..13 CommitSafety integration tests

Implements `OpenBot_Cloud_HA_V2.1.2_CommitSafety_Hardening.md` **§19.1**.

**Architecture frozen. Production Auto Failover remains NOT APPROVED / OFF.**

These tests do **not** enable Auto Failover. They only prove the Stage A.1
CommitSafety SQL protocol (gate / bump / lock order / H1 / bypass denials)
against a disposable PostgreSQL, with a logical-decoding oracle for INV-CS.

## Layout

| Path               | Purpose                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `run-ephemeral.sh` | initdb (logical WAL + `track_commit_timestamp`) → apply A.1 migrations → `setup.sql` → `harness.py` → destroy |
| `setup.sql`        | Test-only `cs_probe` (gated), `naive_probe` (ungated), `naive_validate()`, `it_cs_oracle` logical slot        |
| `harness.py`       | IT-CS-01..13 (psycopg, multi-session barriers, oracle)                                                        |
| `requirements.txt` | `psycopg[binary]` (venv created automatically by the runner)                                                  |

No production business tables are gated here. Prefer `cs_probe` / `ha_rpo_probe`
over business authority tables (§15.2 expand).

## Local run (primary acceptance path)

Hosted GitHub Actions for this org may still be dark (`startup_failure`). Run
locally on the Mac (or any host with PostgreSQL ≥ 14 `initdb`):

```bash
# Quick (default fuzz=200 bumps) — used for PR smoke
deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh

# Full §19.1 IT-CS-10 (≥ 10,000 bumps, 64 writers)
HA_CS_IT_FUZZ_BUMPS=10000 HA_CS_IT_FUZZ_WRITERS=64 \
  deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh

# Subset
HA_CS_IT_CASES=IT-CS-01,IT-CS-04,IT-CS-09 \
  deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh

# PG 17 binary
PG_BIN=/usr/lib/postgresql/17/bin deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh
```

Requires: `initdb`/`psql`/`pg_ctl` on `PATH` (or `PG_BIN`), Python 3.10+,
network only for the first `pip install` into `tests/it-cs/.venv`.

CI (when hosted Actions are healthy) installs `postgresql-N` on ubuntu-24.04
and runs the same script (see `.github/workflows/ha-commitsafety-sql.yml` job
`it-cs`). The stock `postgres:N` image has no Python, so do **not** expect the
IT-CS harness to run inside that image without a custom image that also has
Python 3 + venv.

## Case matrix

| Case               | Automated  | Notes                                                                         |
| ------------------ | ---------- | ----------------------------------------------------------------------------- |
| IT-CS-01 RC/RR/SER | Yes        | T_old write → bump → COMMIT fails (OB002 / 40001); row invisible              |
| IT-CS-02           | Yes        | Gate-first; bump blocks; `c(A)≺c(B)`; oracle clean                            |
| IT-CS-03 RC/RR     | Yes        | Bump-first EXCLUSIVE; A waits RowShareLock; then OB002/40001                  |
| IT-CS-04           | Yes        | Naive lock-free validate **commits**; oracle **detects ≥1 INV-CS**            |
| IT-CS-05           | Yes        | RR plain SELECT sees stale N; formal gate → 40001                             |
| IT-CS-06           | Yes        | Missing `expected_epoch` → OB001                                              |
| IT-CS-07           | Yes        | DISABLE TRIGGER / replication_role / TRUNCATE / UPDATE guard / 2PC denied     |
| IT-CS-08           | Yes        | Savepoint gate + ROLLBACK TO → re-gate at COMMIT → OB002                      |
| IT-CS-09           | Yes        | Gate held → bump `lock_timeout` → terminate → retry; `T_old_txn_drain ≤ 8.5s` |
| IT-CS-10           | Yes        | Concurrent fuzz + oracle; default 200 bumps (set 10000 for full §19.1)        |
| IT-CS-11           | Yes        | H1: old role + new epoch → OB003                                              |
| IT-CS-12           | Yes (note) | Gate on vs off P99 delta; target ≤ 2ms (local laptop measured)                |
| IT-CS-13           | Yes        | Dual Claim INV-ONE; epoch +1; zombie `owner_gen` → OB010                      |

## Oracle (§19.1.6)

`test_decoding` slot `it_cs_oracle` consumes commits in LSN order. After each
`writer_epoch_guard` UPDATE the current epoch advances; any subsequent
`cs_probe` / `naive_probe` / `ha_rpo_probe` INSERT with `written_epoch < cur`
is an INV-CS violation. IT-CS-04 **requires** ≥ 1 violation; all other cases
require 0.

## Env knobs

| Var                     | Default | Meaning                                     |
| ----------------------- | ------- | ------------------------------------------- |
| `HA_CS_IT_FUZZ_BUMPS`   | 200     | IT-CS-10 bump count (≥10000 for full §19.1) |
| `HA_CS_IT_FUZZ_WRITERS` | 16      | Concurrent writers (64 for full)            |
| `HA_CS_IT_PERF_SAMPLES` | 400     | IT-CS-12 samples per arm                    |
| `HA_CS_IT_CASES`        | (all)   | Comma filter, e.g. `IT-CS-01,IT-CS-04`      |
| `HA_CS_IT_PORT`         | random  | Ephemeral listen port                       |
| `PG_BIN`                | (PATH)  | PostgreSQL binary dir                       |

## Out of scope (later stages)

Drills 16–19, Controller runtime dual-instance deployment, Cloudflare / Network
Fence orchestration, app-side `expected_epoch` wiring, gating business authority
tables.
