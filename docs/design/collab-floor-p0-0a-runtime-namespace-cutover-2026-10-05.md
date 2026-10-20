# Floor Runtime v2.1 P0.0a: collaboration runtime namespace cutover runbook

> Status: **code merged with the flag OFF. Production cutover is BLOCKED (N2)** until every
> precondition in §2 is signed off. Owner instruction (2026-10-05): do not deploy right now.
>
> 状态：**代码合入时 flag 默认关闭；生产切流受 N2 阻断**，§2 的前置条件全部签字前不得开启。
> Owner 2026-10-05 指示：当前不部署。

## 1. What changes / 变更内容

| Fact   | Legacy (flag off, byte-identical to baseline)                                                                               | `<ns>` (flag `collaboration.runtimeNamespace=true`) |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Rounds | `<collab>/groups/<enc(groupId)>/runtime/rounds/`                                                                            | `<ns>/rounds/`                                      |
| Ledger | `<collab>/groups/<enc(groupId)>/ledger/collaboration.jsonl` (+ legacy flat `collaboration-ledger.jsonl`, no longer written) | `<ns>/ledger/collaboration.jsonl` (durable append)  |

`<ns> = resolveTrustedGroupLocator(...)/runtime`:

- managed_enterprise: `<tenantsRoot>/<tenantId>/collaboration/groups/<enc(groupId)>/runtime`. A missing or untrusted tenant throws `RuntimeNamespaceTenantRequiredError` (fail-closed). There is no runtime fallback to the host legacy root (`group-locator.ts` frozen SoT).
- personal_local: `<collab>/groups/<enc(groupId)>/runtime` (tenantKey `_local`). Rounds stay in place; only the ledger moves under `runtime/`.

Other group files (operating-state, memory, governance, transcript, learning assets, behavior buffer) stay on the existing C5 group store. They are listed in the migration report as `retainedOnLegacyStore`.

其他群文件（operating-state、memory、governance、transcript、learning assets、behavior buffer）仍留在现有 C5 群存储，迁移报告中以 `retainedOnLegacyStore` 列出。

## 2. N2 preconditions (all required before the flag is turned on) / N2 前置条件

1. The §7.1 read-only production scan report is attached to the cutover ticket (`scan-report-20261005.json`: 27 operating-state files, all `tenantHint: null`, 1 non-terminal round `grp-shared-tx` / `PRIMARY_QUEUE`, 2 groups with dual ledgers).
2. The dry-run report has **zero quarantined groups**, or every quarantine entry has a signed disposition, recorded as a `--tenant-map` entry, as discard, or as keep-read-only.
3. sha256 matches 100% (`totals.verified == totals.files`, `verifyFailures == 0`, `conflicts == 0`). N random files are re-checked by hand against `MIGRATION_MANIFEST.json`.
4. Write freeze is in force for the window (§3).
5. Drills done on a copy: the post-cutover smoke test (same groupId under two tenants is isolated; managed mode with no tenant fails closed) and `--reverse` (idempotent; data written after the flag is turned off flows back; re-enabling loses nothing).

## 3. Write freeze / 写入冻结

- Set `collaboration.runtimeWriteFreeze: true` and reload the gateway. While it is set, every round-store write (`writePersistedRound`, `applyRoundTransition`) and every ledger append throws `CollaborationRuntimeWriteFrozenError` (`COLLAB_RUNTIME_WRITE_FROZEN`). Reads still work.
- Announce the window, wait for in-flight `chat.send` group rounds to drain (no `ROUND_*` activity in logs), then run the migration.
- `--apply` refuses to run without `--confirm-write-freeze` and warns if the loaded config is not frozen.
- After the flag flip and smoke test, set `runtimeWriteFreeze: false`.

设置 `collaboration.runtimeWriteFreeze: true` 并 reload，此时 round-store 与 ledger 写入都会被拒（读取不受影响）。等在途群回合排空后再执行迁移。`--apply` 没有 `--confirm-write-freeze` 时拒绝执行。

## 4. CLI

