# Phase 1A Owner Sign-off Instruction

Date: 2026-08-16  
From: `cursor-memory-platform`  
Status: contracts drafted; **§14.1 still 0/7**  
Forbidden: self-sign by coordinator; Phase 1B; LIVE; `deployAuthorized=true`

Each owner signs **only their rows**. Do not flip `section141Signed=true` until all seven roles are `accepted`.

## Shared protocol

1. Work in an isolated worktree on fresh `origin/main` (after #425 lands).
2. Read the files listed for your role.
3. If you accept the design: set the review packet `decision=accepted` and `signedAt`.
4. Update the matching row in `docs/design/evidence/memory-workspace-phase0-section141-signoff-matrix.json`.
5. Commit with `scripts/committer` and trailers `Task: memory-workspace-platform-remediation` / `Agent: <you>`.
6. Open a normal PR. Do not edit another owner's packet.

## codex-workspace-architecture

Sign: `architecture` + `data-governance`

Read: Catalog + Membership contracts and the two design-review packets.

Do not claim `src/gateway/workspace-resolver/**`.

## cursor-data-governance

Sign: `resolver` + `security`

1. Acknowledge WS-B change request in `.kiro/specs/data-governance-v2-p0/tasks.md`.
2. Accept the security packet (cwd vs data root; Managed fail-closed).

Do not switch resolver write path.

## cursor-memory-wsc

Sign: `memory` + `sre`

Accept Memory boundary (`Workspace role ≠ Memory Asset`) and the SRE backup/fencing/rollback design.

Do not edit `src/memory/**` production code. No schema v2.

## cursor-fable

Sign: `storage-cutover`

Accept the 11-row Binding impact matrix. Keep existing `WorkspaceBindingRecord` + cutover record/guard.

Do not create a second migration state machine. Freeze owner stays you; Retirement stays `cursor-data-governance`.
