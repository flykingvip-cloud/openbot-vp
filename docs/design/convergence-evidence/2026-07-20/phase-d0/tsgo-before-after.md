# Phase D0 — tsgo before/after

| Metric           | Value  |
| ---------------- | ------ |
| Before (Phase C) | **86** |
| After (D0)       | **77** |
| Delta            | **-9** |
| Rising?          | **no** |

Build-blocking subset cleared and dropped out of the tsgo list (cogniweave + seats + recall-deny).

## Carryover (not fixed in D0 — leave for later waves)

| Count | Path                                                                | Suggested wave                         |
| ----- | ------------------------------------------------------------------- | -------------------------------------- |
| 23    | `ui/src/ui/app-view-state-shell-slices.ts`                          | UI / shell hygiene (not D1)            |
| 9     | `src/gateway/server-methods/enterprise-data-m1.ts`                  | enterprise data (hotfile-aware)        |
| 8     | `src/conversations/conversation-lifecycle.archive-cw-retry.test.ts` | D2/D3 session                          |
| 4     | `src/gateway/billing/phase2-payg-stages.test.ts`                    | billing                                |
| 3     | `src/conversations/source-identity-migration.ts`                    | D2                                     |
| …     | remaining ≤2 each                                                   | see `/tmp` capture / Phase C top files |

**Policy:** D1 must not increase count above **77** without an explicit checkpoint note.
