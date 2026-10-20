# Worktree Boundary Audit (2026-04-09)

## Snapshot

- Current worktree status: `205` entries
- Tracked changes: `148`
- Untracked entries: `57`
- Top-level concentration:
  - `ui/`: dominant workstream
  - `src/`: second dominant workstream
  - `docs/`: architecture and planning spillover
  - `packages/`: incubation / package promotion spillover
  - `test/`: small but real validation spillover

## What The Current Changes Actually Are

### 1. Core product and gateway changes

These are real product changes inside the main OpenBot runtime:

- `src/config/*`
- `src/gateway/*`
- `src/channels/plugins/types.plugin.ts`
- `src/shared/config-ui-hints-types.ts`
- `src/infra/git-commit.ts`
- `test/git-hooks-pre-commit.test.ts`

This cluster is still part of the main repository integration surface. It should
continue to be covered by root `pnpm check` and root `pnpm run test`.

### 2. UI / workbench / control-ui refactor

This is the largest active change cluster:

- `ui/src/ui/app-*`
- `ui/src/ui/controllers/*`
- `ui/src/ui/views/*`
- `ui/src/ui/chat/*`
- `ui/src/ui/data/*`
- `ui/src/ui/ports/employee/**`
- `ui/src/styles/*`
- `ui/src/i18n/*`

This is not random churn. It is one coherent product refactor:

- `workbench` is the real employee surface under
  `ui/src/ui/ports/employee/views/workbench.ts`
- employee-specific modeling is now owned by
  `ui/src/ui/ports/employee/views/workspace-*.ts`
- shared frontstage derivation is now owned by
  `ui/src/ui/data/frontstage-*.ts`
- the old wrapper files under `ui/src/ui/views/` for `workspace.ts`,
  `workspace-home-model.ts`, `workspace-modules.ts`,
  `workspace-signals.ts`, and `frontstage-model.ts` have been removed after
  migration and focused verification

Boundary implication:

- `ui/src/ui/ports/employee/**` is the canonical employee workspace boundary
- `ui/src/ui/data/**` is the canonical shared derivation boundary for
  session/persona/contact/group summaries
- `ui/src/ui/views/**` should host shared rendering concerns, not a second
  employee workbench implementation

### 3. Docs and analysis material

This cluster is mostly design/report content, not runtime behavior:

- `docs/design/*`
- `docs/gateway/trusted-proxy-auth.md`
- `.kiro/specs/*`
- root-level reports such as `OpenBot-Dialogue-Prompt-Mechanism-Analysis.md`

Boundary implication:

- these files should not be mixed into runtime cleanup commits unless they
  directly describe the same shipped feature

### 4. New package workstreams

There are two very different kinds of package changes in `packages/`.

#### 4.1 Collaboration packages that already look like real workspace packages

- `packages/collaboration-core/`
- `packages/collaboration-openbot-adapter/`
- `packages/collaboration-runtime/`

These have their own:

- `package.json`
- `tsconfig.json`
- `src/`
- tests

These are valid isolated package boundaries and should eventually have
package-local quality gates.

#### 4.2 Incubating SDK/package imports that are not yet clean repo boundaries

- `packages/cogniweave-sdk/`
- `packages/meetingos-sdk/`
- `packages/presentation-ai-sdk/`
- `packages/smart-schedule-sdk/`

Important distinction:

- `cogniweave-sdk` is comparatively complete and testable
- `presentation-ai-sdk` and `smart-schedule-sdk` contain partial `src/` trees
  with missing source dependencies and old generated outputs nearby
- some of these directories have `dist/` but not a complete source closure

Boundary implication:

- these SDKs should not be treated as part of the root product quality gate
  until each package has a complete local build boundary
- root `tsconfig.json` should continue to describe the main product surface,
  not every incubating package draft

### 5. Generated and temporary artifacts

These are boundary pollution, not product source:

- tracked cache files under `ui/node_modules/.vite/vitest/**`
- untracked UI build output under `ui/.tmp-control-ui-build/`
- transient canvas-host test file `src/canvas-host/a2ui/test-link-*.txt`
- package runtime scratch output under `packages/*/.runtime/`
- browser screenshot baselines under `ui/src/ui/views/__screenshots__/...`

Boundary implication:

- temporary build outputs must be ignored
- tracked cache content inside `ui/node_modules/.vite/**` is a repository hygiene
  bug and still needs a dedicated de-index cleanup commit
- screenshot baselines are legitimate test assets when intentional; they are not
  the same category as temp build output

### 5.1 Verified `.vite` cache contents

The tracked `ui/node_modules/.vite/vitest/**` files were inspected before cleanup.

What was verified:

- `deps/_metadata.json` maps each cached file back to a dependency under root
  `node_modules/.pnpm/...`
- representative cached files such as `dompurify.js`, `lit.js`, and `marked.js`
  are Vite-transformed dependency bundles, not application source
- `results.json` stores Vitest run results and references test paths, but does
  not contain canonical UI implementation logic

Practical conclusion:

- these cache files may be useful as a temporary forensic snapshot of
  dependency transforms
- they are not the authoritative source for `workbench`, `control-ui`, or
  other product behavior
- if cleanup is performed later, it should happen only after any needed
  dependency-level debugging is complete

## Recommended Repository Boundary Model

### Root product boundary

These directories define the main OpenBot product and should be covered by
root checks:

- `src/`
- `ui/`
- `extensions/`
- `test/`

### Package boundary

Each package under `packages/` should be one of two states:

1. Integrated workspace package
   - has `package.json`
   - has `tsconfig.json`
   - has local tests
   - is eligible for package-local CI

2. Incubating package draft
   - incomplete source closure
   - may carry generated `dist/`
   - must not block root product CI until promoted

Do not mix both states under the same root gate without an explicit promotion
step.

### UI boundary

Use this split consistently:

- `ui/src/ui/app-*`: application assembly and wiring
- `ui/src/ui/controllers/*`: IO and state transition controllers
- `ui/src/ui/data/*`: shared derivation and normalization
- `ui/src/ui/views/*`: shared rendering
- `ui/src/ui/ports/employee/**`: employee/workbench product boundary

### Docs boundary

Keep these separate from product commits whenever possible:

- `docs/`
- `.kiro/specs/`
- root-level analysis markdown files

## Immediate Cleanup Actions

### Already applied in this round

- ignore `ui/.tmp-control-ui-build/`
- ignore `src/canvas-host/a2ui/test-link-*.txt`
- ignore `packages/*/.runtime/`
- remove wrapper-only legacy workbench/frontstage files once migration and
  focused verification succeeded

### Still needed

1. Remove tracked cache files under `ui/node_modules/.vite/**` from the git index
   after any dependency-level forensic comparison is complete
2. Decide which new packages are promoted into workspace-quality boundaries and
   give each its own local gate
3. Stop mixing design reports and runtime refactors in the same landing batch
4. Keep new workbench logic in `ui/src/ui/ports/employee/**` and shared
   derivation in `ui/src/ui/data/**`

## Practical Rule Set

- Root `pnpm check` and root `pnpm run test` validate the main product only
- New packages must earn promotion into root validation by first becoming
  locally self-contained
- Generated output must be ignored, not debated
- Wrapper files that no longer have callers should be deleted after focused
  verification, not kept around as ambiguous fallback surfaces
- Worktree reviews should be grouped by boundary:
  - core runtime
  - UI/workbench
  - docs/specs
  - packages
  - generated artifacts
