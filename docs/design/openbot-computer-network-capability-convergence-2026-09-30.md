# OpenBot Computer and Network Capability Architecture — Convergence and Execution-Readiness Review

> **Status:** Ratification + convergence map (companion to the v1.0 architecture proposal)
>
> **Date:** 2026-09-30
>
> **Reviews:** `openbot-computer-network-capability-architecture-2026-09-29.md` (authored in the `computer-network-architecture` worktree)
>
> **Purpose:** Decide whether the parent architecture's premises match OpenBot's current state, and define the only execution path that is both feasible and convergent with the existing (largely already-built, deliberately-gated) subsystems.

---

## 0. Verdict

**Approve the architecture as a north-star, reject any greenfield "Phase A–F build" reading of it.**

The proposal is directionally sound and consistent with OpenBot's positioning. But its framing — "OpenBot should evolve … into an Enterprise Digital Employee Operating System" presented through a fresh Phase A–F roadmap and a first-wave object list — reads as if these components do not yet exist. They largely **do**. A code and spec audit (2026-09-30) shows OpenBot already contains fragmented, mostly **dormant / default-off / unwired** implementations of nearly every component the document proposes.

Therefore:

- **Feasible:** yes, as a coordinating architecture that names the target and binds existing specs to it.
- **Convergent:** only if it is executed as **reconciliation over existing owners**, not as new stores, new grant formats, or a parallel policy plane. The proposal's own §19 already says this ("These projects should share the authority foundation rather than implementing separate approval stores and incompatible grant formats"). This review makes that binding explicit.
- **Not executable as a single code change.** It is a multi-quarter program touching dozens of specs, most gated OFF behind explicit approvals (ConversationTask activation, `ORCHESTRATION_LIVE_INVOKE`, `authorizeAgentInvocation` enforcement, execution-router shadow). Flipping any of those gates is out of scope for "adopt the architecture" and is governed by the repo's forward-only / approval rules.

---

## 1. Premise check — does the document's foundation match reality?

> **Five claims in this section are superseded. Read §9 before relying on it.**
> This was a point-in-time audit, and the point in time passed within the day: other
> agents landed work, and later sections of this same document corrected findings
> made here. §9 lists each stale claim against its current truth. The method in §1
> stands; five of its conclusions do not.

The document assumes OpenBot is "an enterprise agent control plane with tools" with existing "Gateway governance, capability grants, execution preflight, and node-side enforcement." That assumption is **correct**, and stronger than the document implies. Evidence below (all paths repo-root relative).

### 1.1 Capability Policy Plane (§6.2) — PARTIAL / FRAGMENTED

The tri-state decision idea (allow / require-approval / deny) exists, but as **four independent evaluators**, not one plane emitting `ALLOW_WITH_CAPABILITY / REQUIRE_APPROVAL / DENY`:

- `src/node-host/exec-policy.ts` — `evaluateSystemRunPolicy()` returns allow | `security=deny` | `approval-required` | `allowlist-miss`. Closest analogue, for shell/exec.
- `src/gateway/enterprise-data/approval-workflow.ts` — `checkApproval()` returns `ok` | `APPROVAL_REQUIRED` | `APPROVAL_EXPIRED` | `APPROVAL_INVALIDATED`, with context-snapshot digests (`buildApprovalContextSnapshot`, `snapshotsMatch`) that already implement drift detection.
- `src/gateway/governance-policy.ts` — `isGovernanceActionAllowed(subject, action, resource)` RBAC over roles × actions (`observe/read/write/invoke/pair/revoke/approve`) × resource kinds.
- `src/gateway/agent-invocation-governance.ts` — `evaluateAgentInvocation()`; note `authorizeAgentInvocation` is explicitly **"unwired in production until enforce is approved."**

### 1.2 Authorization primitives (§8)

- `CapabilityGrant` — **BUILT** as the data plane: `src/gateway/enterprise-data/capability-grant-resolver.ts` (`isCapabilityGrantedForSeat`), `SeatActionGrant`, `policy-backed-grant-resolver.ts`.
- `CapabilityDefinition` — **BUILT**: `src/gateway/enterprise-data/data-capability-store.ts` + capability registry entries in the governance store.
- `CapabilityProfile` — exists with different meaning (collaboration `GroupCapabilityProfile`, `EmployeeCapabilityProfile`), not authorization profiles.
- `InvocationCapability` (signed, single-use token) — **ABSENT.** Single-use _consumption_ exists (`consumeApprovalRequest`, `consumedTraceId`, PER_REQUEST mode) but there is no signed capability token minted/verified.
- Risk levels L0–L4 (§8.3) — **spec prose only** (`capability-governance-runtime`). Code has `low/medium/high` in `src/diagnosis/*`. No L0–L4 enum.
- Prepare-before-commit (§4.4) — **ABSENT as a generic protocol.** Analogues: approval `create → decide → consume`; `src/node-host/invoke-system-run-plan.ts` plan phase; `dryRunPreview` in `src/diagnosis/remediation.ts`.
- Approval objects (§8.4) — **BUILT, three times over:** `ApprovalRequest` (`src/gateway/enterprise-data/*`), `GovernanceApprovalRequest` (`governance-approval-store.ts`), `ExecApprovalRequest` (`src/infra/exec-approvals.ts`).
- Revocation epochs (§15.3) — **ABSENT** (only `status: "revoked"`).

