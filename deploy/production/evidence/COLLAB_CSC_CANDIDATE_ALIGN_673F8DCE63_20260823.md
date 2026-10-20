# Collaboration CSC candidate alignment 673f8dce63 (no LIVE swap)

Date: 2026-08-23

Status: **candidate ready, LIVE unchanged** — `productionCloseout: not-accepted`

Receipt: `docs/design/evidence/collaboration-csc-candidate-align-673f8dce63-2026-08-23.json`

Clean worktree: `/tmp/openbot-candidate-673f8dce63` @ frozen fetch `673f8dce6386a967b0f8a1a29d4e05eae420e81f`.

## Six-gate summary

| Gate                          | Result                                                                    |
| ----------------------------- | ------------------------------------------------------------------------- |
| 1. Fresh fetch + freeze       | `673f8dce63` @ 2026-08-23 fetch                                           |
| 2. Shadow 3 tests             | 5/5 pass after fix `2a2f14f686`; pristine tip failed 3/5                  |
| 3. Full-dist identity         | `build-info` / tag / OCI revision / digest → `2a2f14f686…`                |
| 4. Forward-only vs seq36 LIVE | **allow** (`e6f26` ⊂ candidate)                                           |
| 5. Smoke + rollback drill     | Candidate `:18889` healthz/readyz OK; rollback tarball → `e6f26` verified |
| 6. Ledger preview             | `SEQ37_LEDGER_PREVIEW_20260823.json` — **not appended**                   |

## Candidate full-dist

| Field   | Value                                                                     |
| ------- | ------------------------------------------------------------------------- |
| SHA     | `2a2f14f6866ce11251281e7e74d6f69a63eaa35b`                                |
| Tag     | `provenance/sha-2a2f14f686`                                               |
| Image   | `localhost/openbot:rc-amd64-provenance-2a2f14f686`                        |
| Digest  | `sha256:b1619b03cd961c960456cd91cdec57ad5f8f7df41cf6198bedbb03e5e0b37cfe` |
| Tarball | `full-dist-2a2f14f686.tgz` sha256 `d5c4e4f802fe…`                         |

## Explicit non-actions

- Did not swap `openbot-gateway-rc`
- Did not append seq 37 to LIVE ledger
- Did not enable inbound / CSC flags
