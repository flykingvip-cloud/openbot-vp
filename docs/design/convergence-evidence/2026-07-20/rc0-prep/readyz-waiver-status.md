# Readyz waiver status — wecom

Source (read-only shared tree):  
`docs/design/convergence-evidence/2026-07-20/readyz-waivers/wecom.md`  
(worktree copy of waiver file may be absent; content restated below)

## Restatement

| Field                       | Value                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Probe                       | `readyz` component `wecom`                                                         |
| Observed                    | Production v69 (`85eee3e7…`, `openbot:rc-amd64-v69`); also v68                     |
| Symptom                     | `readyz` **503** with `failing:["wecom"]`; `healthz` **200**                       |
| Expires                     | **2026-08-20**                                                                     |
| Introduced by RC0?          | **No** — pre-existing                                                              |
| Staging maintainer sign-off | PROXY-SIGNED 2026-07-20 (`grok-evolution-closure`)                                 |
| Production carry-forward    | PROXY-SIGNED for **continuing** known-fail only — **not** a new production cutover |

## RC0-PREP assessment (2026-07-20)

| Question                                        | Answer                                         |
| ----------------------------------------------- | ---------------------------------------------- |
| Waiver expired?                                 | **No** (expires 2026-08-20)                    |
| Failure surface expanded by D0–D4?              | **No evidence** in this wave’s regression pack |
| Treat as permanent green?                       | **Forbidden**                                  |
| New production cutover using this waiver alone? | **NO** — PRODUCTION_GO remains NO              |

## Gate rule

Staging may accept the same known `{wecom}` fail. Any **additional** `readyz` failures → **NO_GO** until a new waiver.