### 1.3 Execution Router + node/computer control (§6.3, §9)

- **Naming collision:** the `execution-router-phase*` specs are a **Skill/Tool shadow retrieval router** — observation-only, `apply=false`, default-OFF (`.kiro/specs/execution-router-phase1/design.md`). They do **not** select execution targets.
- The device/target-selection concept exists as a **dormant kernel**: `src/task-orchestration/types.ts` defines `ExecutionSurface`, a `CAPABILITY_LADDER` (`memory → skill → connector → web_read → browser → node_fs_read → node_exec`), and a pure `routeStep`. But `ORCHESTRATION_LIVE_INVOKE = false` and all `OrchestrationFlags` default off.
- `src/routing/` is **message → agent** routing, unrelated.
- Local node execution surface: `src/node-host/runner.ts` advertises coarse caps `["system", "browser"]` and a fixed command list (`src/infra/node-commands.ts`: `system.run(.prepare)`, `system.which`, `system.execApprovals.*`, `browser.proxy`).
- Named node capability profiles (`local-files-readonly`, `local-desktop-observe`, §9.1) — **ABSENT.**
- Typed node commands (§9.2: file stat/list/read/create, screen capture, window observe, app launch) — **LARGELY ABSENT**; everything non-browser goes through generic shell `system.run`.
- Restricted shell (§9.4) — **BUILT and mature**: `src/node-host/exec-policy.ts`, `src/node-host/invoke-system-run-allowlist.ts`, security modes `deny|allowlist|full`, ask modes, cwd/timeout/env-sanitization, node-side independent re-evaluation before spawn.
- Browser bindings (§10.3) — **PARTIAL**: capability profiles (`src/browser/profile-capabilities.ts`), profile allowlist (`nodeHost.browserProxy.allowProfiles`), navigation/SSRF guard (`src/browser/navigation-guard.ts`). "allowed domains" exists only as an SSRF guard; "allowed agents" is not a browser concept.

### 1.4 Durable task runtime, triggers, identities, skills, memory (§6.4–6.5, §11, §12)

- **AutonomousTask (§6.4)** — decomposed across three modules, all **dormant**: `ConversationTask` (`src/conversation-task/`, sqlite store, 4-state `draft/active/closed/cancelled`, **forbids** execution state), `Progress Ledger` (`src/progress-ledger/`, rich step states + evidence whitelist + blocking gates + replan history — closest to "durable task w/ checkpoints + evidence"), Orchestration Plane (dispatcher). No unified 9-state object; **no per-task budgets**; checkpoints only as ledger `planVersion`/replan history.
- **Triggers (§6.5)** — **schedule (cron) + incoming-message only**. Connector-event / file-change / task-completion triggers ABSENT.
- **Operational identities (§11)** — **BUILT** for email + social providers (`src/gateway/user-operational-identity-types.ts`): owner scope, agent grants, revocation, credential handle/secret split. Calendar / browser / wallet ABSENT. **Budgets ABSENT.** Read-vs-mutate not structural (freeform `allowedActions: string[]`).
- **Skill lifecycle (§12.2)** — **MOSTLY BUILT** client-side: states `draft→…→published→…→retired` (`src/gateway/skill-lifecycle-store.ts`), health metrics, two-layer profile/runtime isolation, static security scan (`src/security/skill-scanner.ts`). Execution **sandbox ABSENT** (scan only); several review/publish gateway endpoints **unregistered**.
- **Memory layers (§12.1)** — tenant vs personal scopes only; the proposed 4-layer taxonomy (task/employee/tenant/operational-state) is not a first-class type.

---

## 2. Convergence map (proposal → existing owner)

Each proposed component MUST bind to the owner below. Building a new store/format instead is a fork and is rejected.

