# Enforced admission checklist (§8.4)

Process gate for promoting **one** execution entry from shadow observation to an **environment-override** `OPENBOT_GOVERNANCE_*_MODE=enforced` on a canary process.

This document does **not** change repository code defaults. Code defaults for every `OPENBOT_GOVERNANCE_*_MODE` and for `OPENBOT_GOVERNANCE_SHADOW_LOG` stay as shipped. Tenant-level switches are **P7** and are out of scope here; this track is **process env canary only**.

Related:

- Staging / preprod open, daily triage, and rollback (still never authorize enforced): [`shadow-staging-runbook.md`](./shadow-staging-runbook.md)
- Offline JSONL aggregate and daily report: [`scripts/governance/README.md`](https://github.com/upbeyond/openbot/blob/main/scripts/governance/README.md)

## Scope

| In scope                                                                      | Out of scope                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| One named entry (for example E2) on a written canary tenant list              | Flipping any mode default in source                            |
| Process environment on staging / preprod / a canary gateway                   | Tenant control-plane switches (P7)                             |
| Env-override `OPENBOT_GOVERNANCE_*_MODE=enforced` after this checklist passes | Treating shadow daily triage alone as admission                |
| Written rollback owner and rollback steps                                     | Promoting CLI (E3) without enterprise scope via a code default |

Passing [`shadow-staging-runbook.md`](./shadow-staging-runbook.md) daily triage is **necessary but not sufficient**. Do not set `enforced` until every item below is checked for the entry you intend to promote.

E1, E1f, and E4 are not entries whose tightening can be shown by shadow divergence: their hard filter comes from `allowlistEnforcement: "preexisting"` and already applies under `shadow`, `enforced` changes no candidate, and their divergence is D0 by construction. Do not cite their D0 rows as §8.4 tightening evidence.

## Per-entry checklist

Copy this block once per entry. Fill the blanks before any process sets that entry's mode to `enforced`.

```text
Entry id: _______________
Canary window (UTC): _______________ → _______________ (must be ≥ 7 consecutive days)
Written tenant list (ids): _______________
Rollback owner (name / on-call): _______________
Evidence links (daily reports / tickets): _______________
```

- [ ] **D2 — 7 consecutive days:** D2 count is zero for this entry across the window, **or** every D2 row in the window is ticketed (distinct reason + entry, with `decisionId` or raw JSONL retained). Unticketed D2 blocks admission.
- [ ] **D6 — rate:** D6 rate for this entry over the window is **&lt; 0.1%** of that entry's `total` in the daily reports (use `byClass.D6 / total`). Any day at or above 0.1% resets the consecutive-day clock for this item.
- [ ] **D1 — expected tightening:** Every D1 class in the window was reviewed. Confirmed expected tightening (known bypass or intentional stricter shadow) or ticketed. No unexplained D1 remains open.
- [ ] **Canary tenant — 7 days:** The written tenant list ran with shadow (and any prior non-enforced canary) for **7 consecutive days** with **no rollback** of the shadow open set and **no P1–P2 complaints** attributed to this entry's governance behavior.
- [ ] **Not a registered-gap:** This entry is **not** listed as `registered-gap` in the model-caller / execution-entry registries for the path you are promoting. Close or reclassify the gap first (`src/gateway/governance/model-caller-registry.ts`, `execution-entry-registry.ts`, and the inventory). Promoting a registered-gap path is forbidden.
- [ ] **Written tenant list + rollback owner:** Tenant ids are written above (not implied). A named rollback owner is written above and has acknowledged the rollback steps in [`shadow-staging-runbook.md`](./shadow-staging-runbook.md) (unset shadow flags / leave modes unset or `legacy`; never use `enforced` as a rollback).
- [ ] **CLI (E3) without enterprise scope:** CLI / agent-command paths **without** enterprise scope are **never** promoted via a repository code default. If E3 is in scope for this canary, promotion is process-env only on the canary hosts that already carry enterprise scope; hosts without enterprise scope must keep the code default (not `enforced`).

## How to apply the env override (after the checklist)

Only after every box above is checked for that entry:

1. Keep `OPENBOT_GOVERNANCE_SHADOW_LOG` and the relevant path shadow flags on for observation unless the entry's runbook says otherwise.
2. Set **only** the process-environment mode for that entry to `enforced` on the canary gateway(s) that serve the written tenant list. Do not commit the value. Do not change source defaults.
3. Restart the gateway (flags are process env; hot reload is not assumed).
4. Continue daily reports for at least another 7 days. Any D6 ≥ 0.1%, unticketed D2, or P1–P2 complaint → roll back the env override first (set mode unset/`legacy`, restart), then re-open the checklist.

## Explicit non-goals

- Do not treat this checklist as permission to merge a PR that changes `OPENBOT_GOVERNANCE_*_MODE` defaults to `enforced`.
- Do not turn `OPENBOT_GOVERNANCE_SHADOW_LOG` default on in code.
- Do not call `auditManagementDecision` from shadow paths as part of admission.
- Tenant switches remain P7.
