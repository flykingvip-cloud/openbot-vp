# 01 — Credentials-omit root cause (DEF-008)

**Pin:** `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c`  
**When:** 2026-11-02 Asia/Shanghai  
**Classification:** **product defect** (not test defect; environment triggers via macOS `/var`→`/private/var` symlink, but product path compare is non-canonical)  
**Security boundary:** **YES** — default backup archive can contain `credentials/oauth.json` while advertising omit / `skipped.reason=excluded`.

## Reproduction (this pin)

| Evidence | Result | Path |
| --- | --- | --- |
| Unit: `src/commands/backup.test.ts` → “default archive payload omits credentials under state” | **FAIL** assert archive still contains `credentials/` | `logs/02-backup-unit-omit-repro.log` |
| Diagnostic: createBackupArchive default `includeCredentials:false` under `os.tmpdir()` | **credentialLeakInArchive=true**; plan still lists skipped excluded | `logs/03-realpath-diagnostic.out.txt` (+ script `03-realpath-diagnostic.mjs`, fictional payload only) |
| Historical Stage4 evidence (prior pin `1ce8f5ee…`) | **FAIL** same assert at `stage4-store-evidence.test.ts:279` | prior `runs/2026-11-01-pr192-review/logs/10-stage4-evidence.log` |
| Stage4 vitest file load on isolated WT | blocked by missing workspace package resolve when using ephemeral config / symlink `node_modules` | `logs/01-stage4-credentials-omit-repro.log` — **not** used as primary omit proof; unit+diag sufficient |

No live secrets were used. Diagnostic wrote only `FICTIONAL_PLACEHOLDER_NOT_A_SECRET`. Logs must not be extended with real OAuth material.

## Root cause

1. `resolveBackupPlanFromDisk` returns `oauthDir` as the **logical** path from `resolveOAuthDir()` (`backup-shared.ts` ~120, returned ~271).
2. Included **state** asset uses **canonical** `realpath` (`canonicalPath`) as `sourcePath`.
3. On macOS, `os.tmpdir()` is under `/var/folders/...` which realpaths to `/private/var/folders/...`.
4. Tar pack walks canonical state tree; filter calls `isOauthPathExcluded(entryPath, plan.oauthDir)` (`backup-create.ts:371-379`).
5. `isOauthPathExcluded` (`backup-create.ts:194-198`) does `path.resolve` only — **does not realpath** — so `isPathWithin(/private/var/.../credentials/oauth.json, /var/folders/.../credentials)` is **false**.
6. Filter therefore **keeps** credential files. Manifest still records `options.includeCredentials=false` and `skipped: [{kind:credentials, reason:excluded}]` — **plan/metadata lie relative to payload**.

Diagnostic numbers (Asia/Shanghai run):

- `symlinkMismatch: true`
- `isPathWithin_logical_vs_real_entry: false`
- `isPathWithin_real_vs_real: true`
- `credentialLeakInArchive: true` with relpath `.../credentials/oauth.json` inside archive payload

## Exact loci

| Role | File:line |
| --- | --- |
| Non-canonical filter compare | `src/infra/backup-create.ts:194-198` (`isOauthPathExcluded`) |
| Filter call site | `src/infra/backup-create.ts:371-379` |
| Plan returns logical `oauthDir` | `src/commands/backup-shared.ts:271` (resolve ~120; skip list **does** canonicalize ~253) |
| Failing product unit assert | `src/commands/backup.test.ts:451-452` |
| Failing Stage4 acceptance assert | `docs/acceptance/stage4-store-evidence.test.ts:279-280` |

## Impact

- **Security boundary:** default backup is documented / flagged as credentials-excluded, but archives created when state lives on a symlinked path (common on macOS temp + often `/var`) may **embed OAuth credential files**.
- Sharing, uploading, or storing “safe” backups can leak secrets.
- Acceptance Stage4 cannot be PASS while this remains.
- Not a redaction-of-logs issue only — it is a **payload inclusion** bug. Tests detecting it are correct.

## Fix suggestion (NO product patch in this PR)

Authorized product follow-up should:

1. Canonicalize `oauthDir` (and preferably state/config) with the same `canonicalizeExistingPath` / `realpath` used for asset `sourcePath` before filter compare; **or** pass canonical oauth into the tar filter.
2. Defense in depth: also exclude any archive entry whose path contains `/credentials/` (or equals oauth basename tree) when `includeCredentials===false`, independent of symlink identity.
3. Add a regression that forces logical vs realpath mismatch (tmpdir on macOS is enough) and asserts archive bytes omit credentials **and** that filter uses canonical oauth.
4. Consider backup verify warning if `includeCredentials===false` but archive lists `credentials/` paths.

## Defect ID

**DEF-008** — Backup default credentials-omit fails across symlink/realpath (security boundary).

See `docs/acceptance/p1-fix-2026-11-01/defect-status.md` update (documentation only; not authorized as product fix here).