| Proposal component                       | Existing owner (spec / module)                                                                                                           | State                   | Convergence action                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Capability Policy Plane (§6.2)           | `capability-governance-runtime` spec; `exec-policy.ts`, `approval-workflow.ts`, `governance-policy.ts`, `agent-invocation-governance.ts` | Partial/fragmented      | Define one decision facade over the existing evaluators; do **not** add a 4th store.                             |
| CapabilityGrant / definitions (§7, §8.1) | `enterprise-data/capability-grant-resolver.ts`, `data-capability-store.ts`; `capability-lifecycle-closure`                               | Built                   | Extend semantic capability IDs onto existing grant model.                                                        |
| InvocationCapability signed token (§8.2) | none                                                                                                                                     | Absent                  | Genuine new primitive — candidate first slice (see §3).                                                          |
| Risk L0–L4 (§8.3)                        | `capability-governance-runtime` (prose)                                                                                                  | Specced                 | Reconcile with `diagnosis` low/med/high; pick one scale.                                                         |
| Prepare→commit (§4.4)                    | `invoke-system-run-plan.ts`, approval `create/decide/consume`, `remediation.ts` dryRun                                                   | Analogues               | Generalize existing plan/consume, don't invent parallel protocol.                                                |
| Approval object (§8.4)                   | `enterprise-data/approval-workflow.ts` (+2 others)                                                                                       | Built ×3                | **Unify the 3 approval stores** before adding capability approvals.                                              |
| Execution Router (§6.3)                  | `src/task-orchestration/` (dormant kernel)                                                                                               | Dormant                 | Reuse `CAPABILITY_LADDER`/`routeStep`; rename the doc's "Execution Router" to avoid the shadow-router collision. |
| Node capability profiles (§9.1)          | `src/node-host/runner.ts` caps                                                                                                           | Coarse only             | New: named read-only/observe profiles.                                                                           |
| Typed node commands (§9.2)               | `src/node-host/invoke.ts`                                                                                                                | Shell + which + browser | New typed file/observe commands — candidate slice.                                                               |
| Restricted shell (§9.4)                  | `node-host/exec-policy.ts`                                                                                                               | Built                   | No new work; treat as reference implementation.                                                                  |
| Browser bindings (§10.3)                 | `browser/profile-capabilities.ts`, `navigation-guard.ts`                                                                                 | Partial                 | Add per-session allowed-domains + allowed-agents.                                                                |
| Durable task (§6.4)                      | `conversation-task`, `progress-ledger`, `task-orchestration`                                                                             | Dormant                 | Do not mint a new task object; add budgets/checkpoints to existing chain.                                        |
| Triggers (§6.5)                          | `src/cron/`, `progress-ledger/cron-binding.ts`                                                                                           | Schedule+msg            | New trigger classes bind to cron/ledger, not a new engine.                                                       |
| Operational identities (§11)             | `user-operational-identity-*`, `operational-identity-governance`                                                                         | Built (subset)          | Add calendar/browser/wallet providers + budgets + read/mutate split.                                             |
| Skill lifecycle (§12)                    | `skill-lifecycle-store.ts`, `skill-lifecycle-asset-system`                                                                               | Mostly built            | Register missing gateway endpoints; add sandbox.                                                                 |

---

## 3. Feasible, convergent first slices (no gate flips, no forks)

These are the only actions that "execute the plan" without violating convergence or the repo's approval/forward-only governance. Each is additive, default-off, and owned by an existing spec.

1. **Semantic capability ID registry (docs + type, no enforcement).** Add the §7 taxonomy as stable identifiers mapped onto existing `DataCapability` / `SeatActionGrant`. Pure additive; no runtime change. Owner: `capability-governance-runtime` / `capability-lifecycle-closure`.
2. **Unify the risk scale.** Reconcile proposal L0–L4 with `diagnosis` `low/med/high` into one enum referenced by both, before any policy consumes it. Owner: `capability-governance-runtime`.
3. **Approval-store unification study.** One consolidation plan for the three approval implementations (`enterprise-data`, `governance-approval-store`, `exec-approvals`) — prerequisite to any "unified approval object" (§8.4). Owner: new sub-spec under existing governance.
4. **Signed single-use InvocationCapability (genuinely new).** The one primitive with no existing owner (§8.2). Can be prototyped as a signing/verification library consumed by the existing `consumeApprovalRequest` path, behind a default-off flag. Owner: new child spec sharing the authority foundation.
5. **Rename to remove the "Execution Router" collision.** In the parent doc, rename §6.3 to "Execution Target Router" and cite `src/task-orchestration` so it is not confused with the skill/tool shadow router.

Explicitly **out of scope** for adoption (require separate, approved decisions): flipping `ORCHESTRATION_LIVE_INVOKE`, enabling ConversationTask activation, wiring `authorizeAgentInvocation` enforcement, enabling execution-router live apply, adding typed node file/screen/app commands, any production/infrastructure capability (proposal §20 red lines + Phase E/F).

---

## 4. Recommended parent-doc amendments

To make the parent architecture converge cleanly, it should be amended (in its own worktree by its owner) to:

1. Add a "Current state" column to the §2.4 comparison and §17 object list marking each item Built / Partial / Dormant / Absent per §1 above.
2. Rename §6.3 "Execution Router" → "Execution Target Router" and disambiguate from the skill/tool shadow router.
3. Replace the Phase A "foundation" framing with "reconcile and unify existing foundations" and cite the §2 owners here.
4. State explicitly that no gated subsystem is enabled by adopting the architecture.

---

## 5. Bottom line for the maintainer

The plan is a good north-star and its premises fit OpenBot — better than it assumes, because most pieces already exist. It is **not** something to "run" end-to-end. Adopting it convergently means: bind it to the existing owners (§2), pick from the additive first slices (§3), and keep every dormant gate closed until its own spec's approval path opens it. This companion doc is the ratification and the guardrail that keeps the architecture from forking the very subsystems it depends on.

---

## 6. Recheck of the revised proposal (2026-09-30)

The proposal team revised the parent document (`bb698eea3` "Docs: align autonomy architecture with existing systems", +248/−94; spec row recorded in `c3c5fb0d0`). Re-reviewed against the four amendments in §4.

**Verdict: pass. Approved for adoption as north-star.** The revision is responsive and in several places stronger than what this review asked for.