```bash
# 1) dry-run (default: writes nothing)
node --import tsx scripts/migrate-collab-runtime-namespace.ts \
  --source-root ~/.openbot/collaboration/groups \
  --tenants-root ~/.openbot/tenants \
  --report /tmp/ns-dry-run.json

# 2) apply during the freeze window (copy only; sha256 manifest + audit)
node --import tsx scripts/migrate-collab-runtime-namespace.ts --apply --confirm-write-freeze \
  [--tenant-map signed-dispositions.json] --report /tmp/ns-apply.json

# 3) rollback: flag off, then sync <ns> -> legacy incrementally
node --import tsx scripts/migrate-collab-runtime-namespace.ts --reverse [--apply --confirm-write-freeze]
```

Also available as `pnpm collab:migrate-runtime-namespace -- <flags>`. Other flags:

- `--profile personal_local --target-groups-root <dir>`
- `--group <id>` (repeatable)
- `--allow-quarantine`: apply the non-quarantined groups anyway. Only with signed dispositions.
- `--run-id <id>`

Exit codes: 0 ok, 2 conflict / verify failure / failed group, 3 refused.

### Tenant decision / 租户判定

The precedence is:

1. `--tenant-map` (operator)
2. Group records (`tenantId` in `operating-state.json` / `profile.json`)
3. Tenant group ACL (`<tenantsRoot>/<tid>/collaboration/groups/<enc>/members.json`)
4. A `/tenants/<tid>/collaboration/` path segment
5. The Owner default: tenant **`001`**, reason **`owner-default-tenant-001`**

Several candidates, an invalid tenant id, or a group whose `MIGRATED_TO.json` points at another namespace all go to quarantine. Nothing is written for a quarantined group.

### Ledger merge / dedupe

Groups with both `ledger/collaboration.jsonl` and `collaboration-ledger.jsonl` are merged:

- **Key**: sha256 of the canonical JSON (object keys sorted recursively). Lines that are not JSON get `raw:sha256(trimmed line)`.
- **Winner**: the first occurrence, with the canonical file ahead of the flat file, then by line order. The original line text is kept.
- **Order**: `recordedAtMs` ascending (records without it go last), then source precedence, then line index.
- **Re-runs**: the existing target bytes are kept as a prefix and only missing keys are appended, so a re-run is idempotent.
- **Reverse**: missing records are appended to the legacy canonical file. Records already present in either legacy file are skipped.

### Artifacts per group / 每个群的产物

- `<ns>/migration/MIGRATION_MANIFEST.json`: source, target, per-file baseline sha256, lines, bytes, mtime, and run history.
- `<ns>/migration/audit.jsonl`: `{kind: "collab_runtime_namespace_migration", actor: "migration", groupId, tenantId, reason, from, to, status, runId}`.
- `<legacy group>/MIGRATED_TO.json`: a marker. The legacy files themselves are never modified or deleted.
- Copy rule (three-way against the manifest baseline): copy / unchanged / overwrite (destination still equals the baseline) / `dest_newer` / `conflict`. Nothing is written on `dest_newer` or `conflict`.

### Non-terminal rounds / 非终态回合

Non-terminal rounds are copied as-is and listed under `nonTerminalRounds`. In production there is exactly one: `grp-shared-tx`, `PRIMARY_QUEUE`. On the next round in that group, `decideRoundRecovery` aborts the round (`restart_no_rerun`) and never re-runs it. Note that v2.1 §3.4 step 6 asks for `ROUND_ABORTED(namespace_migration)` marking. Per the 2026-10-05 task instruction the script does not rewrite round files; this is listed as an open question.

## 5. Cutover sequence / 切流步骤

1. Freeze (§3).
2. Dry-run, review the report, and get quarantine dispositions signed.
3. Apply and verify the totals.
4. Spot-check the manifest by hand.
5. Set `collaboration.runtimeNamespace: true` and reload.
6. Run the smoke test (two tenants with the same groupId, missing tenant rejected).
7. Unfreeze.

**Rollback**: set `runtimeNamespace: false`, then `--reverse --apply --confirm-write-freeze` inside a freeze window. The legacy root stays read-only until P1-B passes acceptance.
