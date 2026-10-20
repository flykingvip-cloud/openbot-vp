# Full-suite failure attribution vs candidate tip `2664b3633f`

Date: 2026-07-25 (post-cutover audit)

## Method

1. Full recovery run (`OPENBOT_TEST_PROFILE=low`): **173 failed / 11858 passed**.
2. Extract unique failing **files** → **72 files**.
3. Re-run those exact 72 files on pure candidate tip `2664b3633f`: **175 failed / 718 passed**.

## Verdict — no net new failing-file regression

| Metric               | Recovery `127fc543f0` | Candidate `2664b3633f` (same 72 files)               |
| -------------------- | --------------------- | ---------------------------------------------------- |
| Vitest failing tests | 173 (full suite)      | 175 (subset run)                                     |
| Failing files        | 72                    | 72 (same set after normalizing file-load FAIL lines) |

Notes:

- Candidate often reports memory / browser-pool failures as **file-level** FAIL (`FAIL path [ path ]`) with 0 tests collected; recovery emits per-test FAIL lines for the same files. Not a green→red regression.
- Knowledge suite **improved** on recovery after `cbca9f1132` drawer fix.
- Absolute-green full suite remains out of scope for tip `2664b3633f`. Gate for this cut: **Δ failing-files ≤ 0 vs candidate**.

Artifacts: `fail-tests-recovery.txt`, `fail-tests-candidate-subset.txt`.
