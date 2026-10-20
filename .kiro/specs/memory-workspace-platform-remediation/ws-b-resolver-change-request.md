# WS-B Resolver Change Request (Memory Workspace Phase 1A)

Date: 2026-08-16  
From: `cursor-memory-workspace-followup` (memory-workspace-platform-remediation)  
To: `cursor-data-governance` (`data-governance-v2-p0` owner)  
Status: **accepted** (design gate only; #429 `1f7a067643`). Fail-closed note: `docs/design/evidence/memory-workspace-phase1a-ws-b-unknown-conflict-failclosed.json`.

## Context

Phase 0 closed at review sequence 25 (#422 merged). Phase 1A is **design and owner sign-off only**. WS-B production resolver paths remain owned by `data-governance-v2-p0:cursor-data-governance`.

Dispatch evidence: `docs/design/evidence/memory-workspace-phase0-ws-b-dispatch.json`

## Requested scope (design phase only — no write switch)

1. Review memory-workspace identity remediation design §5–§7 for resolver read-path alignment with Catalog SoT (when WS-A store exists).
2. Accept or reject this change request before any edits under `src/gateway/workspace-resolver/**` from the memory-workspace task.
3. Document fail-closed behavior for `unknown` / `conflict` inventory rows until tenant-scoped membership + AgentAsset authority exists.
4. Confirm no parallel WorkspaceIdentity or membership SoT will be introduced by memory-workspace workstreams.

## Explicitly out of scope (blocked)

- Resolver production write switch
- LIVE migration or StorageBinding cutover
- Modifying `agents.list[].workspace` to mask inventory gaps
- Schema v2 / memory write-path convergence

## Acceptance criteria

- [x] `cursor-data-governance` acknowledges this change request in `data-governance-v2-p0/tasks.md` — #429
- [x] WS-B row in `memory-workspace-phase0-section141-signoff-matrix.json` moves to `decision: accepted` (design gate only) — #429 / #433
- [x] No resolver code lands until §14.1 architecture sign-offs complete
- [x] Fail-closed documented for `unknown` / `conflict` inventory rows — `memory-workspace-phase1a-ws-b-unknown-conflict-failclosed.json`

## References

- `docs/design/memory-workspace-identity-remediation-2026-08-14.md`
- `docs/design/evidence/memory-workspace-phase0-section141-signoff-matrix.json`
- `.kiro/specs/data-governance-v2-p0/tasks.md`
