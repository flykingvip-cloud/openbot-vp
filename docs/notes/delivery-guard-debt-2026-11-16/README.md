# Inherited delivery-guard debt — 2026-11-16

This folder is a **review package** for three inherited `delivery-guard` failures
on `origin/main` `a78c5b66959dac3db4ecb2ecd2065aaec029b3c3`. It is **not** a
production enablement, **not** a ledger write, and **not** part of the Batch 1
capability-enablement PR.

| Item                                                                                                                      | Status in this PR                                                                                                                                            | Still needs owner approval                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 stale seq 151 tip pin in `scripts/delivery/ledger.test.ts`                                                             | Fixed: structural unique-open-tip + successor-close invariants, plus historical fixtures for the #172 / seq 151 era. The tip number is not re-pinned to 165. | None for the test change itself.                                                                                                                              |
| C2 157 `missing-object` errors from `pnpm delivery:ledger:audit`                                                          | Classified on a full (non-shallow) clone of this GitHub remote. Report script added. Restore / archival-proof **plan** only.                                 | Whether to restore objects from a donor into backup refs, or to accept archival proof. **Do not** delete ledger rows or weaken the guard.                     |
| C3 `RELEASE_RECORD.md` generated block still at seq 154 / `a17b60872cb6` while the ledger tip is seq 165 / `342de3076099` | Human-readable correction **proposal** only (`c3-generated-block-proposed.diff`).                                                                            | Running `pnpm delivery:release-record:generate --write`. Must not target today's unrecorded LIVE.                                                             |
| Local substitute CI                                                                                                       | Coverage marked per job in `local-substitute-ci-coverage.md`.                                                                                                | GitHub Actions itself (currently bill-blocked). Windows / macOS / iOS / Android / CogniWeave / install-smoke were **not** run and are **not** a full-CI pass. |

**Hard constraints observed:** no write to `deploy/production/releases.jsonl`, no
deletion of ledger rows, no weakening of `delivery:ledger:audit` or
`delivery:release-record:check`, no production deploy, no treatment of today's
LIVE (`8a686145…` / digest `sha256:e7babfa1…`, classified 已发布未记账 relative
to seq 165) as a retroactive approved cutover.

See:

- [c1-seq151-test-intent.md](c1-seq151-test-intent.md)
- [c2-missing-object-restore-plan.md](c2-missing-object-restore-plan.md)
- [c3-release-record-correction-proposal.md](c3-release-record-correction-proposal.md)
- [local-substitute-ci-coverage.md](local-substitute-ci-coverage.md)
