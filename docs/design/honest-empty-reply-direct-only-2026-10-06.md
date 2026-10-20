# Honest empty reply: private chat only (2026-10-06)

Follow-up to the transcript re-root fix (PR-A / #355). That fix removed the root
cause of the market-assistant incident. This change covers the user-facing
symptom: a private chat turn that ends with nothing delivered — and wires the
resulting capability gap into the **existing** evolution control plane **closed
loop** (not a write-only log).

## Principle

Silence is a legitimate outcome in **group chats, channels, collaboration
rounds, and internal/system/cron/inter-session turns**. A collaboration
`NO_REPLY` ("nothing to add this round") or a group "nothing to say" is a valid
answer and must stay silent.

Only a **private (direct) chat turn started by the user**, where **nothing at
all reached the user**, gets an honest fallback instead of a blank screen.

User Stop (`/stop`, `chat.abort`) and emoji-reaction-only turns also stay
silent: abort is user-initiated; a reaction is delivery.

## Decision (`decideHonestEmptyReply`)

Runs only when `runReplyAgent` has nothing left to send. Emits the fallback only
if **all** exemptions are ruled out:

| Check                                              | Skip reason                |
| -------------------------------------------------- | -------------------------- |
| run aborted (user Stop / chat.abort)               | `user_aborted`             |
| not a heartbeat                                    | `heartbeat`                |
| no collab ids / round / bot agent                  | `collaboration`            |
| `ChatType` normalizes to `direct` (unknown → skip) | `not_direct_chat`          |
| no group subject/channel/space                     | `group_context`            |
| provenance absent or `external_user`               | `non_user_provenance`      |
| no block stream / direct flush                     | `block_stream_delivered`   |
| no tool-result delivery                            | `tool_result_delivered`    |
| no emoji reaction delivered                        | `reaction_delivered`       |
| no messaging-tool send                             | `messaging_tool_delivered` |
| raw payloads had nothing visible                   | `visible_payload_filtered` |

Fallback text (zh/en) briefly states **what was missing** and the **next step**.

## Growth / operational outcome (same decision)

`classifySilentTurnGrowthOutcome(decision)` is the single source of truth:

- `emit: true` → `recordRunOutcome(success=false)` (capability failure)
- any skip (group/collab/heartbeat/abort/reaction/streamed/tool/system) →
  `success=true` (not-failure)

`agent-runner` commits growth success **after** language-gate filtering. A turn
whose language gate empties every reply (with no tool placeholder) is **not**
success and does **not** close gaps.

## Evolution loop map (real closed loop)

```
signal (assistant-authored only; best-effort try/catch)
  ├─ [[capability_gap:skill|tool|perception:detail≤64]] marker
  │     → recordCapabilityGapEvent(explicitMarker) → DISCOVERED proposal
  ├─ plain empty private fallback
  │     → metric/counter only (NO proposal per session)
  └─ unresolved run error (non-infra / non-rate-limit / non-auth / non-billing)
        → DISCOVERED proposal (tool|perception)
        │
        ▼
capability-gap-consumer  (evolution-governance scheduler tick; OFF reply path)
  ├─ expire stale DISCOVERED (state-machine DISCOVERED:expire + ledger)
  ├─ promote empty-reply counters past threshold (≥2) → DISCOVERED
  └─ aggregate by tenant+agent+category+reason; act past threshold
        (≥1 explicit marker OR ≥2 occurrences)
        │
        ├─ skill      → saveSkillAsset({lifecycle:"draft"})  [learning-skill-curation sink]
        │               link draftSkillId on candidate → suggestProposal (DISCOVERED→SUGGESTED)
        ├─ tool       → capability-governance submitProposal → suggestProposal
        └─ perception → triage tag + suggestProposal
        │
        ▼
EvolutionControlPlane.suggestProposal
  assertEvolutionTransition(DISCOVERED,"suggest") + authority + ledger proposal.suggested
        │
lifecycle (reuse proposal statuses — no parallel todo list)
  open        = DISCOVERED
  in_progress = SUGGESTED … ACTIVE  (+ candidate.lifecycle)
  resolved    = candidate.lifecycle=resolved  (after verified usage)
                status is NEVER force-written to REJECTED for resolve
  won't-fix   = REJECTED | EXPIRED | REVOKED  (operator / expire sweeper)
        │
closure (legal + ledger; tenant-scoped; usage required)
  linked draft/install verified-equivalent AND later run toolMetas match
    → suggest if still DISCOVERED
    → candidate.lifecycle=resolved + ledger verification.completed
  unrelated successful reply → NO-OP (resolveCapabilityGapsForSuccessfulRun is empty)
```

Marker hygiene: stripped in `directive-tags` (final + streamed, with partial-chunk
holdback). Strict category enum + detail length + per-session rate limit. User
input markers ignored (`fromAssistant`).

Related existing pieces (not replaced):

- `EVOLUTION_LOOP_EVENTS` / `logEvolutionLoop` — structured trail
- `recordGrowthTaskOutcome` → `recordRunOutcome` → `appendEvolutionTaskOutcome`
- `GrowthCapabilityGapView` (onboarding template gaps) — orthogonal to runtime gaps
- shadow-intent / pattern proposals — same DISCOVERED registration pattern
- UI「成长中」badge — still driven by growth lifecycle / operational metrics

## Prompt / policy

`buildUserVisibleReplySection` and steward `buildStewardSystemPreamble` require:
explain capability boundaries in the user's language; if attemptable, state the
next try; on failure, a short self-reflection (missing skill/tool/perception +
next step); emit `[[capability_gap:…]]` once when refusing for a gap.

## Tests

- `honest-empty-reply.test.ts` — decision table, marker validation/strip, EIO best-effort
- `agent-runner.honest-empty-reply.test.ts` — through `runReplyAgent` (+ EIO hello)
- `capability-gap-ingest.test.ts` — e2e: marker → DISCOVERED → consumer → SUGGESTED
  - draft → verified usage close; negative: unrelated reply does not close
- system-prompt + steward preamble assertions

## Capability-gap system grant (bootstrap)

At control-plane bootstrap the gateway ensures an idempotent, narrowly scoped
**SYSTEM** grant (`grant:capability-gap:system:${tenant|platform}`) via the real
delegation machine (`request` + `approve`). Allowed actions are **`suggest`** and
**`expire` only** — never `reject` / apply / promote.

**SoD / self-approval:** issuer is platform principal `system:capability-gap` and
approver is a synthetic enterprise principal for the tenant (or platform
sentinel). There is no human approver at bootstrap; separation of duties is
machine-enforced by grant scope + authority-gate constraints (expire only for
stale DISCOVERED `capability-gap:*` proposals). Every issuance and evidence
expansion is auditable in the delegation ledger / grant snapshot
(`delegation-grants.snapshot.json`). Operator RPC `evolution.proposals.transition`
`reject` cannot use this grant.

Perception triage tags are projected on `evolution.proposals.list` / `.get`
(`triageTag`, `capabilityGap`), filterable by `triageTag` / `sourceMechanismPrefix`.
