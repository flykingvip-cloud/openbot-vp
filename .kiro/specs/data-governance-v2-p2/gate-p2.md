# P2 Gate Evidence Package — Lifecycle Command (Round 4)

**Status:** **Gate Pass** (Codex Round 4) — Phase C unlocked  
**Executor:** `cursor-data-governance`  
**Acceptance:** `codex-data-governance`  
**Depends on:** P1-2 Accepted (`5779ffb1e4`)  
**Supersedes:** Round-3 Gate — revise in place for three interrelated P0 semantic conflicts only

## Locked decisions (still valid)

| Decision                                           | Conclusion                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Hold / deletion encoding                           | **H2 + D1**                                                                                                              |
| First vertical slice                               | **`conversation_archive`**                                                                                               |
| Strong-typed `activeLifecycleOperation`            | Accepted (Round 3 F1)                                                                                                    |
| `requestFingerprint` + unique `operationId` create | Accepted (Round 3 F2)                                                                                                    |
| Conversation two-phase archive/restore             | Accepted (Round 3 F4)                                                                                                    |
| Cloud tombstone                                    | No target → evidenced `not_applicable`; mirror without adapter → fail closed; **no success stub**                        |
| Receipt stage status schema                        | Accepted                                                                                                                 |
| Narrowed P2 scope                                  | CA full + memory forget; other four = adapter contract only                                                              |
| Auth matrix shape                                  | Owner requestPurge/cancel/archive/restore/forget; Hold = platform/compliance; Purge execute = worker/compliance/platform |

---

## A1. Lifecycle state + legal hold (H2 + D1)

### A1.1 `LifecycleState`

Add **`deletion_pending`**: persistent, listable, resolver-denies normal access, survives restart.

### A1.2 `legalHold` (Envelope strong field, not projection)

```ts
legalHold?: {
  holdId: string;
  reason: string;
  appliedBy: ActorRef;
  appliedAt: string;
  releasedAt?: string;
} | null;
```

Active hold (`holdId` set, `releasedAt` absent) blocks destructive side effects.

### A1.3 `activeLifecycleOperation` — long-running commands only (Round-4 freeze)

```ts
activeLifecycleOperation?: {
  operationId: string;
  command: LifecycleCommand; // long-running only: archive|restore|retire|requestPurge|forget (command at open)
  receiptId: string;
  previousLifecycleState: LifecycleState;
  startedAt: string;
} | null;
```

**Occupiers of `activeLifecycleOperation` (at most one per resource):**  
`requestPurge`, `archive`, `restore`, `forget`, and the continuing purge execution of that same primary op (see A3).  
Also any other long-running lifecycle command that opens an in-flight flow.

**Not occupiers — short CAS policy commands:**  
`applyLegalHold` / `releaseLegalHold`:

1. Create an **independent completed** receipt (own `operationId` + `requestFingerprint`; unique-create rules still apply).
2. CAS-update `legalHold` + bump `governanceVersion` only.
3. **Must not** set, replace, or clear an existing `activeLifecycleOperation`.
4. On `deletion_pending` with an open purge: **preserve** the `requestPurge` active op (operationId / receiptId / previousLifecycleState intact); only mutate `legalHold` + version.
5. Hold `operationId` remains uniquely fingerprinted but is **never** the resource’s active lifecycle operation.

**Match rules for long-running resume:**  
`cancelDeletion`, `resumePurge`, and destructive worker steps **must match** `activeLifecycleOperation.operationId` (and receipt as applicable). Mismatch → `active_operation_mismatch` / deny.  
On successful complete or successful cancel of the **primary** long-running op, clear `activeLifecycleOperation` via the same CAS write.

Resolver: while `activeLifecycleOperation` is set, deny writes (and policy-denied reads) even if business `lifecycleState` has not flipped yet (two-phase archive).

### A1.4 Transition matrix — deletion_pending × hold (refined Round 4)

| From \ Command              | applyHold / releaseHold                                                                                                                             | requestPurge                                                                  | worker resumePurge (destructive)                                 | cancelDeletion                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| active / archived / retired | short CAS; completed hold receipt; **no** active-op change                                                                                          | → `deletion_pending` + set active op (`requestPurge`); **no** deletion marker | —                                                                | —                                                                              |
| deletion_pending            | **allow**; short CAS; **preserve** purge active op; bump version (logical marker invalidate); releaseHold clears hold only, stay `deletion_pending` | deny (already pending)                                                        | **deny if hold active**; else attempt after re-read Catalog (A2) | → `previousLifecycleState` from active op; clear active op; **hold preserved** |
| purged                      | deny                                                                                                                                                | deny                                                                          | —                                                                | —                                                                              |

---

## A2. Deletion marker — logical validity (Round-4 freeze)

Catalog and on-disk marker files are **two persistence media**. Gate **does not** require atomic multi-media delete of all marker files when `applyHold` succeeds.

