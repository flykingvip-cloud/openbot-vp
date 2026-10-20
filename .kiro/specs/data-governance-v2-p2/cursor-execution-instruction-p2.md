# Cursor Execution Instruction: Data Governance v2 — P2 Lifecycle Command

> **Executor:** Cursor (`cursor-data-governance`)  
> **Acceptance owner:** `codex-data-governance`  
> **Phase C coding:** **UNLOCKED** (Gate Round-4 Pass)  
> **Prerequisite:** P1-2 Accepted (`5779ffb1e4`)  
> **Hard constraints:** `gate-p2.md` Round 4 (frozen)

## 0. Sequence

```text
Gate Round 4 Pass ✓
  → P2-a: Envelope + CAS API + receipt fingerprint + logical deletion marker + resumePurge  ← done
  → P2-b: conversation_archive two-phase + hold/request/cancel + resumePurge  ← done
  → P2-c: memory forget  ← Accepted
  → P2-d: purge closure stages (no success stubs)  ← CR3 resubmitted (trusted tenant root)
  → P2-e: adapter contracts (four types)  ← narrow contract accepted
  → P2 final acceptance package  ← Changes Required on P2-d; a/b/c remain Accepted (not claimed)
```

## 1. Attribution

```text
Task: data-governance-v2-p2
Agent: cursor-data-governance
```

## 2. P2-a (this drop)

Implement foundation only. Acceptance tests must cover:

1. concurrent version conflict
2. active operation mismatch
3. operation fingerprint mismatch
4. hold preserves purge active operation
5. Catalog version change invalidates leftover marker
6. second purge operation cannot steal slot
7. worker continues only original operation
8. restart recover from Catalog + receipt or recovery_required

Gate Pass ≠ P2 Accepted. Next Codex review = P2-a implementation package.
