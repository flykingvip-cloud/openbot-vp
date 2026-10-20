# Worktree Landing Groups (2026-04-09)

## Goal

Turn the current shared dirty worktree into a finite set of landing groups that
can be reviewed and committed without mixing incompatible streams.

This file is stricter than the high-level manifest. It names the concrete groups
that should be used for landing.

## Group A: Workbench And Employee UI Recovery

This is the primary mainline recovery group.

Paths:

- `ui/src/ui/app*.ts`
- `ui/src/ui/app-port-state.ts`
- `ui/src/ui/chat/**`
- `ui/src/ui/controllers/{channels,chat,config,control-ui-bootstrap,devices,presence,sessions,skills,usage}.ts`
- `ui/src/ui/controllers/*.{test,node.test}.ts` that validate the same chain
- `ui/src/ui/data/frontstage-*`
- `ui/src/ui/ports/employee/**`
- `ui/src/ui/views/frontstage.ts`
- `ui/src/ui/views/workspace-commands.ts`
- `ui/src/ui/views/workspace-commands.node.test.ts`
- `ui/src/ui/views/workspace-home-model.node.test.ts`
- `ui/src/ui/views/frontstage-model.node.test.ts`
- deleted legacy wrappers:
  - `ui/src/ui/views/workspace.ts`
  - `ui/src/ui/views/workspace-home-model.ts`
  - `ui/src/ui/views/workspace-modules.ts`
  - `ui/src/ui/views/workspace-signals.ts`
  - `ui/src/ui/views/frontstage-model.ts`
- `ui/src/styles/workbench.css`
- `ui/src/styles/chat/**`
- `ui/src/styles/layout*.css`
- `ui/src/styles.css`
- `ui/index.html`
- `ui/WORKSPACE_HOME_MODULE_MAP.md`

Why it should land together:

- this is one coherent UI boundary change
- the deleted wrappers and the new `ports/employee` boundary only make sense
  together
- splitting the deletions away from the new implementation would recreate the
  very ambiguity we are trying to remove

Files that should not be mixed into this group:

- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/controllers/daibai.ts`
- `ui/src/ui/controllers/collaboration-learning.ts`
- `ui/src/ui/views/platform-auth-panel.ts`
- runtime `src/gateway/**` support for those capabilities

Refined UI subgroups for this landing stream live in:

- `docs/design/workbench-landing-subgroups-2026-04-09.md`

## Group B: Control-UI And Platform Auth Recovery

This group is the gateway/control-ui/auth stream.

Paths:

- `src/gateway/auth*.ts`
- `src/gateway/control-ui*.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/server.auth.*`
- `src/gateway/server-http.ts`
- `src/gateway/server/ws-connection/message-handler.ts`
- `src/gateway/session-utils*.ts`
- `src/gateway/platform-auth.ts`
- `src/gateway/platform-auth.test.ts`
- `src/commands/configure.gateway*.ts`
- `src/config/{schema.help.ts,schema.labels.ts,types.gateway.ts,zod-schema.ts}`
- `docs/gateway/trusted-proxy-auth.md`
- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/controllers/platform-auth.test.ts`
- `ui/src/ui/views/platform-auth-panel.ts`

Why it should land together:

- this is one contract line from config and gateway protocol to UI controller
  and panel
- partial landing would leave dead controls or unreachable gateway methods

Files that should not be mixed into this group:

- `src/gateway/server-methods/daibai.ts`
- `src/gateway/server-methods/support-cases.ts`
- `src/gateway/server-methods/collaboration-learning.ts`
- employee workbench boundary changes unrelated to auth

## Group C: Collaboration, Daibai, And Support-Case Runtime

This group is the new runtime capability stream.

Paths:

- `src/auto-reply/reply/agent-runner*.ts`
- `src/auto-reply/reply/get-reply-run*.ts`
- `src/auto-reply/reply/collaboration-*`
- `src/gateway/collaboration-learning.ts`
- `src/gateway/server-methods/{collaboration-learning,daibai,support-cases}*.ts`
- `src/gateway/protocol/schema/{collaboration,daibai}.ts`
- `src/shared/daibai-types.ts`
- `src/support-cases/**`
- `ui/src/ui/controllers/collaboration-governance-actions*.ts`
- `ui/src/ui/controllers/collaboration-learning*.ts`
- `ui/src/ui/controllers/daibai*.ts`
- `ui/src/ui/controllers/spaces.ts`
- `ui/src/ui/views/artifact-sidebar.ts`
- `ui/src/ui/chat/evidence-drawer.ts`
- `ui/src/ui/chat/task-card-*`

Why it should land together:

- these files form one domain capability line
- they introduce new gateway schema and UI control surfaces that are not just
  workbench shell changes

Files that should not be mixed into this group:

- package incubation
- control-ui/platform auth configuration
- generic workbench shell recovery unless directly touched by these capabilities

## Group D: Pure Guardrails

This group exists to keep repository hygiene and commit discipline stable
without changing runtime contracts.

Paths:

- `.gitignore`
- `.oxlintrc.json`
- `git-hooks/pre-commit`
- `package.json` (`worktree:audit*` scripts only)
- `scripts/worktree-audit.ts`
- `test/git-hooks-pre-commit.test.ts`
- `src/infra/git-commit.ts`
- `src/channels/plugins/types.plugin.ts`
- `src/shared/config-ui-hints-types.ts`

Why it should land together:

- these files improve hygiene, staging discipline, or type immutability
- they do not register new runtime methods
- they do not extend root protocol contracts
- they do not pull incubation packages into the root compile/test boundary

Important note:

- if a file changes root compile, protocol, or session boundaries, it is not a
  Group D guardrail even if it looks infrastructural

## Group E: Package Incubation And Package CI

This group must stay isolated from mainline recovery.

Paths:

- `tsconfig.json`
- `tsconfig.plugin-sdk.dts.json`
- `vitest.config.ts`
- `src/config/sessions/types.ts`
- `test/shims/tloncorp-api.ts`
- `packages/README.md`
- `packages/cogniweave-sdk/**`
- `packages/collaboration-core/**`
- `packages/collaboration-openbot-adapter/**`
- `packages/collaboration-runtime/**`
- `.github/workflows/cogniweave-sdk-*.yml`
- `.github/workflows/ci.yml`

Why it must stay separate:

- it changes the repository boundary and CI budget
- it pulls incubation package contracts into root compile/test surfaces
- it introduces package-local gates that do not belong in the same review as UI
  recovery

Critical implication:

- these files are not harmless tooling updates
- they are the package-bridge spillover that makes the root product depend on
  still-incubating workspace packages
- they must be treated as architectural risk until packages are either promoted
  intentionally or the root dependency is removed

## Group F: Analysis And Architecture Notes

These files should be promoted deliberately, not ride along.

Paths:

- `.kiro/specs/**`
- `OpenBot-Dialogue-Prompt-Mechanism-Analysis.md`
- `OpenBot-Skills-Tools-Migration-Report.md`
- `Pi-Coding-Agent-Integration-Guide.md`
- `AgentId规范化修复-验证清单.md`
- `docs/design/aegis-*`
- `docs/design/openbot-collaboration-sdk-*.md`
- `docs/design/workbench-*.md`
- `docs/design/worktree-*.md`
- `docs/experiments/proposals/cogniweave-prd-v1.1.md`

Why it should stay separate:

- some of these are valuable long-term docs
- some are operator or analysis notes
- none should be used to justify mixing unrelated runtime work

## Group G: Clean Or Explicitly Baseline

These are not normal feature files.

Paths:

- `src/canvas-host/a2ui/.bundle.hash`
- screenshot outputs under `ui/src/ui/views/__screenshots__/**` when present

Default action:

- do not include them in feature recovery commits
- only land them in dedicated baseline commits with explicit intent

## Recommended Landing Order

1. Group D: pure guardrails
2. Group A: workbench and employee UI recovery
3. Group B: control-ui and platform auth recovery
4. Group C: collaboration, daibai, and support-case runtime
5. Group E: package incubation and package bridge spillover
6. Group F: docs worth keeping
7. Group G: only if explicitly needed

## Practical Standard

If a file belongs to two groups, prefer the group that owns its runtime contract.

Examples:

- `ui/src/ui/views/platform-auth-panel.ts`
  belongs to Group B, not Group A
- `ui/src/ui/chat/evidence-drawer.ts`
  belongs to Group C, not Group A
- `vitest.config.ts`
  belongs to Group E because it expands root test boundaries to incubation
  packages
- `src/gateway/protocol/index.ts`
  belongs to Group C because it registers collaboration and daibai runtime
  contracts
- `src/gateway/gateway-misc.test.ts`
  belongs to Group B because it validates control-ui HTTP behavior

This prevents support files and cross-cutting UI helpers from getting stranded
in the wrong landing batch.

## Commit Discipline

Commit and staging boundaries should follow the same group model.

Allowed:

- one primary landing group by itself
- one primary landing group plus Group D guardrails
- Group G by itself when intentionally baselining generated output

Blocked:

- Group A + Group B in one staged batch
- any `MERGE` group mixed with Group E or Group F
- Group G mixed with any other group
- multiple primary groups in one staged batch, even if the changes all look
  "related enough"

Mechanical enforcement:

- `pnpm worktree:audit`
- `pnpm worktree:audit:cached`
- `pnpm worktree:audit:guardrails`
- `pnpm worktree:paths:guardrails`
- `pnpm worktree:manifest:guardrails`
- `pnpm worktree:stage-plan:guardrails`
- `git-hooks/pre-commit` runs the cached audit and rejects risky mixed staging

The objective is simple:

- one landable stream per commit
- explicit bridge changes only
- no more silent accumulation of unrelated work in one dirty tree

Useful extraction patterns:

- inspect only Group D:
  `pnpm worktree:audit:guardrails`
- print only Group D paths:
  `pnpm worktree:paths:guardrails`
- print a D-group landing manifest grouped by status:
  `pnpm worktree:manifest:guardrails`
- print a dry-run staging plan for Group D:
  `pnpm worktree:stage-plan:guardrails`
- inspect any group ad hoc:
  `pnpm worktree:audit -- --group C --verbose`
