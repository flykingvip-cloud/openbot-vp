# Shadow staging and preprod runbook

Process-environment procedure for observing governance shadow decisions on staging or preprod. This page does not change repository defaults, and it does not authorize `enforced`.

The §8.4 enforced admission checklist lives in [`enforced-admission-checklist.md`](./enforced-admission-checklist.md). Passing the daily triage below does not permit setting any `OPENBOT_GOVERNANCE_*_MODE` to `enforced`.

Script semantics, JSONL path resolution, and bucket rules live in `scripts/governance/README.md`.

## Open shadow

Set these on the **gateway process environment** (service unit, container env, or the shell that starts the process). Do not edit source defaults, and do not commit these values into the repo.

```bash
OPENBOT_GOVERNANCE_SHADOW_LOG=1
OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW=1
OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW=1
OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW=1
OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW=1
OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW=1
```

`OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW` is present (`src/gateway/governance/adapters/capability-invoke-adapter.ts`). Include it in the staging open set. It defaults off in code; this recipe only turns it on for the process you restart.

`OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW` is present (`src/gateway/governance/adapters/access-control-adapter.ts`). Include it in the staging open set. It also defaults off in code; this recipe only turns it on for the process you restart.

Leave every `OPENBOT_GOVERNANCE_*_MODE` **unset**. The code default is `shadow`. This open recipe never sets a mode to `enforced`.

Truthy values for the shadow flags are `1`, `true`, `yes`, and `on`. Unset, empty, `0`, `false`, `no`, and `off` leave a flag off.

`OPENBOT_GOVERNANCE_SHADOW_LOG` gates the sink. The other flags only decide whether that path evaluates. With the log flag off, nothing is appended.

Restart the gateway after changing the environment. These flags are read from the process environment. Hot reload has not been verified, so a running process keeps the environment it was started with.

The sink appends one JSON object per line to:

```text
CONFIG_DIR/audit/governance-shadow-decisions.jsonl
```

`CONFIG_DIR` is `OPENBOT_STATE_DIR`, else `OPENCLAW_STATE_DIR`, else `CLAWDBOT_STATE_DIR`, else `~/.openbot` (or `~/.openclaw` when only the pre-rebrand directory exists). The file mode is `0600` inside a `0700` `audit` directory. The sink does not create the file while the log flag is off.

Shadow recording does not change HTTP responses or `tool.execute`. It does not call `auditManagementDecision`.

### E8 after P5-3 / P5-4

`OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE` is `legacy | shadow | enforced` and **defaults to `shadow`**. The code default is never `enforced`. Leave MODE unset on staging.

With MODE at default `shadow`, `OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW` on (still default off), and an explicit `gateway.tools.tenantCapabilities` allow or deny, the shadow envelope may record `allow` or `deny`. Unset / lookup failure stays `skipped` (never allow): enterprise-scoped rows use `tenant-capability-not-enforced` or `capability-policy-absent` (D5); no enterprise scope stays `skipped` + `legacy` + `no-enterprise-scope`. HTTP status and body stay on the existing path under `shadow` and `legacy`.

`enforced` is an explicit env override only (after §8.4). In `enforced`, an explicit capability `deny` returns the same HTTP 404 `not_found` shape as the gateway HTTP deny list. `allow` continues. `skipped` / unevaluated never become allow and never block.

## Daily

Run this once per UTC day on a **copy** of the log. The aggregate and daily-report scripts are read-only. They do not set flags and they do not write the log.

1. Pull `governance-shadow-decisions.jsonl` from the staging state directory (`CONFIG_DIR/audit/`). Copy it off the gateway host. Do not truncate or rotate it from the report job.
2. Aggregate the copy.
3. Build the daily report for that UTC day.
4. Triage divergence classes D1 through D6.
5. Alert on enterprise-scoped `skipped` rows.

A missing file exits 1. That is expected when the log flag was off for the whole day. An empty file is a successful read with zero totals.

```bash
COPY=/tmp/governance-shadow-decisions.jsonl
DAY=2026-09-27

node --import tsx scripts/governance/aggregate-shadow-jsonl.ts \
  --file "$COPY" --window "$DAY" --json

node --import tsx scripts/governance/shadow-daily-report.ts \
  --file "$COPY" --window "$DAY" --json
```

