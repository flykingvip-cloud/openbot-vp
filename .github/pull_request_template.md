## Summary

Describe the problem and fix in 2–5 bullets:

- Problem:
- Why it matters:
- What changed:
- What did NOT change (scope boundary):

## Change Type (select all)

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Docs
- [ ] Security hardening
- [ ] Chore/infra

## Scope (select all touched areas)

- [ ] Gateway / orchestration
- [ ] Skills / tool execution
- [ ] Auth / tokens
- [ ] Memory / storage
- [ ] Integrations
- [ ] API / contracts
- [ ] UI / DX
- [ ] CI/CD / infra

## Linked Issue/PR

- Closes #
- Related #

## User-visible / Behavior Changes

List user-visible changes (including defaults/config).  
If none, write `None`.

## Security Impact (required)

- New permissions/capabilities? (`Yes/No`)
- Secrets/tokens handling changed? (`Yes/No`)
- New/changed network calls? (`Yes/No`)
- Command/tool execution surface changed? (`Yes/No`)
- Data access scope changed? (`Yes/No`)
- If any `Yes`, explain risk + mitigation:

## Repro + Verification

### Environment

- OS:
- Runtime/container:
- Model/provider:
- Integration/channel (if any):
- Relevant config (redacted):

### Steps

1.
2.
3.

### Expected

-

### Actual

-

## Evidence

Attach at least one:

- [ ] Failing test/log before + passing after
- [ ] Trace/log snippets
- [ ] Screenshot/recording
- [ ] Perf numbers (if relevant)

## Human Verification (required)

What you personally verified (not just CI), and how:

- Verified scenarios:
- Edge cases checked:
- What you did **not** verify:

## Review Conversations

- [ ] I replied to or resolved every bot review conversation I addressed in this PR.
- [ ] I left unresolved only the conversations that still need reviewer or maintainer judgment.

If a bot review conversation is addressed by this PR, resolve that conversation yourself. Do not leave bot review conversation cleanup for maintainers.

## Persistence (required if this PR adds/changes durable stores)

See `docs/design/openbot-persistence-engine-matrix-2026-07-13.md`.  
If this PR does **not** touch persistence, write `N/A`.

| Field                          | Value                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Touches durable store?         | `Yes` / `No` / `N/A`                                                                      |
| Data class                     | `D` (document/control-plane) · `Q` (query/index/append) · `E` (ephemeral runtime) · `N/A` |
| Engine                         | `json` · `sqlite` · `json\|sqlite` · `other:` · `N/A`                                     |
| Shard key                      | e.g. `tenantId` / `userId` / `agentId` / `global-L0` / `N/A`                              |
| Path / backend                 | e.g. `tenants/<tid>/control-plane/…` or module                                            |
| Dual-write / aspirational DDL? | `No` · or explain (must not invent a second authority)                                    |

- Multi-tenant safe? (`Yes/No/N/A`) — new business state must not default to a single global `~/.openbot/*.json` for multi-tenant data.
- If changing default engine: linked matrix row update? (`Yes/No/N/A`)

## Compatibility / Migration

- Backward compatible? (`Yes/No`)
- Config/env changes? (`Yes/No`)
- Migration needed? (`Yes/No`)
- If yes, exact upgrade steps:

## Failure Recovery (if this breaks)

- How to disable/revert this change quickly:
- Files/config to restore:
- Known bad symptoms reviewers should watch for:

## Risks and Mitigations

List only real risks for this PR. Add/remove entries as needed. If none, write `None`.

- Risk:
  - Mitigation:

## Strong Separation / Layer Check (required when touching bots, groups, or mesh)

Reference: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md` §6 permission matrix.

Select the layer(s) this PR touches, then confirm no cross-layer leakage:

- [ ] Employee · My Bots (`system settings → robots` / `robot.workspace.*`)
- [ ] Employee · Collaboration groups (`system settings → groups` / `collaboration.space.*`)
- [ ] Enterprise · Mesh (`enterpriseMesh` / `mesh.operations.*` / `mesh.performance.*`)
- [ ] N/A (does not touch bots / groups / mesh)

Boundary confirmations (check all that apply, or mark N/A in the PR body):

- [ ] Employee My Bots does **not** add enterprise cost / Token / GPU / Runtime host / budget / governance-queue UI
- [ ] Employee My Bots Collaboration block (if any) is **read-only participation** — does not edit group rules/members
- [ ] Mesh / enterprise UI does **not** add Identity / Prompt editors (enterprise templates excepted) or Skill install/toggle
- [ ] Mesh copy avoids employee terms「成长路径」「能力配置」— use「成长速度（企业）」「能力统计」
- [ ] New gateway methods are bucketed (`robot.workspace.*` / `collaboration.space.*` / `mesh.operations.*` / `mesh.performance.*`) rather than a shared unscoped `agents.update` kitchen sink
- [ ] Persona (playable roles) is not mixed with Capabilities or Operational Identity in the same table/API
