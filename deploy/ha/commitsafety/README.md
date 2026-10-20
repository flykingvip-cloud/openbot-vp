# OpenBot Cloud HA V2.1.2 — Stage A.1: CommitSafety SQL / Migration

Database-level CommitSafety artifacts from
`OpenBot_Cloud_HA_V2.1.2_CommitSafety_Hardening.md` §10, §11, §15.2, §20 P0-CS-2
and **Appendix A**. This is **Stage A.1 only**.

- Architecture is **frozen**. This package does not change the HA topology.
- **Production Auto Failover stays NOT approved and OFF.** Nothing here enables it.
- Stage A.2 (this tree under `tests/it-cs/`): IT-CS-01..13 integration suite.
- Still out of scope: drills 16–19, the dual-Controller runtime, Cloudflare /
  fencing orchestration, and app-side `expected_epoch` wiring.

## Layout

| Path                                                                       | What it is                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/001_roles.sql`                                                 | A.1 roles `openbot_ha_owner` / `openbot_controller` / `openbot_app_a` / `openbot_app_b`, privilege sanity check, steady-state timeouts (`transaction_timeout` only on PG >= 17)                                                             |
| `migrations/002_ha_tables.sql`                                             | A.2 `writer_epoch_guard`, `writer_lease`, `writer_lease_audit`, `ha_controller_instance`, `ha_failover_execution` (+ INV-ONE partial unique index), `ha_gate_exempt`, `ha_rpo_probe`; ownership + grants; guard monotonic (+1 only) trigger |
| `migrations/003_commit_gate.sql`                                           | A.3 `openbot_ha_commit_gate()`: ROW SHARE lock, then RC / RR-SERIALIZABLE (`FOR SHARE`) read branches, `<>` epoch check, H1 role binding; `SECURITY DEFINER` with `search_path = pg_catalog, pg_temp`                                       |
| `migrations/004_gate_triggers_and_probe.sql`                               | A.4 `openbot_ha_epoch_gate_trg()`, the `openbot_ha_attach_epoch_gate(regclass)` helper, `written_epoch` stamping, **`written_epoch` immutability**, gate on `ha_rpo_probe`                                                                  |
| `migrations/005_bump_epoch_and_renew.sql`                                  | A.5 `openbot_ha_bump_epoch()` (the only epoch++ path, Controller only) and `openbot_ha_renew()`                                                                                                                                             |
| `migrations/006_old_session_terminate.sql`                                 | A.6 `openbot_ha_terminate_holder_sessions()` (audited) and the read-only `openbot_ha_holder_sessions()` used for drain polling and VERIFY confirmation                                                                                      |
| `checks/gate_coverage.sql`                                                 | A.6 CI coverage check. **Fails** when an authoritative table has no valid gate, or an HA-exempt table has one                                                                                                                               |
| `checks/verify_helpers.sql`                                                | Read-only report: 2PC off, guard vs lease, role settings, owner memberships, function hardening, instance parameters                                                                                                                        |
| `templates/attach_epoch_gate.sql`                                          | Template for new authoritative tables                                                                                                                                                                                                       |
| `scripts/apply.sh`                                                         | Applies `migrations/*.sql` in order, one transaction per file                                                                                                                                                                               |
| `scripts/check-coverage.sh`                                                | Wrapper around `checks/gate_coverage.sql` (CI / pre-merge)                                                                                                                                                                                  |
| `scripts/smoke.sh`, `scripts/smoke-ephemeral.sh`                           | Smoke checks on a throwaway cluster. This is not the IT-CS suite                                                                                                                                                                            |
| `tests/it-cs/`                                                             | **Stage A.2** IT-CS-01..13 (§19.1): race / lock-order / naive oracle /                                                                                                                                                                      |
| isolation / bypass / fuzz / perf / dual-Claim. See `tests/it-cs/README.md` |

The repo has no migration runner yet (vault-sync's `schema.sql` is loaded by its
own store and is unrelated), so this package is self-contained and versioned by
file prefix. Every file is **expand-only and idempotent**: re-running it is safe.
Nothing is dropped or renamed.

## ⚠️ Failover ≠ `transaction_timeout` (mandatory operator rule)

> **Failover MUST NOT wait for `transaction_timeout`.**
> `transaction_timeout` (30s, PG >= 17), `statement_timeout` (15s),
> `idle_in_transaction_session_timeout` (10s) and `lock_timeout` (3s) on
> `openbot_app_*` only **protect steady state**. They do not drive failover.

The failover drain path (§9.2, §11.4) is:

1. **App Fence**: best effort, 5–15s. It does not block escalation.
2. **Drain window**: only if the App Fence is confirmed. Lasts at most `T_wait` = **5s**.
   Poll `openbot_ha_holder_sessions(holder)`.
3. **Network Fence**: cut the old Primary off from PG. Required for unplanned failover.
   (**Compute Fence** only if the Network VERIFY fails, the drain times out, or sessions reappear.)
4. **Terminate old sessions**: `openbot_ha_terminate_holder_sessions(holder, role, 2000, execution_id)`.
   This must run _after_ the Network Fence, or the old node just reconnects.
5. **Confirm**: `openbot_ha_holder_sessions(...)` must stay at 0 for `T_confirm` (1–2s),
   with no old-session locks and `pg_prepared_xacts` empty. Then `state = 'VERIFIED'`.
6. **epoch++**: `openbot_ha_bump_epoch()` with `SET LOCAL lock_timeout = '5s'`
   (the function refuses to run without a `lock_timeout`, error OB012).

中文要点：**Failover 绝不等待 `transaction_timeout`**。它只用于常态保护。切换顺序固定为
App Fence → 排空窗口（≤5s）→ Network Fence →（必要时 Compute Fence）→ 终止旧会话 →
确认（旧会话 = 0、无 prepared xact）→ VERIFIED → epoch++。

## How the protocol is enforced (and why it is not SELECT-then-hope)

- Every write to an authoritative table fires the `DEFERRABLE INITIALLY DEFERRED`
  constraint trigger `openbot_epoch_gate` **at COMMIT**. That trigger calls
  `openbot_ha_commit_gate()`.
- The gate first takes `LOCK writer_epoch_guard IN ROW SHARE MODE`, which is held until
  the transaction ends. Only **then** does it read the epoch, in a new statement under RC,
  or with `SELECT … FOR SHARE` under RR / SERIALIZABLE (a stale snapshot raises
  `40001`). It compares with `<>`.
- `openbot_ha_bump_epoch()` takes `EXCLUSIVE` on the same table, which conflicts with
  ROW SHARE. So any commit either finishes before the bump or sees the new epoch and
  fails (§10.7).
- Error codes: `OB001` means `expected_epoch` is missing or malformed (a defect, fail-closed).
  `OB002` means the epoch is stale. `OB003` means the role is not the epoch holder (H1).
  `40001` means an RR snapshot is older than the bump. For `OB002`, `OB003` and `40001` the
  node has lost write ownership and must self-fence (HTTP 503 / WS `not_writer`).
- Bump errors: `OB010` (not owner / not VERIFIED / target mismatch), `OB011` (CAS failed),
  `OB012` (no `lock_timeout`). `OB013` means the guard can only move by +1.
  `OB020` means `written_epoch` is immutable.

### Hardenings beyond the Appendix A reference

| #      | Hardening                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| H-A1-1 | `written_epoch` is immutable. A `BEFORE UPDATE` trigger raises `OB020` for every role, owners included. Business roles also have no UPDATE/DELETE/TRUNCATE on `ha_rpo_probe`                                                                                                                                                                              | The split-brain audit (§14.2) and the RPO drill (§19.3) depend on it                                                |
| H-A1-2 | **No trusted `openbot.gate_passed` fast path.** Appendix A.3 returns early when that GUC is `on`, but any session can `set_config` it and skip the lock and the epoch check. The gate now re-checks on every row. The lock is already held, so this is a local lock-table hit plus a one-row primary-key read. The GUC is still set, for information only | Removes a gate bypass. The smoke test (T08) shows a forged flag is rejected. IT-CS-12 (Stage A.2) measures the cost |
| H-A1-3 | `search_path = pg_catalog, pg_temp` on every HA function, with every object schema-qualified                                                                                                                                                                                                                                                              | Prevents search_path hijacking of the `SECURITY DEFINER` functions                                                  |
| H-A1-4 | Bump requires a non-zero `lock_timeout` (`OB012`), requires `p_to_holder` to match the execution row (§12.5), validates `to_db_role`, and bounds the TTL                                                                                                                                                                                                  | While EXCLUSIVE is queued, all commits queue behind it, so an unbounded wait would freeze writes                    |
| H-A1-5 | The `ha_guard_monotonic` trigger only lets the epoch move by exactly +1, even for the owner                                                                                                                                                                                                                                                               | Defence in depth for INV-MONO and the "no manual UPDATE" rule (§13.2)                                               |
| H-A1-6 | The coverage check also requires AFTER ROW INSERT+UPDATE+DELETE and the real trigger function                                                                                                                                                                                                                                                             | A same-named no-op or non-deferred trigger does not count as coverage                                               |
| H-A1-7 | Terminate writes an audit row per session to `writer_lease_audit` (§11.5 P0). It only ever matches `openbot_app_*`. `holder_id` must match `^[a-z0-9-]+$`                                                                                                                                                                                                 | Evidence, plus no way to inject LIKE patterns                                                                       |

## Privileges and roles

| Role                              | Gets                                                                                                                                                                                     | Never gets                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `openbot_ha_owner` (NOLOGIN)      | Owns HA tables and functions. Member of `pg_signal_backend` and `pg_read_all_stats` (granted by vendor mechanism if 001 warns). `USAGE, CREATE` on `public` (needed for `ALTER … OWNER`) | LOGIN                                                              |
| `openbot_controller`              | `SELECT, INSERT, UPDATE` on `ha_failover_execution`, `ha_controller_instance`. `SELECT` on guard / lease / audit. `INSERT` on audit. EXECUTE on bump / terminate / holder_sessions       | Any business-table write. Direct UPDATE of guard or lease          |
| `openbot_app_a` / `openbot_app_b` | `SELECT` on guard and lease. EXECUTE on gate and renew. `SELECT, INSERT` on `ha_rpo_probe`. Business-table DML granted by the business migrations                                        | Table ownership, TRUNCATE, bump / terminate, SUPERUSER / BYPASSRLS |
| migration role (yours)            | Member of `openbot_ha_owner` (001 grants itself `SET` + `INHERIT` on PG >= 16). Owns business tables                                                                                     | Use by the application                                             |

Ops / audit accounts that write authoritative tables must get
`EXECUTE ON FUNCTION openbot_ha_commit_gate()` explicitly. They are gated too.

Instance requirement (§8.1 / §10.6 #4): **`max_prepared_transactions = 0`**. Set it
through the vendor parameter group and confirm with `checks/verify_helpers.sql`.

## Apply on Managed PostgreSQL

Requirements: PG >= 14 (PG >= 17 recommended). Run as the migration role, which is the
database owner with `CREATEROLE`. Credentials go through env / `~/.pgpass` / IAM.
Never commit them.

```bash
export DATABASE_URL='postgresql://<migrator>@<host>:5432/<db>?sslmode=require'
deploy/ha/commitsafety/scripts/apply.sh                       # 001..006, one txn each
psql "$DATABASE_URL" -X -f deploy/ha/commitsafety/checks/verify_helpers.sql
deploy/ha/commitsafety/scripts/check-coverage.sh --report-only # see "Rollout order"
```

If 001 prints `WARNING: could not GRANT pg_signal_backend / pg_read_all_stats`,
grant them to `openbot_ha_owner` through the vendor's mechanism (console or admin role)
**before** any failover drill. Without them, terminate and drain evidence do not work.

Set LOGIN credentials for `openbot_controller` / `openbot_app_a` / `openbot_app_b` through
the secret manager. In app connections, set `application_name = 'openbot:<holder_id>:<role>:<pid>'`
(§11.5, P0).

### Rollout order (§15.2 rule 4, expand)

1. Apply 001–006. This creates the roles, functions and HA tables, and gates only `ha_rpo_probe`.
2. Release the app version that runs
   `SELECT set_config('openbot.expected_epoch', '<N>', true)` at the start of **every**
   write transaction. `<N>` comes only from this node's Promote (§10.10). Never follow
   `current_epoch`.
3. Once every write path sets it, attach the gate table by table in the business migrations:
   `SELECT public.openbot_ha_attach_epoch_gate('public.<table>');`
4. Turn on blocking: `check-coverage.sh` without `--report-only` in CI / pre-merge. From
   then on it must return PASS. `--report-only` is only for the window between 1 and 4.

### New authoritative tables (mandatory)

Attach the gate in the **same** expand migration that creates the table
(`templates/attach_epoch_gate.sql`). Partitioned tables: every partition must carry the
gate. The check covers every `relkind = 'r'`, which includes each partition. Changing the
`ha_gate_exempt` list needs architecture review (§15.2 rule 3). HA control tables must
**never** carry the gate (§10.6 #11).

## Verify

```bash
# Throwaway cluster(s), nothing else touched. Runs twice: superuser migrator and a
# non-superuser CREATEROLE migrator that owns the DB (closest to Managed PG).
deploy/ha/commitsafety/scripts/smoke-ephemeral.sh
PG_BIN=/usr/lib/postgresql/17/bin deploy/ha/commitsafety/scripts/smoke-ephemeral.sh
```

The smoke checks cover: idempotent re-apply; the coverage check failing and passing as
expected; OB001 / OB002 / OB003 at COMMIT; a forged `gate_passed` being rejected;
`written_epoch` stamping and immutability; basic bypass denials (DISABLE TRIGGER,
TRUNCATE, `session_replication_role`, direct guard UPDATE, 2PC, replacing the function);
bump guards (OB010 / OB011 / OB012, idempotent retry, INV-ONE, INV-MONO); the gate's ROW
SHARE blocking the bump (`55P03`); an RC stale commit rejected with OB002; an RR stale
commit rejected with 40001; and terminate + confirm + audit.

They do **not** replace the IT-CS-01..13 suite. That suite (oracle via logical decoding,
the IT-CS-04 negative control, fuzzing, perf) is Stage A.2.

## Stage A.2 IT-CS (local)

```bash
deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh
# Full fuzz:
HA_CS_IT_FUZZ_BUMPS=10000 HA_CS_IT_FUZZ_WRITERS=64 \
  deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh
```

Hosted Actions may still be waived (org-level `startup_failure`). Local PG14/17
ephemeral runs are the acceptance evidence path for Stage A.2.
