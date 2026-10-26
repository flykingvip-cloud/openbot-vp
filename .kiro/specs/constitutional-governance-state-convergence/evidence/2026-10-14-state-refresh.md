# Evidence: constitutional governance state refresh (2026-10-14)

authorityRole: supporting-evidence
observedAt: 2026-10-14T03:19:18Z
observedAtAsiaShanghai: 2026-10-14T11:19:18+08:00
method: GitHub API only (cursor-github MCP); no clone; no CloudAgent; no ledger/src edits

## Baseline reads

| Item                         | Value                                                               |
| ---------------------------- | ------------------------------------------------------------------- |
| `origin/main` tip            | `19549e6629d374308405edc2c0e3036739af2393`                          |
| Tip author date (UTC)        | 2026-10-14T03:55:33Z                                                |
| Tip local (Asia/Shanghai)    | 2026-10-14 11:55:33 CST                                             |
| Tip subject                  | docs(deploy): ledger seq127 LIVE tip 5ea7e2b7 (clean DIGEST) (#697) |
| Prior SoT `originMainSha`    | `aff3fd345fa53f78ff37afc4ae40a67f28dbbe4e` (2026-09-27)             |
| Prior matrix `originMainSha` | `30fde26fdf8531259c18c4e2610c93df37206387` (older than prior SoT)   |

## Ledger (read-only)

Source: 2026-10-14 read-only observation of the openbot-vp copy on `main` (seq 127 below). That file is no longer the live ledger. Live ledger: https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl.

Last open LIVE line:

- seq **127**
- gatewaySha / uiSha: `5ea7e2b7bd33e0a9f17e99829757913659db6e9f`
- liveFrom: `2026-10-14T03:30:04Z` (Asia/Shanghai 2026-10-14 11:30:04 CST)
- liveTo: null
- liveVerified: true

**Do not** copy ledger SHA into `runningContainerSha`.

## High-risk flags (source constants)

| Constant                                     | Value   | Path                                             |
| -------------------------------------------- | ------- | ------------------------------------------------ |
| `CONSTITUTIONAL_CONTRACTS_ENFORCE`           | `false` | `packages/constitutional-contracts/src/flags.ts` |
| `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE`       | `false` | same                                             |
| `CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON` | `false` | same                                             |
| `ORCHESTRATION_LIVE_INVOKE`                  | `false` | `src/task-orchestration/types.ts`                |

## PRs absorbed / held

| PR   | State      | Merge SHA (if any)                         | Role in SoT                                           |
| ---- | ---------- | ------------------------------------------ | ----------------------------------------------------- |
| #170 | MERGED     | `cdcf9a0a2ef4387ca7c6c57d5ebf43da1f0e030a` | `BOUNDED_RETENTION_APPROVED` / bounded supersede only |
| #204 | MERGED     | `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5` | Checkpoint B `AGREE_SHADOW_WIRING`                    |
| #213 | MERGED     | `966372cc5e7a70c4574ad1bb869b42bfd48aa3d6` | Checkpoint B post-merge closeout                      |
| #271 | MERGED     | `d0a485ebb60050cfa970742ef96129fbe80b7484` | C1–C3 default-off wiring                              |
| #689 | MERGED     | `43ed4241c068f12798eae1dcca7badf889e2c00a` | H1 docs triptych                                      |
| #694 | OPEN Draft | —                                          | H1 impl; governance hold; not landed                  |

Checkpoint B final acceptance states `checkpointCImplementationAuthorized: true` and `runtimeEnabled: false`. Packet text may say `productionProven: unknown`; **SoT keeps `productionProven: false`**.

## Invariants written into refreshed SoT

- `phaseCDecision = NO_GO_ACCEPTED`
- `phaseDOverallGovernanceAuthorization = no-go`
- `productionProven = false`
- `closeGateMet = false`
- `runningContainerSha = null`
- High-risk flags documented false

## Gaps

- No production-host container self-report this refresh (`runningContainerSha` null).
- No local `git rev-list` ahead-count (no clone).
- `search_code` for some strings returned incomplete/empty; paths resolved via `get_git_tree` + direct `get_file_contents`.
- `#694` remains open; do not merge until SoT refresh lands and separate auth exists.

## Tip bump during apply

- After packet draft, main advanced to `19549e6629d374308405edc2c0e3036739af2393` via #697 (ledger seq127 LIVE tip `5ea7e2b7bd33e0a9f17e99829757913659db6e9f`).
- This evidence file retargeted accordingly; invariants unchanged.

## OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）FAIL alignment (2026-10-14)

Reconciled after an OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）REQUEST_CHANGES on #698:

- matrix `ledger.openLiveSeq` → **127**
- matrix `ledger.gatewaySha` / `uiSha` → `5ea7e2b7bd33e0a9f17e99829757913659db6e9f`
- matrix `ledger.liveFrom` → `2026-10-14T03:30:04Z`
- SoT §7 + this evidence `liveFrom` match frontmatter; tip = `19549e6629d374308405edc2c0e3036739af2393` (#697); LIVE tip = `5ea7e2b7bd33e0a9f17e99829757913659db6e9f` (seq 127).