### 6.1 Amendment compliance

| #   | Amendment                                           | Status                              | Evidence in revised doc                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Current-state markers on comparison + object list   | **Done**                            | New §3.1 "Current-state audit" (13-row concern → existing implementation → current state → required action); §17 retitled "Canonical objects and existing owners" with a per-object "Current implementation direction" column                                                                                                                                                                      |
| 2   | Rename §6.3 and disambiguate from the shadow router | **Substance done, rename not done** | Disambiguation is explicit (§3.1 routing row; §6.3 closing direction: task orchestration is "the target routing authority", "Execution-router observation modules remain evidence producers and must not become a second live router"; §20 red line "No second live execution router beside task-orchestration"). But the literal heading at §6.3 and the §5 diagram still read "Execution Router" |
| 3   | Replace greenfield Phase A–F framing                | **Done**                            | §18 is now "Convergence and enablement plan", Waves C0–C5, opening with "not greenfield product phases… convergence checkpoints over existing work"; §19 "First convergence workstreams… not permission to create five new vertical stacks"                                                                                                                                                        |
| 4   | State that adoption enables no gated subsystem      | **Done**                            | New §3.4 "Forward-only integration rule" (prohibits jumping from "code exists" to "live enabled", and prohibits parallel live paths that dodge a gate); Wave C2 "Keep ORCHESTRATION_LIVE_INVOKE false"; §23 closing line "They do not, by themselves, authorize dormant code to become live"                                                                                                       |

### 6.2 Additions beyond the review's asks (accepted)

- **§3.2 Convergence mandate** — every derived proposal must classify work as REUSE / ADAPT / WIRE / EXTEND / NEW_PRIMITIVE / RETIRE, with a code-owner matrix; `NEW_PRIMITIVE` is fail-closed and needs architecture approval. This is a better enforcement mechanism than the convergence table in §2 of this review.
- **§3.3** — "'Unified' does not mean one new monolithic service"; adapters must not silently weaken a domain denial.
- **§6.4** — "Durable Task Service" became **Canonical Task Projection**, and `AutonomousTask` became `AutonomousTaskProjection`, with "must not introduce another authoritative lifecycle enum" and "not a new source-of-truth table". This resolves the single largest fork risk this review raised.
- **§6.7 Convergence registry** — 8 fields (responsibility / currentOwners / canonicalOwner / mode / liveState / gate / parityEvidence / retirementTarget) and the rule "No implementation task starts without a registry row."
- **§8.2 / §8.3 / §8.4** — InvocationCapability named as the single approved new primitive, implemented once; L0–L4 explicitly "initially a north-star normalization layer" with no stored enum migration until parity is proven; approval object explicitly an envelope over existing families.
- **§20** gained six anti-fork red lines; **§21** grew from 10 to 15 criteria with convergence-specific ones; new **§23 Repository evidence**.

### 6.3 Corrections to this review (the revision was right, §1 above was wrong)

Verification of the revised doc's new claims surfaced two places where §1 of this document overstated an absence. Corrected here:

1. **Per-task budgets exist.** §1.4 said "no per-task budgets". Wrong as stated. `src/gateway/supervisor/budget.ts` implements exactly that: `buildTaskBudget` applies a tenant ceiling with per-task tightening (`resolveEffectiveBudget` — "task can only tighten, never loosen"), plus `accumulateSpentCost` and `ensureBudgetStarted`; `SupervisorBudget` carries `maxIterations` / `maxCostUsd` / `maxDurationMinutes`. The revised §3.1 phrasing — multiple domain budgets exist, but no single _per-task capability budget projection_ — is the accurate statement. The gap is aggregation, not existence.
2. **Typed node commands are far richer than reported.** §1.3 said typed node commands were "largely absent (only `system.which` + `browser.proxy`)". That was scoped to the desktop node-host list (`src/infra/node-commands.ts`) and wrongly generalized. `src/gateway/node-command-policy.ts` defines a substantial typed surface — `camera.list/snap/clip`, `screen.record`, `location.get`, `notifications.list/actions`, `device.info/status/permissions/health`, `contacts.search/add`, `calendar.events/add`, `reminders.list/add`, `photos.latest`, `motion.activity/pedometer`, `sms.send`, `canvas.*` — with per-platform scoping and a dangerous/high-risk classification. The revised §3.1 row ("Partial; file, accessibility, window and named capability profiles remain incomplete") is correct; the real gap is the **file / archive / window / accessibility / named-profile** set, which is exactly what Wave C3 targets.
3. **`routeStep` location.** It lives in `src/task-orchestration/surface-router.ts:184`, not `types.ts`. The revised §23 citation is accurate; the earlier attribution here was imprecise.

### 6.4 Remaining follow-ups (minor, non-blocking)

