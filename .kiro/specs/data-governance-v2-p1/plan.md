# P1 Plan — Governance Envelope & Catalog

**Owner:** `cursor-data-governance`  
**Architecture:** §16 P1 in `openbot-data-governance-architecture-v2-2026-08-10.md`

## P1-1 First wave — Accepted

| Domain               | Status   |
| -------------------- | -------- |
| Workspace            | Accepted |
| Agent                | Accepted |
| Conversation Archive | Accepted |

Accepted tip: `995e60ec71` (round 8). See `codex-handoff.md`.

## P1-2 Second wave — unlocked for Gate + design only

**Execution order:** `cursor-execution-instruction-p1-wave2.md`  
**Codex acceptance:** required before any claim of P1-2 complete.

| Domain               | In P1-2          |
| -------------------- | ---------------- |
| Knowledge            | yes (after Gate) |
| Memory               | yes (after Gate) |
| Operational Identity | yes (after Gate) |

### Sequence (mandatory)

1. **P1-2 Gate** — Catalog budgets; first-wave migration / duplicate-canonical; no silent `recovery_required` debt
2. **Design checklist + data inventory** — no global rewrite
3. **Implementation** — envelopes, bindings, inventory APIs, diagnostics, migration + fault injection
4. **Handoff → Codex Accepted**

### Exit criteria (summary)

- Three resource types answer ownership / access / lifecycle / classification / canonical binding without path inference
- Catalog never stores Knowledge bodies, Memory Atom bodies, embeddings, or credentials
- Cross-tenant / Catalog-down / no ownership proof → fail-closed
- Migration idempotent; no dual write / dual canonical on failure
- Directed + first-wave regression tests green

## Non-goals (still locked)

- **P2** lifecycle closure — instruction issued under `.kiro/specs/data-governance-v2-p2/`; Phase C coding locked until Codex Accepts P2 plan/Gate

- P3–P5
- Editing Codex-owned architecture documents unless separately authorized