**Logical invalidation (authoritative):**

1. Marker binds at issue time: `governanceVersion`, `operationId` (= active purge op), `attemptId`, resourceId, binding/locator, expiry.
2. Before every destructive adapter call, worker **re-reads Catalog**.
3. Marker is valid **only if all** hold:
   - Catalog `lifecycleState === deletion_pending`
   - no active legal hold
   - Catalog `activeLifecycleOperation.operationId` equals marker `operationId`
   - Catalog `governanceVersion` equals marker `governanceVersion`
   - marker not expired
   - `attemptId` matches the current receipt attempt
4. `applyHold` CAS **increments `governanceVersion`** ⇒ all prior markers become immediately logically invalid even if files remain.
5. Physical marker file delete is **cleanup only**. Cleanup failure **must not** resurrect an old marker.
6. Consequence: the window “Catalog hold succeeded, marker file not yet deleted” **cannot** authorize erase — re-read fails version/hold checks.

---

## A3. Purge identity — one primary operation (Round-4 freeze)

| Role             | Identity                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestPurge`   | Creates the **primary** `operationId` + open **closure receipt**; sets `activeLifecycleOperation` (`command` reflecting purge request, e.g. `requestPurge`); **no** deletion marker                                     |
| Worker execute   | **Does not** create a second lifecycle operation; **continues** the same primary `operationId` / receipt                                                                                                                |
| Each worker run  | Distinct **`attemptId`**; writes receipt stage rows + short-lived marker bound to `(operationId, attemptId, governanceVersion)`                                                                                         |
| External RPC     | `dataGovernance.lifecycle.purge` may **schedule/trigger** worker, but internal execute path is **`resumePurge(operationId, attemptId)`** — never a new lifecycle `operationId` that replaces `activeLifecycleOperation` |
| `cancelDeletion` | Cancels the **primary** operation only (clear active op, restore previous state); in-flight attempts stop because version/active-op/hold checks fail and markers are logically invalid                                  |

**Receipt actors (min):**

```ts
requestedBy: ActorRef;
executedBy: ActorRef[]; // or per-stage actor on each stage/attempt
```

Worker must not replace `activeLifecycleOperation` via a new purge `operationId`.

---

## A4. Controlled transition API + fingerprint (retained + hold carve-out)

```ts
transitionCatalogLifecycleCommand(params: {
  resourceId: string;
  command: LifecycleCommand;
  expectedStates: LifecycleState[];
  expectedGovernanceVersion: number;
  operationId: string;
  // long-running: set/match/clear activeLifecycleOperation
  // hold: mutate legalHold only; never replace activeLifecycleOperation
}): Promise<TransitionResult>
```

Conflicts include: `not_found | state_conflict | version_conflict | legal_hold_blocks | command_not_allowed | idempotent_mismatch | active_operation_mismatch`.

Receipt Store: unique create on `operationId` + immutable `requestFingerprint` (Round 3). Hold receipts use their own operationId/fingerprint; long-running primary ops likewise. Fingerprint delta → `idempotent_mismatch`.

---

## A5. Conversation dual-plane — two-phase (unchanged Round 3)

Forbidden: Catalog → `archived` / `active` before domain verified.  
Phase 1: receipt + active op; business lifecycle unchanged; writes denied.  
Phase 2: domain + verify.  
Phase 3: CAS to target lifecycle; clear active op.  
Fail: prior lifecycle or `recovery_required` + reconcile.

Purge: `requestPurge` as A3; worker via `resumePurge` + logical markers (A2).

---

## A6. Closure receipt — stages + fingerprint + actors

Stage status objects + `previousLifecycleState` + immutable `requestFingerprint`.  
Add `requestedBy` and `executedBy[]` (or per-stage actor).  
Cloud/outbox policy unchanged (fail-closed).

---

## A7. Authorization matrix — refined naming

Owner: archive / restore / forget / `requestPurge` / `cancelDeletion` (tenant-scoped).  
Hold: platform / compliance operator (`applyLegalHold` / `releaseLegalHold`).  
Purge **execute**: worker / compliance / platform via schedule RPC or `resumePurge`; **not** a second owner-created lifecycle op.  
Receipts: tenant-filtered.

---

## A8. P2 completion scope — unchanged

conversation_archive full lifecycle; memory forget slice; other four = adapter contract + matrix only.

---

## Gate Round-4 verdict request

| Gap                                   | Round-4 freeze                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| applyHold vs unique active op         | Hold = short CAS + completed receipt; never replaces purge/archive/… active op           |
| Marker “atomic invalidate”            | Logical validity via governanceVersion / active op / attempt; file delete = cleanup only |
| requestPurge vs worker purge identity | One primary operationId; worker `resumePurge(operationId, attemptId)` continues receipt  |

**Verdict:** Gate Pass. Phase C unlocked. Next submission = P2-a implementation acceptance package (≠ P2 Accepted).