1. **§6.3 heading + §5 diagram still say "Execution Router."** The prose now disambiguates, so this is cosmetic, but the collision with the `.kiro/specs/execution-router-*` shadow-retrieval specs is the reason the rename was requested. Recommend "Execution Target Router" in both places.
2. **§7 capability taxonomy has no owner mapping.** §17 gained a "current implementation direction" column; §7 did not. Semantic IDs such as `local.screen.capture`, `local.app.launch` and `account.calendar.read` now have plausible existing counterparts (`screen.record`, `camera.snap`, `calendar.events/add` in `node-command-policy.ts`). Under the team's own §6.7 rule, each §7 identifier needs a registry row before Wave C3 so the taxonomy does not silently re-specify commands that already exist.
3. **§3.1 "Risk model" row should cite the node command policy.** It cites only the diagnosis low/medium/high scale. The dangerous / high-risk command classification in `src/gateway/node-command-policy.ts` is a live precursor to L0–L4 and should be listed as a current owner feeding the §8.3 mapping.

### 6.5 Status

The parent document is now a convergence architecture rather than a greenfield roadmap, and its factual baseline is accurate. The guardrail this review was written to enforce — do not fork the subsystems the architecture depends on — is now carried inside the parent document itself (§3.2, §6.7, §20). Adoption is approved on that basis; the three follow-ups above are editorial and can be folded into the next revision by the document owner.

---

## 7. Wave C1 implementation attempt: withdrawn to avoid a second mechanism (2026-09-30)

### 7.1 What happened

Acting on §3 of this review and the parent architecture's §19.1, I began implementing the
`InvocationCapability` primitive under `src/gateway/invocation-capability/` with a spec at
`.kiro/specs/invocation-capability/`. It reached a complete, green state: 81 passing tests,
clean `tsgo`, clean `oxlint`/`oxfmt`, and a mutation check in which all six security
invariants (scope boundary, revocation, prepared effect, expiry, signature, replay) were
killed by the suite.

