# Governance shadow metrics (PR-OBS-1)

Offline readers for the governance shadow decision log. They do not import the gateway, do not write the log, and do not change any `OPENBOT_GOVERNANCE_*` code default.

## Input

Gateway sink (`src/gateway/governance/shadow-sink.ts`) appends one JSON object per line to:

```text
CONFIG_DIR/audit/governance-shadow-decisions.jsonl
```

`CONFIG_DIR` is the gateway state directory:

1. `OPENBOT_STATE_DIR` (canonical), else `OPENCLAW_STATE_DIR`, else `CLAWDBOT_STATE_DIR`
2. otherwise `~/.openbot`, or `~/.openclaw` when only the pre-rebrand directory exists

Both scripts default to that path. Pass `--file` to point at a copy or a fixture.

An empty file is a successful read: totals are zero and the daily report has no rows. A missing file exits 1. The sink does not create the file while the log flag is off.

Blank lines are ignored. A line that is not a JSON object increments `malformed` and is left out of match / divergence / skipped.

## Flags

`OPENBOT_GOVERNANCE_SHADOW_LOG` **defaults off**. The sink writes a line only when the value is truthy (`1`, `true`, `yes`, `on`). Unset, empty, `0`, `false`, `no`, and `off` leave the log disabled. These scripts never set the flag.

Related shadow switches also default off and are unchanged by this directory:

- `OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW`
- `OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW`
- `OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW`
- `OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE` (default `shadow`; never set to `enforced` from these scripts)
- `OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW`

Staging and preprod open, daily triage, and rollback are in `docs/governance/shadow-staging-runbook.md`. Env-override enforced admission (§8.4) is in `docs/governance/enforced-admission-checklist.md`. These scripts never set a mode to enforced.

`OPENBOT_GOVERNANCE_*_MODE` code defaults stay as they are in the gateway (`shadow`, or the shadow flag stays off). Do not flip a mode to enforced from these scripts.

## What the numbers mean

| Bucket       | Rule                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `skipped`    | `effect` is `skipped`, or divergence class is D5                                                |
| `match`      | divergence class D0                                                                             |
| `divergence` | divergence classes D1, D2, D3, D6. A D6 row counts here even though its `effect` is `skipped`   |
| D4           | different subjects. Counted in `total` and `byClass` only. **Not** match and **not** divergence |

`skipped + match + divergence` can be lower than `total` by the D4 count (and any row with no class and no comparable effects).

D6 means the shadow evaluation threw. The model-entitlement recorder (`src/agents/model-fallback-governance.ts`), `/tools/invoke` (`src/gateway/governance/tools-invoke-shadow.ts`) and the subagent model shadow (`src/gateway/governance/spawn-snapshot-handoff.ts`) write it as `effect: "skipped"`, `reason: "shadow-threw"`, `shadow.divergence: "D6"` through `src/gateway/governance/shadow-failure.ts`; the live decision is unchanged. Other shadow writers do not write D6 yet: node.invoke (E9), capability invoke (E11 / E12), agent invocation and access control log a warning; the commercial-run gate and usage attribution return silently. A failed JSONL write cannot record itself and stays a log line.

`entry` is the execution-entry id (`E8`, `E9`, …). Writers stamp it when they already know their entry: `E2` (gateway agent command ingress, including BOOT and the inter-agent bus NESTED lane), `E3` (CLI `openbot agent` in the CLI process), `E6` (subagent lane; E6a / E6b / E6c cannot be told apart), `E8`, `E9`, `E10`, `E11`, `E12`. Other writers (chat.send, followup, cron isolated, memory flush, agent invocation, access control) do not stamp it. Resolution order:

1. JSONL field `entry` when present
2. else `capability` → `E8`, `node` → `E9` (fallback for older, unstamped lines)
3. else `(unspecified)` (model entitlement and agent invocation cover more than one entry)

Aggregation dimensions on the aggregate script: `reason`, `source`, `tenantId`, `entry`.

## Daily report (§8.5)

`shadow-daily-report.ts` prints one row per `entry` + `source` inside the window. Each row has:

`window`, `entry`, `source`, `total`, `skipped`, `match`, `divergence`, `byClass`, `topReasons`, `byTenant`

`window` is a UTC day (`YYYY-MM-DD`) when every selected line shares one day or `--window` is set. A wider file prints `YYYY-MM-DD..YYYY-MM-DD`. `--since` / `--until` take ISO timestamps (inclusive) and label the window as `since..until`. Lines with no parseable `ts` are omitted when a window filter is set. `malformed` is counted for the whole file.

## Run

```bash
node --import tsx scripts/governance/aggregate-shadow-jsonl.ts \
  --file scripts/governance/fixtures/governance-shadow-decisions.jsonl --json

node --import tsx scripts/governance/shadow-daily-report.ts \
  --file scripts/governance/fixtures/governance-shadow-decisions.jsonl \
  --window 2026-09-27 --json
```

Against a live state dir (still read-only):

```bash
node --import tsx scripts/governance/shadow-daily-report.ts --window 2026-09-27 --json
```

Fixture check:

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  scripts/__tests__/governance/shadow-offline-metrics.test.ts
```

## Rollback

These scripts have nothing to roll back. To stop shadow evaluation and JSONL writes on a gateway that was started with the flags on:

1. Unset the shadow flags, or set them false: `OPENBOT_GOVERNANCE_SHADOW_LOG`, `OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW`, `OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW`, `OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW`, `OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW`. The staging steps are in `docs/governance/shadow-staging-runbook.md`.
2. Leave every `OPENBOT_GOVERNANCE_*_MODE` at its code default, or set `legacy` explicitly. Do not use enforced as a rollback.
3. Restart the gateway. Flags are process environment; a running process does not pick them up until restart.

Code defaults stay off / shadow after the restart.
