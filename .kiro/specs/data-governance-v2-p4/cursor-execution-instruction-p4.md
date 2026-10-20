# Cursor Execution Instruction: Data Governance v2 — P4 Governed Placement and Sync

> **Executor:** Cursor (`cursor-data-governance`)  
> **Acceptance owner:** `codex-data-governance`  
> **Phase:** P4 **Accepted** (first-wave); P4 closure recorded; v2 CR resubmit pending  
> **Prerequisite:** P3 Accepted (`84a4165093`); P4 Gate Accepted (`c58652f74e`)  
> **Hard constraints:** `gate-p4.md` + `design-p4.md` + retained P0–P3 gates  
> **Source architecture:** `docs/design/openbot-data-governance-architecture-v2-2026-08-10.md` (§12, §16 P4, §17.5)

## 0. Sequence

```text
P3 Accepted
  → P4 Gate → Gate Accept
  → P4-a / P4-b / P4-c / P4-d → P4 first-wave Accepted
  → P4 Accepted (first-wave scope) — closure submitted
  → later adapters (separate unlock)
```

## 1. Attribution

```text
Task: data-governance-v2-p4
Agent: cursor-data-governance
```

## 2. Iron rule — promotion decision

```text
MUST call: decideShadowPromotion (cognitive-shadow-promotion.ts)
MUST NOT: fork thresholds, copy 0.8/0.5 into executor, or invent parallel allow/deny
```

## 3. First-wave scope (Accepted)

In: resolver, signed protocol + receipt, local + managed encrypted cloud, export/restore across placement (binding only).

Out: BYOS, tenant cloud, cold archive, dedicated regional.

## 4. Still locked

- Claiming v2 program complete before Codex CR Accept
- Later P4 adapters until separate unlock
- Editing Codex-owned architecture document
- Dual Catalog / identity-kernel flatten / engine purge / auto-admit

## 5. Closure handoff

`.kiro/specs/data-governance-v2-p4/codex-handoff-p4-closure.md` — directed suite 7 files / 172 tests + Gate static 2/2.