**It was then deleted without landing.** A dependency audit found that the same primitive
already exists, landed, under `src/local-files/` — commits `663f3df17` ("LocalFiles:
capability protocol core for the local disk read grant") and `88f80105f` ("LocalFiles:
three-layer path denial and the readonly capability profile") — with an owning design doc,
`docs/design/openbot-local-disk-read-grant-2026-09-29.md`, and active uncommitted work in
progress by another agent.

Landing mine would have been precisely the fork that §3.2 (`NEW_PRIMITIVE` requires proof of
no existing owner) and §20 ("no second …") exist to prevent.

### 7.2 The two designs do not conflict — the duplication was at the mechanism level

An important distinction. The first draft of this section overstated the case by calling my
work simply "a duplicate", and that framing was wrong.

`openbot-local-disk-read-grant-2026-09-29.md` is a **scoped child** of the parent
architecture — it is §19 first slice #1, "Local file read grant". Its capability token is
deliberately local-files-shaped: it binds `canonicalPath`, `fileId` (`dev`/`ino`),
`targetKind`, `scope: "exact"` and a `LocalFilesOperation`, and its 非目标 list disclaims
being a general capability plane. The parent's §8.2 `InvocationCapability` is meant to be
**cross-cutting** — "consumed by adapters for node commands, connectors, browser actions,
outbound messaging and later transaction commits".

So the two designs are **complementary, parent and child. They do not conflict**, and the
_general_ primitive genuinely still has no owner. My spec's premise was not simply false.

What _was_ already owned is the **mechanism**: Ed25519 signing, canonical JSON, the keyset
with a pinned trust root, the nonce ledger, and the four-step redemption transaction. My
module reimplemented all of it in parallel, with zero consumers.

That is the accurate reason it should not land. Parent §8.2 says the primitive "should be
implemented once"; two independent signing and redemption implementations in one repository
means two sets of security properties to audit and two places to fix every bug. The
convergent path to the general primitive is **extraction from the landed implementation once a
second consumer exists** — the repository's "extract helpers instead of V2 copies" rule — not
a speculative parallel module built ahead of demand.

Corrected registry row:

| Field            | Corrected value                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| responsibility   | `invocation-capability`: single-use execution credential mechanism                                        |
| currentOwners    | `src/local-files/{capability,issue,redemption,nonce-ledger,keyset,canonical-json}.ts` (local-files scope) |
| canonicalOwner   | `src/local-files/` today; a shared owner only when a second consumer exists                               |
| mode             | `EXTEND` now, `ADAPT` at generalization — **not** `NEW_PRIMITIVE`                                         |
| liveState        | `dormant` (implemented and tested; production wiring not yet present)                                     |
| gate             | The local-disk-read-grant design's §8 step 7 acceptance and §10 evidence review                           |
| retirementTarget | none                                                                                                      |

### 7.3 Their implementation is stronger than mine — do not revisit these

Recorded so nobody re-litigates a settled comparison. The landed design is better on:

- **Ed25519 via existing `src/infra/device-identity.ts`** (`signDevicePayload` /
  `verifyDeviceSignature`) instead of my HMAC. Asymmetric, and it reuses existing infra,
  which is what convergence requires.
- **Redemption key = `kind + capabilityDigest + nonce + nodeId`**
  (`nonce-ledger.ts:buildRedemptionKey`) rather than my bare nonce. This separates the three
  token nonce spaces and prevents pre-poisoning a legitimate capability's nonce.
- **A real prepare→commit chain** of three token kinds (`resolve-ticket` →
  `turn-authorization` → `invocation`) rather than my single token with an opaque digest.
- **Richer binding**: authenticated connection's `devicePublicKey`, `nodeId`, parent
  authorization binding equality, and `fileId` `dev`/`ino` for TOCTOU protection.
- **Real budget accounting** via `turnAuthorizations.reserve(...)` spend decrement, versus my
  static admission check.
- **Revocation that already works at redeem time**: `verifyRedemption` re-checks
  `authorization.status === "revoked"`, so revoking a Turn authorization kills every derived
  invocation capability. My "revocation epochs" idea is therefore **not** a missing defense
  here; it is only a broader-scope convenience (see §7.5).
- **Clock-skew tolerance** (`CAPABILITY_CLOCK_SKEW_MS`) where I used strict comparison.
- Explicit split of `verifyRedemption` (no writes) from the redemption transaction, with a
  comment forbidding an `await` between verification and the writes — the same ordering
  insight as mine, better factored for testing.

### 7.4 RETRACTED: the nonce ledger durability "finding" was not a gap

An earlier draft of this section reported a verified design gap: that `NonceLedger`
(`src/local-files/nonce-ledger.ts`) holds consumption in an in-memory `Map`, so a restart of
the holding process within `expiresAtMs + clockSkewMs` would permit one replay, contradicting
parent §8.2's "survives executor restarts".

**That finding is withdrawn.** The child design already mandates exactly this durability.
`openbot-local-disk-read-grant-2026-09-29.md` §9.3, redemption step 5:

> 断线重连与进程重启都不清除 Gateway 上未过期的已消费记录。

and the signing/key table's 保存时长 row:

> nonce 至少保存到对应令牌 `expiresAt` 加时钟偏差。过期后 Gateway 删除。节点不持久化 nonce

It is also a named P0 in §9.7 ("不得退回 … 节点内存 nonce") and an explicit §10.1 evidence
item ("兑换事务 … 事务边界的证明").

So the design is already correct on this point. What I actually observed is an **in-flight
implementation that has not yet reached its own requirement**: `NonceLedger` is a prototype
class whose only instantiation is in `redemption.test.ts`, and the Gateway redemption wiring
that would need the durable store does not exist yet. That is ordinary unfinished work on an
approved design, not a defect, and the design's own §10 evidence gate is positioned to catch
it before step 7 acceptance.

No action is required from me, and nothing should be filed against the owning agent. The
technique from my deleted module (`fs.openSync(path, "wx")` — `O_CREAT | O_EXCL`, atomic
across processes and durable across restart, keyed on the existing `buildRedemptionKey`
output) remains available if useful, but the storage choice is the owner's to make and the
repository's `CONFIG_DIR` JSON store convention may fit better.

**Process note on this error.** I reported a gap against another agent's work after reading
their _code_ but not their _design_. The design answered it explicitly. Read the owning design
document before asserting that implemented code is deficient.

### 7.5 Deferred, only when a second consumer appears

These are real gaps in the _general_ primitive but not in the local-files scope it currently
serves. They should be handled by extraction from the landed implementation, not by a parallel
general module — the repository's "extract helpers instead of V2 copies" rule applies:

- **Bounded (prefix) resource scope.** The landed claims hardcode `scope: "exact"`. To be
  clear, that is a deliberate non-goal of the child design, not an oversight — it rejects
  directory-level and long-lived directory grants outright (§9.4). But any _future_
  capability that does need a bounded scope will need separator-aware containment, and plain
  `startsWith` is unsafe there: a grant for `/home/u/docs` must not cover `/home/u/docs-secret`.
- **Bulk revocation.** Today revocation is per-Turn-authorization plus keyset removal, both of
  which work. What has no mechanism is the middle ground: "revoke everything for this tenant /
  agent / device" without removing a signing key. Epochs are one way; not needed at current scope.
- **Budget dimensions that are not declared.** Worth deciding explicitly whether an undeclared
  dimension means unconstrained or denied; §4.7 argues for denied.

### 7.6 Process lessons

Three, all mine:

1. **Re-verify `NEW_PRIMITIVE` immediately before implementing, never from an audit snapshot.**
   In a shared tree with concurrent agents, a day-old "no owner" finding is not a fact. The
   cheap check that would have caught this before any code was written:
   `git log --oneline -5 -- <target area>` plus a repository-wide grep for the concept name.
2. **Read the owning design document before reporting that implemented code is deficient.** I
   raised a durability gap from reading the code alone; the design had already specified the
   requirement, and the code was simply mid-flight. Code without its design is not enough
   evidence to allege a defect in someone else's work.
3. **Read a subsystem's own README before reverse-engineering it from source.** Landing the
   Wave C0 work cost several wasted cycles: I edited `LEGACY_RULES` in
   `scripts/worktree-audit.ts` and it had no effect, then assumed `pnpm loom register` would
   make files landable. Both answers were already in `.loom/README.md`, which states that
   `worktree-audit.ts` reads `landingStreams`, that `LEGACY_RULES` is "a dead fallback", that
   landing rules are hand-edited in `registry.yaml`, and which gives a commit-boundary routine
   (`loom unattributed --staged`, then `loom claim --staged`). The code has since been annotated
   so the next reader is redirected, but the lesson stands.

The pattern across all three is one habit, not three: I treated code as the source of truth
when a document already held the answer. For governance and landing mechanics specifically,
the document is authoritative and the code is downstream of it.

---

## 8. Wave C0 delivered: the convergence registry (2026-09-30)

§6.7 of the parent architecture requires a machine-readable convergence registry and states
"no implementation task starts without a registry row." That artifact did not exist. It does
now:

- **`docs/design/convergence-registry.yaml`** — 18 responsibilities, each with the eight §6.7
  fields (`responsibility`, `currentOwners`, `canonicalOwner`, `mode`, `liveState`, `gate`,
  `parityEvidence`, `retirementTarget`).
- **`scripts/check-convergence-registry.ts`** — the validator, wired as
  `pnpm lint:convergence:registry` and added to the end of the `pnpm check` chain.
- **`scripts/check-convergence-registry.test.ts`** — 22 tests over the rules.

### 8.1 Why a validator and not just a table

§3.2 declares `NEW_PRIMITIVE` "fail-closed and requires explicit architecture approval", but
as prose that is a review convention someone can forget. This session is the proof: I
classified `invocation-capability` as a new primitive from a one-day-old audit snapshot and
built a complete duplicate of a mechanism that had already landed.

Two machine-enforced rules close that hole:

1. **`mode: new-primitive` is only legal when `currentOwners` is empty.** Declaring an owner
   and a new primitive in the same row is now a build failure with an actionable message.
2. **Every declared owner path must exist on disk.** A registry whose ownership claims have
   gone stale is worse than no registry, because it is trusted. Path verification while
   populating the registry immediately caught one wrong path I had carried from an earlier
   audit (`governance-approval-store.ts` is under `enterprise-data/`, not `gateway/`).

Supporting rules: mode and `liveState` enums, unique responsibility ids, no blank governance
fields, `retire` requires a concrete target, and invalid YAML reports rather than throws.

Verified end to end by replaying the original mistake as a registry row — a
`new-primitive` claim alongside the two real `src/local-files/` owners. The checker rejected
it and named both owners. The guardrail would have stopped this session's wasted cycle before
any code was written.

### 8.2 How to use it

Before implementing anything from the parent architecture:

1. Find the row for the responsibility, or add one.
2. Re-verify `currentOwners` against the tree right then — `git log --oneline -5 -- <area>` plus
   a grep for the concept name. A day-old finding is not a fact in a shared tree.
3. Classify honestly. If owners exist, the mode is `reuse`, `adapt`, `wire` or `extend` — not
   `new-primitive`.
4. Run `pnpm lint:convergence:registry`.

`liveState` describes the canonical contract, not the busiest current owner: `missing` means no
unified contract exists yet even when the constituent parts are live. That is why
`capability-policy-decision` is `missing` while all four of its authorities are live.

### 8.3 What the registry says about what remains

Reading the 18 rows, the honest state of the architecture today:

- `live` and reusable as-is: restricted shell, capability grants, typed node commands, task
  budgets, operational identities, browser bindings, triggers, skill lifecycle.
- `dormant`, awaiting their own gates: invocation capability and its keyset, execution target
  router, durable task projection, execution evidence, local device capability profiles.
- `missing`, i.e. genuinely unbuilt contracts: the canonical policy decision, the approval
  envelope, risk normalization, and prepared-effect.

The four `missing` rows are Wave C1's real remaining scope, and all four are `adapt` over
existing authorities — none is a new primitive. `capability-policy-decision` is the natural
next workstream (§19.2), and its `canonicalOwner` is deliberately left `unassigned` until
someone signs in to own it.

---

## 9. Closure: corrections to §1, and the state this work leaves behind

This section closes the `computer-network-capability-architecture` review task. §1 was an
audit snapshot that aged within the day, partly because other agents landed work and partly
because I verified things later that I had asserted earlier. Anyone reading §1 first would
get a materially wrong picture, so the corrections are collected here rather than left
scattered across §6 to §8.

### 9.1 Superseded claims in §1

| §1 claim                                                                         | Current truth                                                                                                                                                                                                                                   | Corrected in                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Capability Policy Plane is "PARTIAL / FRAGMENTED … no module that unifies these" | `src/gateway/governance/` is that module: `GovernanceEffect` = allow / deny / approval_required / skipped, a `legacy → shadow → enforced` ladder whose default type excludes `enforced`, seven adapters, and a D0–D6 shadow divergence taxonomy | registry row `capability-policy-decision`, commit `e9c2793ca` |
| `InvocationCapability` (signed, single-use token) — "ABSENT"                     | Exists in `src/local-files/` (Ed25519, canonical JSON, keyset with pinned trust root, nonce ledger, four-step redemption)                                                                                                                       | §7.2                                                          |
| Risk levels L0–L4 — "spec prose only … No L0–L4 enum"                            | `src/capability-risk/` holds the enum and five adapters binding to the real source classifications                                                                                                                                              | commit `6d57f0386`                                            |
| Named node capability profiles (`local-files-readonly`) — "ABSENT"               | Shipped as `LOCAL_FILES_READONLY_PROFILE` with the five-way connection-identity match                                                                                                                                                           | local-files slice                                             |
| Typed node commands — "LARGELY ABSENT"                                           | `src/gateway/node-command-policy.ts` already carries a substantial typed surface with a dangerous-command split; the real gap is file, window, accessibility and named profiles                                                                 | §6.3                                                          |

Claims in §1 that were re-verified and **stand**: prepare-before-commit is still absent as a
generic protocol; the approval object still exists three times over; revocation epochs still
do not exist; the `execution-router-*` naming collision was real.

### 9.2 What this task delivered

| Deliverable                                                                                                                  | Landed as (original commit)                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Wave C0 convergence registry + validator enforcing fail-closed `new-primitive`, wired into `pnpm check`                      | #242 (`f05574aee`, `48c32226f`)                      |
| L0–L4 risk normalization with adapters bound to the real source enums                                                        | #242 (`6d57f0386`)                                   |
| Capability taxonomy as code, with predecessors checked against live command constants                                        | #242 (`e0f349436`)                                   |
| Audit discoverability: `LEGACY_RULES` is inert, and the unmatched error now names the fix                                    | #237 (`151310374`)                                   |
| `@openbot/evolution-core` declared as a UI dependency                                                                        | #237 (`ae0945648`)                                   |
| `local-files` CLI reference page, closing an open acceptance item for that task                                              | #261 (`d5e70c40a`)                                   |
| Handoff: the landing audit ignores `sharedPaths`                                                                             | #237 (`9d37f66dd`)                                   |
| Confirmation hash: nested payload fields were not bound, and #244's fix collided an omitted field with `Infinity` (see §9.5) | #244, then #262; together they supersede `b63de6b9c` |
| Registry correction plus the note on what validation cannot catch                                                            | #242 (`e9c2793ca`)                                   |

Two deliverables were **withdrawn rather than landed**, which was the correct outcome in both
cases: a complete, green `InvocationCapability` module (duplicated a landed mechanism) and a
`SHARED` landing stream (duplicated the existing `sharedPaths`).

### 9.3 Registry state at closure

19 responsibilities: 8 `live`, 8 `dormant`, 1 `shadow`, 2 `missing`.

The two `missing` rows are the honest remaining scope, and neither is a new primitive:

- **`prepared-effect`** — extract from `steward-confirmation-store`'s payload digest, or add the
  `preparedEffectDigest` that `src/gateway/approval-lifecycle.ts` deliberately lacks. That file
  was created today by the local-disk-read-grant task.
- **`approval-envelope`** — requires unifying three approval stores first (`enterprise-data`,
  `governance-approval-store`, `infra/exec-approvals`), each with a different owner.

Both touch files other agents are actively writing, so both are coordination work, not solo
implementation. That is the correct place to stop.

### 9.4 The honest pattern across this task

Five times I reached a conclusion and then reversed it after looking harder: the duplicate
`InvocationCapability`, the retracted nonce-ledger finding, the misattributed landing-mechanism
lesson, the `LDRG`-narrowing recommendation, and a `missing` row in my own registry that was
wrong. Four of the five were the same error — treating code as the source of truth when a
document already held the answer, or treating a day-old audit as a fact in a tree where other
agents commit every few minutes.

The registry and its validator exist because of that error. The validator proves every declared
owner path exists, which is why no stale owner path survived; it cannot prove a `missing` claim,
which is why one false `missing` did. That asymmetry is recorded in the registry header so the
next author verifies absence by grep and directory skim rather than inheriting it.

Net code contribution is small on purpose. The two largest things I built were deleted, and the
single highest-value change was six lines fixing a hash that could not see nested fields. Those
six lines then shipped a regression of their own; see §9.5.

### 9.5 State on `main` (2026-10-01)

Commit hashes in this document refer to the shared working repository and do not resolve on
GitHub. My commits reached `main` only as the squash merges listed in §9.2. Two other hashes,
`bb698eea3` and `c3c5fb0d0` in §6, are on no branch at all.

`src/local-files/` and `src/gateway/approval-lifecycle.ts` reached `main` in #261, which also
promoted them from `pendingOwners` to `currentOwners`. Before that, where §7 to §9 call the
mechanism "landed", it meant "committed on the local-disk-read-grant branch".

The confirmation hash had two defects, and this section has now been corrected twice.

- **The nested-value defect was latent.** That corrects #244's commit message, which called it
  a live bypass. Every steward action that requires confirmation builds flat params. The
  collab dispatch payload is rebuilt from the stored record, whose `timeWindow` is only written
  at creation.
- **#244's own fix introduced a live defect, with low impact.** `stableStringify` writes
  `undefined` as `null`, and JSON writes a non-finite number the same way. The gateway's
  `JSON.parse` turns a client-sent `1e999` into `Infinity`. So a `budget.set` ticket confirmed
  without `alertThreshold` would also execute with `alertThreshold: 1e999`, which resets a stored
  threshold to the default.

The first version of this section said only the first point. #262 fixed the second, with a
consume-level test through the real `budget.set` builder.