`--window` is a UTC day `YYYY-MM-DD`. `--since` / `--until` take inclusive ISO timestamps and cannot be combined with `--window`. Each daily-report row has `window`, `entry`, `source`, `total`, `skipped`, `match`, `divergence`, `byClass`, `topReasons`, `byTenant`.

D4 is inside `total` and `byClass` only. It is not `match` and not `divergence`.

### Triage D1 through D6

Classes come from `shadow.divergence` on each envelope (`classifyDivergence` in `src/gateway/governance/decision.ts`).

| Class | Meaning                                                                              | Daily action                                                                                     |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| D0    | Shadow effect matches the existing effect                                            | No action. Counted as `match`.                                                                   |
| D1    | Shadow is stricter than the existing effect (known bypass or another stricter cause) | Read the row. Confirm the tightening is expected, or file a ticket. Do not change mode.          |
| D2    | Shadow is stricter because attribution is missing                                    | File a ticket for each distinct reason and entry. Do not treat D2 as noise.                      |
| D3    | Shadow is looser than the existing effect                                            | Review. The live decision stays on the existing path. Do not promote the shadow effect.          |
| D4    | The two sides judged different subjects                                              | Not a divergence. Do not add D4 to the mismatch rate.                                            |
| D5    | Either side is `skipped`                                                             | See the enterprise-scoped skipped alert. D5 is `skipped`, not `divergence`.                      |
| D6    | Shadow evaluation threw                                                              | Alert. The shadow path failed closed into a recorded error. It did not change the live decision. |

Keep the raw JSONL line (or `decisionId`) with any ticket. `byClass` on the daily report is the count to start from. Drill into `topReasons` and `byTenant` before closing a class for the day.

### Enterprise-scoped skipped alert

Alert when a skipped row has a tenant. In the report, that is any `byTenant` key other than `(none)` whose `skipped` count is greater than zero.

`reason: no-enterprise-scope` with `mode: legacy` and no `tenantId` is outside this alert. That row is the commercial gate skipping a run that has no enterprise scope.

List the alerting rows with:

```bash
jq -c 'select(
  ((.tenantId // "") | length) > 0
  and (.effect == "skipped" or .shadow.divergence == "D5")
) | {decisionId, ts, tenantId, entry, source, reason, effect, divergence: .shadow.divergence}' \
  "$COPY"
```

Page the list by `entry`, `source`, and `reason`. A non-zero enterprise-scoped skipped count is an alert even when the reason is the expected E8 placeholder below.

After P5-3, `source: capability` / entry E8 rows with `reason: tenant-capability-not-enforced` or `capability-policy-absent` remain expected when the tenant has no explicit policy. Record them in the alert so they stay visible. Do not read skipped as allow. Explicit allow/deny coverage only appears when the capability policy returns allow or deny.

## Rollback

Stop shadow evaluation and JSONL writes by changing the **process environment**, then restarting the gateway.

1. Unset these, or set them false (`0`, `false`, `no`, `off`, or empty):
   - `OPENBOT_GOVERNANCE_SHADOW_LOG`
   - `OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW`
   - `OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW`
   - `OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW`
   - `OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW`
   - `OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW`
2. Leave every `OPENBOT_GOVERNANCE_*_MODE` unset (code default `shadow`), or set that mode to `legacy` explicitly. Do not use `enforced` as a rollback. `OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE=legacy` is not a hard-filter rollback for chat.send, followup, or cron isolated: their hard filter stays whenever the allowlist is an array. To stop shadow recording, unset `OPENBOT_GOVERNANCE_SHADOW_LOG` and the matching `*_SHADOW` flags (step 1); `legacy` does not do that.
3. Restart the gateway. Hot reload has not been verified.

After restart the code defaults apply again: shadow flags off, modes `shadow`. The JSONL file can stay on disk. Rollback does not delete it. The next daily copy should show no new lines once the log flag is off.

## Out of scope

- Flipping `OPENBOT_GOVERNANCE_SHADOW_LOG` or any `OPENBOT_GOVERNANCE_*_MODE` code default.
- Setting any mode to `enforced`. That requires [`enforced-admission-checklist.md`](./enforced-admission-checklist.md) (§8.4).
- Tenant-level switches. Those belong to P7. This runbook uses process env only.
