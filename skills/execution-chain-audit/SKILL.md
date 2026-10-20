---
name: execution-chain-audit
description: Audit and maintain OpenBot's user-to-tool execution chain, including intent routing, tool policy, resource authorization, approvals, retries, fallbacks, and user-visible delivery. Use when investigating execution failures, duplicated control mechanisms, approval fatigue, skill/resource reachability, or regressions in long-running task behavior.
metadata:
  short-description: Audit OpenBot execution paths and control-plane drift
---

# Execution Chain Audit

Use this skill to produce an evidence-backed audit of an OpenBot execution path and track drift over time. The goal is to clarify which layer makes each decision before proposing new mechanisms.

## Operating rules

- Read repository-local instructions first.
- Treat current code and real session traces as the source of truth; do not infer behavior from issue text alone.
- Preserve fail-closed authorization. Never recommend implicit elevation from a user's natural-language approval.
- Do not edit runtime code during an audit unless the user explicitly asks for a fix.
- Keep user-facing findings separate from internal tool parameters, approval IDs, and stack traces.

## Audit workflow

1. Select representative traces: ordinary read, approved exec, elevated request, skill invocation, web research, and one failed/timeout case.
2. Reconstruct each trace through: receive → intent → session/tenant scope → candidate tools → skill policy → inbound ceiling → resource/workspace authorization → exec/elevated approval → execution → retry/fallback → delivery.
3. For every stage record the deciding module, input, decision, error code, retry owner, and user-visible effect.
4. Mark duplicated or conflicting decision points. Distinguish tool visibility, tool execution authority, resource authorization, high-risk approval, and retry policy.
5. Compare the trace against the canonical matrix in `references/decision-matrix.md`.
6. Report gaps as evidence-backed findings, then propose the smallest consolidation that removes ambiguity.

## Required output

Return:

- Executive conclusion (one paragraph).
- Evidence table with trace, stage, implementation location, observed decision, and confidence.
- Control-plane conflicts and duplicated responsibilities.
- Minimal remediation sequence grouped as P0/P1/P2.
- Regression tests and live smoke checks.
- Metrics to monitor after the change.

Use confidence labels: `confirmed`, `inferred`, or `unverified`. Explicitly list missing evidence.

## OpenBot anchors

Start inspection at `src/agents/tool-catalog.ts`, `src/agents/inbound-tool-policy.ts`, `src/agents/skills/skill-policy.ts`, `src/infra/exec-approvals.ts`, `src/gateway/context-scope/`, `src/gateway/workspace/`, `src/agents/pi-embedded-*`, and `src/auto-reply/`. Follow actual call sites rather than assuming these are the only enforcement points.

For long or multi-mode audits, read `references/decision-matrix.md` and `references/report-template.md` before writing the report.

## Definition Audit Handoff

If the audit finds multiple modules deciding the same tool, permission, policy, schema, or reply rule, run `fullstack-definition-audit` first. Confirm the source of truth, overlays, forks, aliases, and consumers before proposing a new authorization bus, retry controller, fallback state machine, or reply filter.

Use the skills in this order when both symptoms are present:

```text
fullstack-definition-audit → establish the intended source of truth
execution-chain-audit      → trace the runtime path and compare reality
```
