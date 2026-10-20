# Item 6 Restricted Implementation — Acceptance Handoff

**Request:** Item 6 Restricted Implementation Review only (re-verification). **Not** Item 6 met. **Not** Phase 1B unlock.

This packet submits restricted Item 6 implementation evidence for independent Codex review after implementation re-verification on latest `origin/main`.

| Field                            | Value                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ |
| status                           | **submitted for review**                                                       |
| Item 6 Restricted Implementation | **submitted for review**                                                       |
| itemMet / item6Met               | **not-issued** (false)                                                         |
| phase1bUnlock                    | **not-issued**                                                                 |
| deployAuthorized                 | **false**                                                                      |
| wiredToProductionResolver        | **false**                                                                      |
| liveCutover                      | **false**                                                                      |
| schemaV2ProductionWrite          | **false**                                                                      |
| productionCatalogWrite           | **none**                                                                       |
| productionSqliteWrite            | **false**                                                                      |
| originMainSha                    | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                     |
| evidence                         | `docs/design/evidence/memory-workspace-phase1b-item6-restricted-accepted.json` |
| runtime                          | `src/memory/item6-authorized-sqlite-{path,read,migrate}.ts`                    |

## Scope this round

- Re-run Item 6 directed vitest on `origin/main` descendant candidate.
- Document fail-closed negative paths and isolated-copy success paths.
- **No** Catalog production write, **no** production SQLite write, **no** deletion of legacy data or call sites.

## Fail-closed negatives (verified by directed tests)

| Case                                                   | Module                | Denial                                                |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------- |
| Unset authorized SQLite path                           | path / migrate / read | `unconfigured`                                        |
| Missing trusted root                                   | path / migrate        | `missing-trusted-root`                                |
| `docs/design/evidence` path                            | path / migrate        | `rejected-evidence-path` / `missing-trusted-root`     |
| `~/.openbot` production path                           | path / migrate        | `host-not-production-sot` / `missing-trusted-root`    |
| `/tmp`, `/var/tmp`, `/private/tmp`, `/private/var/tmp` | path / migrate        | `rejected-fixture-path`                               |
| Path outside trusted root                              | path                  | `path-outside-trusted-root`                           |
| Symlink escape                                         | path                  | `path-outside-trusted-root` / `rejected-fixture-path` |
| Cross-tenant identity                                  | migrate               | `cross-tenant`                                        |
| Unknown identity                                       | migrate               | `unknown-identity`                                    |
| Source hash mismatch                                   | migrate               | `backup-hash-mismatch` + `recoveryRequired`           |
| Concurrent migration (same operationId)                | migrate               | `concurrent-migration-forbidden`                      |
| Production sqlite write                                | migrate guards        | `production-sqlite-write-forbidden`                   |
| Resolver switch                                        | migrate guards        | `resolver-switch-forbidden`                           |
| LIVE cutover                                           | migrate guards        | `live-cutover-forbidden`                              |
| Schema v2 production write                             | migrate guards        | `schema-v2-production-write-forbidden`                |

## Success path (isolated shadow migration)

- `sourceHash`, `backupHash`, `copyHash` match on pass.
- `sourceUnwritten=true`, `readOnlySource=true` (read module).
- `isolationRoot` includes `operationId` partition under trusted root.
- Migration lock released on success; concurrent second attempt denied while held.
- Source SQLite bytes and hash unchanged after migration.

## Directed tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/memory/item6-authorized-sqlite-path.test.ts \
  src/memory/item6-authorized-sqlite-read.test.ts \
  src/memory/item6-authorized-sqlite-migrate.test.ts
```

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item6-restricted-accepted.test.mjs
```

## Forbidden claims

Do **not** interpret this handoff as:

- Item 6 met
- Phase 1B unlocked
- Item 7 Accepted / Gate B Accepted
- LIVE authorized
- Production resolver wired
- Schema v2 production write enabled

## Requested review

**Item 6 Restricted Implementation Review only.** Await independent Codex re-review before any Item 6 met issuance.
