# Cursor Execution Instruction: Data Governance v2 — P1 Second Wave

> **Executor:** Cursor (`cursor-data-governance`)  
> **Acceptance owner:** `codex-data-governance`  
> **Authorized scope:** **P1 second wave only** — Knowledge / Memory / Operational Identity governance coverage  
> **Prerequisite:** P1 first wave **Accepted** (`995e60ec71` / recorded in `.kiro/specs/data-governance-v2-p1/`)  
> **P1-2 status:** Phase C **Accepted** (Round 8 tip `5779ffb1e4`, 2026-08-12).  
> **P2:** Lifecycle Command **unlocked** — do not implement until a dedicated P2 execution instruction is issued.  
> **Still not authorized here:** P3–P5, CogniWeave cognitive-model redesign, dual Catalog systems  
> **Source architecture:** `docs/design/openbot-data-governance-architecture-v2-2026-08-10.md` (§7 Catalog, §16 P1)

## 0. How to execute this order (mandatory sequence)

```text
P1-2 Gate  →  Design checklist + data inventory  →  Codex Gate review
  →  Implementation milestones  →  Handoff  →  Codex acceptance
```

**Hard rule:** Do **not** begin global rewrites, mass migrations, or new envelope write-paths until:

1. `P1-2 Gate` evidence is committed, and
2. Design checklist + data-status inventory are submitted under `.kiro/specs/data-governance-v2-p1/`, and
3. Codex (or the human operator quoting Codex) confirms Gate + design readiness.

If Gate fails, stop. Fix first-wave gaps under a scoped repair PR; do not expand into Knowledge/Memory/OI.

---

## 1. Objective

Extend the **existing** first-wave Governance Envelope + Resource Catalog so that **Knowledge**, **Memory**, and **Operational Identity** resources answer, without path inference:

- ownership / control
- access scope
- lifecycle state
- classification
- canonical storage binding

Catalog remains a **metadata plane**. It must **never** store:

- Knowledge document bodies
- Memory Atom claim bodies (beyond a minimal identity projection)
- embeddings / vector payloads / full-text indexes
- credentials or secret material

P2 lifecycle ops are **unlocked** by P1-2 Accepted; implementation waits on a P2 execution instruction.

---

## 2. Mandatory reading before any edit

- `AGENTS.md` / `SECURITY.md`
- `docs/design/openbot-data-governance-architecture-v2-2026-08-10.md` (§7, §10 Memory notes, §16 P1)
- `.kiro/specs/data-governance-v2-p1/plan.md`
- `.kiro/specs/data-governance-v2-p1/codex-handoff.md` (first-wave Accepted tip)
- First-wave code: `src/gateway/data-governance/**`, inventory/RPC surfaces, create-compensate path
- CogniWeave / memory bridges only as **inventory inputs** (do not fork a second memory Catalog):
  - `.kiro/specs/cogniweave-memory-engine-v2/tasks.md` (if present)
  - related memory store loaders already in-tree

Before touching shared/dirty files:

```bash
git status --short
pnpm loom status
bun scripts/agent-attribution.ts
```

Do not overwrite another agent’s WIP.

---

## 3. Baseline, registration, attribution

