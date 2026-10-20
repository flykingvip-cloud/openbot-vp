# Item 5 runtime alignment eligibility follow-up

**Handoff only.** This packet does not score Item 5 met. It does not unlock Item 6 or Item 7. It does not flip `wiredToProductionResolver`.

A re-review that still reports `HEAD=bca29399fb` and `runtimeAlignedToBaseline=false` inspected the kiro-loom / shared dirty tree, not `origin/main` after #531. On that dirty tree the five closeout JSON files were still uncommitted copies of `item5-closeout-a7b151a707-20260819T133341Z`, and `memory-workspace-phase1b-item5-runtime-eligibility.json` was left at the #494 overlay (`34595862` ancestor, not identity).

Canonical SoT after Plan A:

| Field                        | Value                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Review surface               | `origin/main` https://github.com/gmood2008/openbot/commit/97d88b38a42cf38ad92a1643936892e94fc5682c (#531) |
| Handoff                      | `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-runtime-alignment-20260819.md`     |
| operationId                  | `item5-closeout-6ac338479a-20260819T163148Z`                                                              |
| Plan                         | **A**                                                                                                     |
| runtimeSha                   | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`                                                                |
| baselineSha                  | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`                                                                |
| originMainSha at measurement | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`                                                                |
| runtimeAlignedToBaseline     | **true** (binary identity of `build-info.commit` and baselineSha)                                         |
| overlay                      | `item5-runtime-align-r1` / `20260819T162800Z`                                                             |
| LIVE cutover                 | false                                                                                                     |
| item5Met                     | false                                                                                                     |
| item6 / item7                | locked                                                                                                    |
| unlock                       | not-issued                                                                                                |
| wiredToProductionResolver    | false                                                                                                     |

`#531` is evidence-only. Production runtime remains `6ac338479a…`. Do not overlay merge commit `97d88b38a4` as a new gateway runtime.

This follow-up updates `memory-workspace-phase1b-item5-runtime-eligibility.json` and the closeout test so they no longer freeze the superseded ancestor packet (`runtimeAlignedToBaseline=false`). It does not re-run production writes. It does not declare Item 5 met.

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs
```

Both passed after this eligibility/test alignment.
