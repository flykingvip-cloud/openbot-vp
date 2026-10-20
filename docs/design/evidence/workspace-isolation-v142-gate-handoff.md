# Workspace Isolation Probe — v1.4.2 Gate Re-review Handoff

**Owner:** `cursor-data-governance`  
**Branch tip:** `2173356d74` (pull before re-review; package at `1386ea4193`)  
**Request:** Re-verify **probe gate** only. Architecture direction remains Pass. **C19 stays open** until controlled §4.4 re-run.

## Why prior CR looked unchanged

| CR claim                                | Actual on tip (v1.4.2)                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report still v1.4.1                     | Report is **v1.4.2** (`docs/design/workspace-directory-isolation-audit-2026-08-10.md`)                                                            |
| Probe SHA `c37037f…`                    | Probe SHA **`a6fcf2ad9c8ca2983290c2618275be899efc2f9a596df7d3e1205489f087b5dc`**                                                                  |
| Summary SHA `9ab2e28f…`                 | Historical `001` is `9eec5eee…`. Gate fixture: **`f9953dcc48852d490dcca2d5d2457e336e155948a60c064b5fce50b88b82653b`**                             |
| Lines `:136` / `:248` / `:266` / `:639` | Line map of **old** script; current helpers: `tryRealpath` ~L155, `isPhysicallyInside` ~L170, `walkDeliverables` ~L367, `compareSummaries` ~L1102 |

## Fix map (CR blockers → code)

| Sev | Finding                  | Fix                                                                                          |
| --- | ------------------------ | -------------------------------------------------------------------------------------------- |
| P0  | Symlink physical escape  | `tryRealpath` + `isPhysicallyInside`; walk uses `lstat`; escape → `errors`, not deliverables |
| P0  | Incomplete `--compare`   | Requires `stats.truncated`, `stats.errorCount`, `probe.scriptSha256`, `probeUtc`, `limits`   |
| P1  | `MAX_FILES` per class    | Shared `limits.seenFiles` across all classes                                                 |
| P1  | Summary missing `limits` | `toRedactedSummary` copies `raw.limits`                                                      |

## Fresh materials for this re-review

| Artifact                | Value                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Probe                   | `scripts/audit/workspace-isolation-probe.mjs`                                                           |
| `scriptSha256`          | `a6fcf2ad9c8ca2983290c2618275be899efc2f9a596df7d3e1205489f087b5dc`                                      |
| Report                  | v1.4.2                                                                                                  |
| Gate fixture summary    | `docs/design/evidence/workspace-isolation-20260812-v142-gate.summary.json`                              |
| Fixture `summarySha256` | `f9953dcc48852d490dcca2d5d2457e336e155948a60c064b5fce50b88b82653b`                                      |
| Fixture `probeUtc`      | `2026-08-12T07:00:00Z`                                                                                  |
| Historical `001`        | unchanged reference only — **must not** pass v1.4.2 `--compare` (missing `limits` / old `scriptSha256`) |

## Local verification (already green)

```bash
shasum -a 256 scripts/audit/workspace-isolation-probe.mjs
# expect a6fcf2ad9c8ca2983290c2618275be899efc2f9a596df7d3e1205489f087b5dc

OPENBOT_TEST_PROFILE=low pnpm test src/gateway/workspace/c19-evidence.test.ts
# includes symlink escape + global MAX_FILES
```

Self `--compare` against the v142 fixture passes; `--compare` against historical `001` fails closed.

## Ask

If tip + SHA `a6fcf2ad…` confirm the four blockers closed → mark **探针门禁通过（待受控环境 §4.4 复验）**.  
C19 / 实施基线 remain **不通过** until live controlled re-probe.
