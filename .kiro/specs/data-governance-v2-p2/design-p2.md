# P2 Design Checklist — Lifecycle Command (Round 4)

**Status:** Revised for Codex Gate Round 4  
**Gate:** `gate-p2.md`  
**Scope change vs Round 3:** three P0 semantic freezes only (hold vs active op; logical marker; purge identity)

## 1. Envelope additions

```ts
type ActorRef =
  | { kind: "user"; userId: string }
  | { kind: "operator"; operatorId: string }
  | { kind: "worker"; workerId: string }
  | { kind: "system"; systemId: string };

type LifecycleCommand =
  | "archive"
  | "restore"
  | "retire"
  | "applyLegalHold"
  | "releaseLegalHold"
  | "requestPurge"
  | "cancelDeletion"
  | "forget"
  | "resumePurge"; // internal / worker continue — not a new Catalog active-op owner

// DataGovernanceEnvelope:
legalHold?: { holdId; reason; appliedBy; appliedAt; releasedAt? } | null;

activeLifecycleOperation?: {
  operationId: string;
  command: LifecycleCommand; // long-running open command only
  receiptId: string;
  previousLifecycleState: LifecycleState;
  startedAt: string;
} | null;

// LifecycleState += "deletion_pending"
```

`projection` must not carry hold, active op, or deletion authority.

### Who sets `activeLifecycleOperation`

| Command class                                                           | Sets / clears active op?                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| archive / restore / forget / requestPurge (and complete/cancel of same) | Yes — exclusive slot                                               |
| applyLegalHold / releaseLegalHold                                       | **No** — short CAS; independent completed receipt                  |
| resumePurge                                                             | Match existing purge active op; never replace with new operationId |

## 2. Protocol

```text
# Long-running
authorize → preflight
  → unique-create receipt(operationId, requestFingerprint, requestedBy)
  → CAS set activeLifecycleOperation
  → domain / stages / resumePurge attempts…
  → finalize clear active op | recovery_required

# Hold (may run while active op present)
authorize → unique-create hold receipt(operationId, fingerprint)
  → CAS legalHold + governanceVersion++ (preserve activeLifecycleOperation)
  → receipt completed
  # prior deletion markers logically invalid via version bump
```

Resolver: `activeLifecycleOperation != null` ⇒ deny writes (policy-denied reads) even if business lifecycle unchanged.

## 3. Idempotency

- Receipt store: atomic unique create on `operationId`.
- Immutable `requestFingerprint`.
- Replay iff fingerprint identical; else `idempotent_mismatch`.
- Hold receipts are separate operationIds; they do not become active ops.

## 4. Hold × deletion_pending × markers

- `requestPurge`: Catalog → `deletion_pending` + active op + open receipt; **no** marker.
- `applyHold` on `deletion_pending`: preserve purge active op; update `legalHold` + version; markers **logically** invalid.
- `releaseHold`: clear hold; remain `deletion_pending`; active purge op unchanged.
- `cancelDeletion`: restore previous state; clear active op; **keep** hold.
- Physical marker unlink = cleanup; failure does not re-authorize.

### Marker validity (all required)

```text
lifecycleState == deletion_pending
&& !activeLegalHold
&& activeLifecycleOperation.operationId == marker.operationId
&& catalog.governanceVersion == marker.governanceVersion
&& !marker.expired
&& marker.attemptId == current receipt attempt
```

Re-read Catalog before every destructive adapter call.

## 5. Purge identity

```text
requestPurge → primary operationId + closure receipt (requestedBy)
resumePurge(operationId, attemptId) → same receipt; append executedBy / stage actor
  → issue short-lived marker bound to (operationId, attemptId, governanceVersion)
  → erase stages → purged + clear active op
```

External `dataGovernance.lifecycle.purge` may schedule; internal path is `resumePurge`. Worker must not open a second lifecycle operationId.

## 6. Conversation two-phase bridge

Unchanged from Round 3: domain verify before Catalog target state; active op blocks writes in phase 1–2.

## 7. Receipt schema (min)

```ts
{
  operationId: string;
  requestFingerprint: string;
  command: LifecycleCommand;
  resourceId: string;
  resourceType: GovernedResourceType;
  tenantId: string | null;
  requestedBy: ActorRef;
  executedBy: ActorRef[];
  previousLifecycleState: LifecycleState;
  legalHoldSnapshot?: DataGovernanceEnvelope["legalHold"];
  stages: Array<{
    stage: string;
    status: "pending" | "running" | "succeeded" | "failed" | "not_applicable";
    attemptId: string;
    attempt: number;
    actor?: ActorRef;
    targetBindingIds: string[];
    startedAt?: string;
    completedAt?: string;
    errorCode?: string;
  }>;
  status: "open" | "completed" | "failed" | "cancelled";
}
```

## 8. Per-type / cloud / auth

Narrow scope and cloud/outbox fail-closed unchanged. Auth: owner request/cancel; hold operators; purge execute = worker path via resumePurge.
