# OpenBot Toolkit Landing Brief

Phase 1: land blueprint as contracts + ToolRegistry + receipt helpers + mapping + tests.
Phase 2 (this): gate every tool call through Policy then Approval then Receipt (incremental).

Pipeline: Skill to Registry to Policy to Approval to Execution to Verification to Receipt

- Policy: src/policy.ts + config/policy.example.json
- Approval: src/approval.ts (hook + mock)
- Gated executor: src/gated-executor.ts
- Gateway wire: src/gateway/toolkit-phase2-gate.ts used by tools-invoke-http.ts

NO LIVE. PR only; do not merge unless asked.
