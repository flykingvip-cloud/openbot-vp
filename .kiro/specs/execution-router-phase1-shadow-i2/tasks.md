# execution-router-phase1-shadow-i2

Phase 1 Shadow Router Checkpoint I2: default-off, best-effort
shadow-record wiring only. Does not apply candidates. Does not start
Top-K, DAG, ConversationTask, or live invoke.

Design source: `.kiro/specs/execution-router-phase1/**`.
I1 compute core: `packages/toolkit/src/execution-router/shadow/**`.
Do not import `.kiro/**` as production runtime.

## Agents

- cursor-grok · role: owner · scope: Phase 1 Shadow Router I2 default-off shadow-record wiring · paths: packages/toolkit/src/execution-router/shadow-record.ts, packages/toolkit/src/execution-router/shadow-record.test.ts, .kiro/specs/execution-router-phase1-shadow-i2/\*\* · since: 2026-09-07

## Takeover

- verify-then-take from `execution-router-phase1-shadow-i1` (owner `cursor-grok`, merged as #1022). Taken: export append on the two toolkit index files. Not taken: `packages/toolkit/src/execution-router/shadow/**`.
- verify-then-take from `execution-router-phase0` (owner `cursor-grok`, already on main). Taken: one best-effort call site in `execution-router-baselines.ts`. Not taken: `attempt.ts`, auto-reply, Tool policy.
- Authorized by human "下一步" after I1 merge. — cursor-grok

## Tasks

- [x] Best-effort recorder no-ops unless an explicit test override is on — cursor-grok
- [x] Live observation helpers call the recorder; production flag stays false — cursor-grok
- [x] apply remains false; Skill/Tool sets and policy results unchanged — cursor-grok
- [x] Privacy: events and snapshots stay digest-only — cursor-grok