Work on the authorized branch/worktree provided by the human (do not self-create branches/worktrees).

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
```

Register / refresh Loom for the second-wave paths (exact globs in `tasks.md`).

Every commit:

```text
Task: data-governance-v2-p1
Agent: cursor-data-governance
```

Use `scripts/committer` with scoped files only. Prefer small green checkpoints.

---

## 4. Phase A — P1-2 Gate (short, blocking)

Produce evidence under `.kiro/specs/data-governance-v2-p1/gate-p1-2.md` (or equivalent) covering **all** of:

### A1. Catalog hot-path budgets (declared contracts)

Confirm first-wave Catalog cache / snapshot / invalidation / degraded-read behavior still meets **declared** budgets (architecture §7.4):

| Operation                   |               P95 target | Degraded behavior          |
| --------------------------- | -----------------------: | -------------------------- |
| Local profile read          |  20 ms excl. content I/O | Last valid local snapshot  |
| Managed resolver read       |  50 ms excl. content I/O | Valid tenant snapshot only |
| Managed write authorization | 100 ms excl. content I/O | Deny; no path fallback     |
| Catalog refresh             |            500 ms target | Bounded backoff            |

Evidence: existing contract tests + any measurement notes. If budgets are only “tests first / measure later,” document exact test names and remaining measurement debt — do not silently claim production SLO.

### A2. First-wave migration & duplicate-canonical detection

Verify Workspace / Agent / Conversation Archive:

- migration (or registration) paths remain restart-safe / idempotent where claimed
- duplicate active canonical bindings are detectable via diagnostics
- no dual-writer regressions on first-wave create/compensate

### A3. No outstanding `recovery_required` debt (operator-facing)

Confirm there is a machine-checkable way to list Catalog rows in `recovery_required` (and that CI / directed fixtures do not leave unacknowledged recovery rows). Document how an operator clears or quarantines them. Gate fails if create-compensate can still leave silent unrecovered state without receipt.

**Gate outcomes:** Pass / Fail with file:line evidence. Only **Pass** unlocks Phase B design submission review and Phase C implementation.

---

## 5. Phase B — Design checklist + data-status inventory (no rewrite)

Submit **before** implementation:

### B1. Design checklist (`.kiro/specs/data-governance-v2-p1/design-p1-wave2.md`)

Must answer:

1. **Resource types & IDs** — stable `resourceId` / `resourceType` for Knowledge, Memory, Operational Identity; relation to existing domain IDs (doc IDs, atom IDs, identity keys).
2. **Envelope MVP fields** — required fail-closed tier per type; what is projected into Catalog vs left in domain stores.
3. **Canonical binding** — one writable canonical per owner scope; how Knowledge/Memory/OI bind without path inference.
4. **Memory split** — raw content store vs Catalog **minimal identity projection** (explicit field allowlist).
5. **Operational Identity ↔ AgentAsset continuity** — reference-only links; no credential copy; no second identity SoT.
6. **Write paths** — which handlers become fail-closed when Catalog/envelope/ownership proof missing.
7. **Inventory API surface** — list/get filters, tenant isolation rules (mirror first-wave null-tenant deny).
8. **Diagnostics** — orphan, duplicate canonical, wrong owner scope.
9. **Migration** — inventory → classify → bind → cutover; idempotent; no dual write; no two active canonicals on failure.
10. **Non-goals** — P2 ops, embedding storage in Catalog, rewriting CogniWeave schemas, UI Memory Center, etc.
11. **File ownership map** — paths this task will touch vs must not touch.
12. **Test matrix** — directed + first-wave regression commands.

### B2. Data-status inventory (`.kiro/specs/data-governance-v2-p1/inventory-p1-wave2.md`)

Redacted inventory of **current** stores / paths / schemas for:

- Knowledge-like assets (packs, docs, enterprise knowledge projections, etc.)
- Memory / CogniWeave bridges and local memory files
- Operational Identity / continuity-related stores

For each class: location, identity key, tenant/owner evidence (or lack), whether a Catalog row already exists, duplicate/orphan risk, migration candidate status.

**Do not** invent a parallel Catalog. Reuse `src/gateway/data-governance/**` primitives.

---

## 6. Phase C — Implementation (only after Gate Pass + design acknowledged)

Suggested milestones (checklist in `tasks.md`):

| ID     | Milestone                                                           |
| ------ | ------------------------------------------------------------------- |
| P1-2-a | Knowledge Asset Envelope + canonical binding                        |
| P1-2-b | Memory Asset Envelope (raw content vs Catalog min projection)       |
| P1-2-c | Operational Identity Envelope + AgentAsset continuity references    |
| P1-2-d | Inventory APIs + tenant isolation + write fail-closed for all three |
| P1-2-e | Diagnostics: orphan / duplicate canonical / wrong owner scope       |
| P1-2-f | Legacy migration + rollback + fault-injection tests                 |
| P1-2-g | First-wave regression green + handoff package                       |

Reuse first-wave patterns: pending→active create SM, operation markers, compensate/recovery receipts, marker-owned quarantine, no hard Catalog delete before quarantine, `recovery_required` on partial compensate failure.

---

## 7. Exit criteria (Codex acceptance)

Accepted only when **all** hold with reproducible evidence:

1. Knowledge / Memory / Operational Identity answer ownership, access scope, lifecycle, classification, and canonical binding **without path inference**.
2. Catalog does **not** store Knowledge bodies, Memory Atom bodies, embeddings, or credentials.
3. Negative cases fail closed: cross-tenant, Catalog unavailable, missing ownership proof.
4. Migration is repeatable; failure does not produce dual writes or two active canonicals.
5. All directed P1-2 tests **and** first-wave regression suite pass.
6. Scope stays inside P1-2 for this instruction (historical). P2 is unlocked only after Phase C Accepted.

---

## 8. Explicitly prohibited

- Starting Phase C before Gate Pass + design/inventory submission
- Global rewrite of unrelated gateway handlers “while here”
- Storing content bodies / embeddings / secrets in Catalog
- Dual writes during migration
- Implementing archive / restore / forget / purge / legal hold / tombstone propagation (P2)
- Claiming P1 complete without Gate A1–A3 evidence
- Weakening first-wave create-compensate or tenant isolation

---

## 9. Handoff to Codex

When implementation is green, update:

- `.kiro/specs/data-governance-v2-p1/codex-handoff.md` — tip SHA, Gate evidence pointer, test counts, residual risks
- `.kiro/specs/data-governance-v2-p1/tasks.md` — signed completion notes

P1-2 Phase C is **Accepted**. P2 planning/implementation may proceed under a dedicated P2 execution instruction.

---

## 10. Immediate next action for Cursor (this order’s first commit stream)

1. Unlock checklist items for **Phase A + Phase B only** in `tasks.md`.
2. Run / collect P1-2 Gate evidence → `gate-p1-2.md`.
3. Write `design-p1-wave2.md` + `inventory-p1-wave2.md`.
4. Stop and hand Gate + design package for review. **No Phase C code yet.**
