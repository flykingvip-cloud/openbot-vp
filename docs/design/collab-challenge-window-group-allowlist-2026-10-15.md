# Collab — `challengeWindowGroupAllowlist` (gray scoped)

| Field | Value |
| --- | --- |
| Date | 2026-10-15 Asia/Shanghai |
| Status | Code ready; **flags default OFF** |
| Depends | P0 gray-group-allowlist (`tenantId/groupId`); S1 challenge-window |
| Code | `challenge-window.ts`, config schema, `challenge-window.test.ts` |

## Why

Tip gray enable must not flip global `collaboration.task.challengeWindow=true`.
Mirror Claim / Wake: add `challengeWindowGroupAllowlist` with the same P0 scoped
`tenantId/groupId` matching (`gray-group-allowlist.ts`).

## Behavior

| Config | Effect |
| --- | --- |
| `challengeWindow` unset/false + empty allowlist | OFF (platform default) |
| `challengeWindow=true` | ON for all groups (legacy global; tip should avoid) |
| allowlist `001/grp-…` + managed caller tenant `001` | ON for that group only |
| bare `grp-…` + managed caller tenant set | **refuse** (P0) |
| `001/grp-…` + caller tenant `002` | **refuse** (cross-tenant) |

Writes (`open` / `critique` / `resolve` / `skip` / publish gate) use
`isCollabTaskChallengeWindowEnabled(cfg, groupId, tenantId)`.

## Flags (stay OFF in this PR)

- `collaboration.task.challengeWindow` → false
- `collaboration.task.challengeWindowGroupAllowlist` → `[]`
- No LIVE / Floor / claim|wake flips

## Acceptance

- Vitest: bare refuse, cross-tenant refuse, allowlist hit opens window without global true
- Existing challenge-window / S1 / P0 suites still green
- LIVE_touched = false

## Out of scope

Floor live, Episode multi-beat, default global true, production gray writes.
