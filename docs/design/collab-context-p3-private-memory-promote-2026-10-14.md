# Collaboration context P3 — private LTM promote-only (2026-10-14)

**Status:** Draft implementation  
**Flag:** `collaboration.learning.privateMemoryPromote` (default **unset/false = OFF**)  
**Related:** P0 private run bag; P1 same-round coverage + transcript guard; P2 context-scope single-track  
**Repo:** upbeyond/openbot only

## Goal

1. Bot **private long-term memory** stays in the personal learning scope (`agent:<botId>`) only.
2. Entering **group** memory / learning assets requires an explicit **promote** that reuses the existing capsule → projection → `AgentLearningAsset` pathway, with **confidentiality** + **promotion audit**.
3. Forbid per-bot **private-chat (DM) history** mirroring into `GROUP_PUBLIC`.
4. Acceptance: contract + minimal wiring + tests proving dirty writes do not land in the public transcript.

## Hard invariants

| Invariant                                     | Enforcement                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| GROUP_PUBLIC remains SoT for group transcript | No new transcript writers; promote only touches learning storage     |
| No per-bot full group-history copy            | Unchanged; `dropDivergentGroupTranscriptMirrors` remains             |
| Private state never dirty-writes transcript   | `assertNoPrivateMemoryDirtyWriteToGroupPublic` on write/append paths |
| Entry only via promote + audit                | `promotePrivateMemoryCapsuleToGroup`                                 |
| Flags default OFF; no Floor live              | `privateMemoryPromote` unset/false                                   |

## Architecture

```
Personal scope capsules (agent:<botId>)
        │
        │  explicit promote (flag ON)
        ▼
preparePrivateCapsuleForGroupPromote  →  group-scoped approved clone
        │
        ▼
DefaultLearningPromotionService.projectCapsule / promoteProjection
        │
        ▼
group learning assets + recordPromotionAudit
  (sourceGroupId = agent:<botId>, targetScope = "group", confidentialityTier)

GROUP_PUBLIC transcript ←── assertNoPrivateMemoryDirtyWriteToGroupPublic
                              (refuses __privateLongTermMemory + DM mirror markers)
```

## Flag

| Value                   | Behavior                                                                    |
| ----------------------- | --------------------------------------------------------------------------- |
| unset / false (default) | `promotePrivateMemoryCapsuleToGroup` returns `flag_off`; no learning writes |
| true                    | Promote path may write group capsules / projections / assets + audit        |

Dirty-write / DM-mirror refusal on transcript paths is **always on** (independent of the flag).

## Non-goals

- Parallel memory store (reuse learning capsules / assets)
- Auto-promote or silent backflow of private LTM into group
- Floor live / episodeStore / context lane cutover changes
- Merging this PR without review (draft only)

## Tests

`src/gateway/collaboration-learning/private-memory-promote.test.ts`

- Flag defaults OFF
- Private LTM + DM mirror markers refused on public payloads
- Flag-off promote is a no-op
- Flag-on promote writes learning asset + audit with confidentiality; no transcript markers


## Production RPC entry (P1-C, 2026-10-30)

Gateway method: `collaboration.learning.privateMemory.promote`

- Params: `botId`, `groupId`, `capsuleId`, optional `confidentialityTier`
- Requires identified actor + target-group trusted write membership
- Loads capsule from personal scope `agent:<botId>` only
- Flag OFF → `{ promoted: false, reason: "flag_off" }` (no learning writes)
- Default flag remains OFF; this entry does not flip the default
- Revoke: group-side revoke is separate from personal asset revoke

## P1-C acceptance fixes (2026-10-30 follow-up)

1. **Policy before body copy** — `evaluateGroupPromotionPolicy` runs before `appendCapsule` / projection / asset. Denials (`lifecycle_blocked`, etc.) audit-only; target group has no private body.
2. **Idempotent projection/asset** — stable ids `proj:privprom:…` / `asset:privprom:…` from source scope + capsule version + tenant/group/bot; storage upserts by id on retry.
3. **Trusted tenant/stores** — RPC passes `tenantId`, `securityProfile`, and `stores` from `resolveTrustedWriteContext` into the authorized entry / promote deps. Managed without trusted context fail-closes (`managed_requires_trusted_context`). Default flag remains OFF.

## Status note (2026-10-30 tip)

P1-C 三修复已推送 tip，状态记 **已推送待复验 / 部分验证**（已推送≠验收通过）。默认 `privateMemoryPromote` 仍 OFF。
