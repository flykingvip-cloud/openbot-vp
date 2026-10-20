# Worktree Integration Manifest (2026-04-09)

## Goal

Stop the repository from accumulating unrelated work in one shared dirty
worktree.

This manifest classifies current changes into three outcomes:

- merge to mainline
- isolate from mainline
- clean before commit

It is intentionally operational. It is not a design essay.

## Non-Negotiable Rules

1. The shared dirty worktree is not the source of truth.
2. Every changed path must have one of three dispositions:
   - `MERGE`
   - `ISOLATE`
   - `CLEAN`
3. No path may stay in an implicit "we will decide later" state once it blocks
   integration.
4. `packages/` incubation work must not silently expand the root mainline
   integration surface.
5. Generated artifacts and test outputs must never be mixed into feature commits
   unless they are explicit, reviewed baselines.

## Current Repository State

Snapshot from `git status --short`:

- `205` total status entries
- `148` tracked modifications
- `57` untracked additions

Top-level distribution:

- `ui/`: dominant workstream
- `src/`: second dominant workstream
- `docs/`: architecture and planning spillover
- `packages/`: incubation / package promotion spillover
- `.github/`: CI and package workflow spillover

## Validated Correction

The original "four main lines" conclusion is directionally right, but it is not
complete enough to operate on safely.

The current dirty tree is more accurately:

- four product lines
- plus one integration bridge line

The bridge line is real and already active in root integration surfaces.

Verified examples:

- root `tsconfig.json` adds `@openbot/collaboration-*` path aliases
- root `vitest.config.ts` adds package aliases and includes UI port tests
- `src/config/sessions/types.ts` imports collaboration package types into main
  product session state
- `src/gateway/protocol/index.ts` and
  `src/gateway/protocol/schema/protocol-schemas.ts` register new collaboration
  and daibai protocol surfaces
- `src/gateway/server-methods-list.ts` exposes new runtime methods at the root
  gateway boundary

Operational implication:

- package incubation and runtime capability work are no longer isolated side
  notes
- they have already crossed the root compile, test, protocol, and method
  registry boundaries
- any landing plan that ignores this bridge line will keep recreating the same
  mixed-tree failure mode

Validated refinement:

- pure guardrails are a much smaller set than initially assumed
- `tsconfig.json`, `tsconfig.plugin-sdk.dts.json`, `vitest.config.ts`,
  `src/config/sessions/types.ts`, and `test/shims/tloncorp-api.ts` are not
  guardrails; they are package-bridge spillover and belong with incubation risk
- `src/gateway/protocol/**` and `src/gateway/server-methods*.ts` are not
  generic infrastructure; they belong to the collaboration/daibai runtime line
- `src/gateway/gateway-misc.test.ts` belongs to control-ui/platform-auth

## Classification

### MERGE: Mainline Product Recovery

These changes belong to the current product surface and should be integrated on
purpose.

Paths:

- `ui/src/ui/app*.ts`
- `ui/src/ui/ports/employee/**`
- `ui/src/ui/data/frontstage-*`
- `ui/src/ui/views/frontstage.ts`
- `ui/src/ui/views/workspace-commands.ts`
- `ui/src/styles/workbench.css`
- `ui/src/styles/chat/**`
- `ui/src/styles/layout*.css`
- `ui/src/ui/controllers/chat.ts`
- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/controllers/daibai.ts`
- `ui/src/ui/controllers/collaboration-learning.ts`
- `ui/src/ui/views/platform-auth-panel.ts`
- `src/gateway/platform-auth.ts`
- `src/gateway/server-methods/daibai.ts`
- `src/gateway/server-methods/support-cases.ts`
- `src/gateway/server-methods/collaboration-learning.ts`
- `src/auto-reply/reply/collaboration-*.ts`
- `src/shared/daibai-types.ts`
- `src/support-cases/**`
- related tests that prove these paths

Reason:

- these are not random edits
- they represent the actual active runtime and UI recovery path
- the `workbench` recovery already depends on part of this set

Required integration style:

- split into focused commits by subsystem
- no generated artifacts
- no package incubation mixed into these commits

### ISOLATE: Incubation / Experimental Product Lines

These changes may be valuable, but they should not be treated as part of the
mainline recovery until they have their own clean gate.

Paths:

- `packages/cogniweave-sdk/**`
- `packages/collaboration-core/**`
- `packages/collaboration-openbot-adapter/**`
- `packages/collaboration-runtime/**`
- `.github/workflows/cogniweave-sdk-*.yml`
- `docs/experiments/proposals/cogniweave-prd-v1.1.md`
- `docs/design/openbot-collaboration-sdk-next-stage-decision-2026-04-09.md`

Reason:

- these are package or product-line incubation efforts
- they change the repository boundary and CI expectations
- they should not silently ride along with `workbench` recovery or
  gateway/runtime fixes

Required integration style:

- separate branch or dedicated commit stack
- explicit package-level type/test gates
- explicit decision on whether each package is promoted, vendored, or kept
  experimental

### ISOLATE: Architecture Notes And One-Off Analysis

These can be useful reference material, but they should not be merged blindly
into mainline.

Paths:

- `docs/design/aegis-*`
- `AgentId规范化修复-验证清单.md`
- `OpenBot-Dialogue-Prompt-Mechanism-Analysis.md`
- `OpenBot-Skills-Tools-Migration-Report.md`
- `Pi-Coding-Agent-Integration-Guide.md`
- `.kiro/specs/**`

Reason:

- these are planning, comparison, or operator-facing notes
- some may be valuable
- some are local working material and should stay out of the product repo

Required integration style:

- promote only documents with long-term repo value
- move local/operator notes out of mainline if they are not product docs

### CLEAN: Generated Or Review-Only Artifacts

These should not be merged as part of feature work without explicit intent.

Paths:

- `src/canvas-host/a2ui/.bundle.hash`
- `ui/src/ui/views/__screenshots__/**`

Reason:

- `.bundle.hash` is generated state and should only move in a deliberate bundle
  update
- screenshot outputs are review artifacts, not feature source

Required integration style:

- either discard
- or land in a dedicated snapshot/baseline commit with explicit reviewer intent

## Immediate Execution Order

### Phase 1. Freeze Mainline Recovery Scope

Treat these as the only active mainline recovery surface:

- `ui/src/ui/app*.ts`
- `ui/src/ui/ports/employee/**`
- `ui/src/ui/data/frontstage-*`
- `ui/src/ui/views/frontstage.ts`
- `ui/src/ui/views/workspace-commands.ts`
- `src/gateway/platform-auth.ts`
- `src/gateway/server-methods/{daibai,support-cases,collaboration-learning}.ts`
- `src/auto-reply/reply/collaboration-*.ts`
- `src/shared/daibai-types.ts`

### Phase 2. Split The Working Tree Into Commit Groups

Recommended commit groups:

1. `workbench` / employee UI recovery
2. shared frontstage data extraction
3. platform auth / control-ui auth
4. daibai / support-cases / collaboration-learning runtime
5. tests that belong directly to the above

### Phase 3. Remove Non-Mainline Noise From The Recovery Path

Before landing mainline recovery:

- do not include `packages/**` incubation by accident
- do not include `aegis-*` notes by accident
- do not include screenshot outputs or generated bundle state by accident

### Phase 4. Give Incubation Work Its Own Gate

For `packages/**` and related workflows/docs:

- decide promote vs experimental
- if experimental, keep outside root mainline gate
- if promoted, add explicit compile/test ownership and integrate intentionally

### Phase 5. Enforce Explicit Classification Mechanically

Run:

- `pnpm worktree:audit`

And require:

- zero `UNMATCHED` paths before landing
- every changed path to map to `MERGE`, `ISOLATE`, or `CLEAN`
- bridge files to stay explicit instead of hitchhiking inside UI-only or
  package-only commits

## Practical Decision Standard

Use this test for every changed path:

- Does the current shipping product depend on it right now?
  - `MERGE`
- Is it a new package or exploratory line that needs its own gate?
  - `ISOLATE`
- Is it generated output, snapshot output, or incidental local material?
  - `CLEAN`

If a path cannot be classified quickly, default to `ISOLATE`, not to
"merge everything".

## Current High-Confidence Dispositions

High-confidence `MERGE`:

- `ui/src/ui/ports/employee/**`
- `ui/src/ui/data/frontstage-*`
- `ui/src/ui/views/frontstage.ts`
- `ui/src/ui/views/workspace-commands.ts`
- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/controllers/daibai.ts`
- `ui/src/ui/controllers/collaboration-learning.ts`
- `src/gateway/platform-auth.ts`
- `src/gateway/server-methods/daibai.ts`
- `src/gateway/server-methods/support-cases.ts`
- `src/gateway/server-methods/collaboration-learning.ts`
- `src/auto-reply/reply/collaboration-*.ts`
- `src/shared/daibai-types.ts`

High-confidence `ISOLATE`:

- `packages/**`
- `.github/workflows/cogniweave-sdk-*.yml`
- `docs/design/aegis-*`
- `docs/experiments/proposals/cogniweave-prd-v1.1.md`

High-confidence `CLEAN`:

- `ui/src/ui/views/__screenshots__/**`
- `src/canvas-host/a2ui/.bundle.hash`

## Immediate Outcome

The repository does not need another blind rewrite.

It needs:

- a strict mainline recovery boundary
- a separate incubation boundary
- a hard stop on generated and review-only artifacts entering feature commits

This manifest is the working source for that separation.

Concrete landing batches derived from this manifest live in:

- `docs/design/worktree-landing-groups-2026-04-09.md`
