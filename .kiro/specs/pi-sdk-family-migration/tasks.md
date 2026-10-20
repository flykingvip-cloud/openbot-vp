# Pi SDK family migration v3

## Agents

- cursor · role: owner · scope: isolated v3 worktree; Phase A evidence then full-family Earendil 0.84.4 migration; independent PR; no v2 WIP takeover · paths: .kiro/specs/pi-sdk-family-migration/**, package.json, pnpm-lock.yaml, extensions/matrix/package.json, extensions/matrix/src/tool-actions.ts, extensions/tlon/index.ts, extensions/voice-call/index.ts, src/**, .pi/extensions/**, scripts/**, test/setup.ts, docs/pi.md, docs/concepts/oauth.md, docs/reference/session-management-compaction.md, docs/gateway/doctor.md, CHANGELOG.md, Pi-Coding-Agent-Integration-Guide.md, skills/coding-agent/SKILL.md, apps/macos/Sources/OpenBot/ModelCatalogLoader.swift · since: 2026-08-29

## Constraints

- Do not modify `../openbot-pi-sdk-family-migration-v2`.
- Do not copy v2's 311 uncommitted files.
- Do not mix Mario 0.57 with Earendil 0.84.
- Do not edit PR #797, add audit ignore, bypass CI, force-push, or deploy production.

## Status

- [x] Isolated worktree `cursor/pi-sdk-family-migration-v3` from `origin/main` (ancestry OK).
- [x] Phase A: API comparison, session round-trip, supply chain, tool ACL observation.
- [x] Phase B: pin four Earendil 0.84.4 packages, typed adapters, tests, audit gate. — cursor
- [x] Independent PR + Codex handoff.
