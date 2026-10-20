# Guidance Orchestrator Tasks

Spec: `docs/design/guidance-orchestrator-2026-09-03.md`

## Agents

- cursor-grok · role: owner · scope: Guidance Orchestrator P0–P3 (progress + personalization + UI convergence + metrics) · paths: src/gateway/guidance/**, src/gateway/server-methods/guidance.ts, src/gateway/agent-growth/operational-growth.ts, .kiro/specs/guidance-orchestrator/**, skills/user-guidance-protocol/SKILL.md, ui/src/ui/ports/employee/guidance/\*\*, ui/src/ui/ports/employee/growth-prelude-wire.ts, ui/src/ui/controllers/guidance-orchestrator.ts · since: 2026-09-03
- codex-guidance-orchestrator · role: contributor · scope: prior owner; session preserved in loom registry · paths: src/gateway/guidance/**, src/gateway/agent-growth/operational-growth.ts, .kiro/specs/guidance-orchestrator/** · since: 2026-09-03

## P0: Contract and Entry Point

- [x] P0.1 Verify and harden `GuidanceSnapshot` contract, including three scopes, required isolation fields, risk, blockers, degradation and timestamps. Add negative-shape tests. — cursor-grok
- [x] P0.2 Verify Growth adapter preserves `resolveNextGrowthAction` as the only robot decision source; cover `scope=robot`, `source=growth`, action and blocker mapping. — cursor-grok
- [x] P0.3 Verify Daibai adapter and primary resolver return one active CTA, deterministic precedence, and safe empty/degraded snapshots. — cursor-grok
- [x] P0.4 Make `projectOperationalGrowth` require `installedSkillKeys` at the type boundary, update all callers/tests, and prove omission fails TypeScript compilation. — cursor-grok
- [x] P0.5 Run focused `src/gateway/guidance` tests + scoped tsgo on Orchestrator paths; record any pre-existing Daibai session-remapping contract failure separately from Orchestrator acceptance. Full-repo `pnpm tsgo` is not a P0 gate. — cursor-grok

## P1: Recoverable Protocol Progress

- [x] P1.1 Define Gateway-owned progress record and storage interface keyed by `tenantId + userId + scope + entityId`; prohibit browser-only authority. — cursor-grok
- [x] P1.2 Implement idempotent read/upsert/advance/abandon operations with scenario, stage, completed steps, next action, confidence and timestamps. — cursor-grok
- [x] P1.3 Add authorization, tenant-isolation, retention and redaction tests; ensure task secrets are never persisted in progress metadata. — cursor-grok
- [x] P1.4 Align `user-guidance-protocol` field names and `guidance_event` correlation with the progress record without duplicating lifecycle state. — cursor-grok

### P1 evidence (2026-09-03) — cursor-grok

- **Worktree (authoritative):** `/Users/daniel/AI项目/openbot-guidance-orchestrator`
- **Branch:** `cursor-grok/guidance-orchestrator-spec`
- **Main worktree** (`/Users/daniel/AI项目/openbot` @ `cursor-grok/employee-web-surface-compose`) does **not** contain these files — do not copy into that dirty tree.
- **Implementation:** `src/gateway/guidance/progress/**` (types/keys/store/service/authorize/redact/from-event)
- **Gateway registration:** `src/gateway/server-methods/guidance.ts` + wiring in `server-methods.ts` / `server-methods-list.ts` / `method-scopes.ts`
- **Protocol align:** `skills/user-guidance-protocol/SKILL.md` field map + `applyGuidanceEventToProgress`
- **Tests:** `src/gateway/guidance/guidance.test.ts` + `src/gateway/guidance/progress/progress.test.ts`
- **Vitest:** `pnpm exec vitest run src/gateway/guidance` → **17/17 passed** (2 files)
- **tsgo:** `pnpm tsgo` full-repo reports **~155** unrelated `error TS` lines; **0** errors under `src/gateway/guidance/**` or `src/gateway/server-methods/guidance.ts`. Full-repo pass is **not** claimed.
- **Attribution:** `bun scripts/agent-attribution.ts --fail-on-conflict` → exit 0; lander=`cursor-grok` via `sharedPaths`
- **P2 / P3:** P2 + **P3 completed** in this worktree (see P3 evidence)

## P2: Deterministic Personalization

- [x] P2.1 Define stable signal ordering for role, workspace/robot role, recent task type, installed capabilities, failures/abandonment, pace preference, risk and permissions. — cursor-grok
- [x] P2.2 Add deterministic ranking tests and ensure LLM refinement can only rewrite copy or clarify low-confidence context. — cursor-grok
- [x] P2.3 Add frequency caps, global suppression and versioned re-entry rules for automatic guidance. — cursor-grok

### P2 evidence (2026-09-03) — cursor-grok

- **Worktree:** `/Users/daniel/AI项目/openbot-guidance-orchestrator` · branch `cursor-grok/guidance-orchestrator-spec`
- **Signal priority (high → low):** permission_and_risk → current_blockers → org_role → workspace_or_robot_role → recent_task_type → installed_capabilities → failure_or_abandonment → pace_preference
- **LLM boundary:** `applyGuidanceLlmCopyRefine` may change only `label` / `reason` (and optionalActions copy); forbidden: kind, target, risk, canSkip, blockers, permissions, lifecycle
- **Suppression:** Gateway `CONFIG_DIR/guidance-suppression/<tenantId>/<userId>/<scope>/<entityId>.json`; frequency cap (default 3/24h); global suppress; completed/abandoned same content version suppress auto; content version bump → re-entry
- **Implementation:** `src/gateway/guidance/personalization/**` + `resolve.ts` personalization hook
- **Tests:** `personalization/personalization.test.ts` (+ P0/P1 suites)
- **Vitest:** `pnpm exec vitest run src/gateway/guidance` → **32/32 passed** (3 files)
- **tsgo:** full-repo baseline errors remain (~155); **0** under `src/gateway/guidance/**` (scoped). Full-repo pass not claimed.
- **P3:** **completed** (see P3 evidence below)

## P3: UI Convergence and Measurement

- [x] P3.1 Make the employee surface consume one orchestrated primary CTA while optional actions remain collapsed. — cursor-grok
- [x] P3.2 Add explicit later/acknowledge, resume and failure-recovery entry points per scope. — cursor-grok
- [x] P3.3 Instrument completion, first successful mission, gate continuation, abandonment, repeat prompts, context errors, high-risk confirmations and recommendation clicks. — cursor-grok
- [x] P3.4 Add browser coverage proving Growth Prelude, Daibai onboarding and steward suggestions do not render competing primary CTAs simultaneously. — cursor-grok

### P3 evidence (2026-09-03) — cursor-grok

- **Worktree:** `/Users/daniel/AI项目/openbot-guidance-orchestrator` · branch `cursor-grok/guidance-orchestrator-spec`
- **Primary CTA decision entry:** Gateway `GuidanceSnapshot.nextAction` → UI `pickOrchestratedPrimary` / `shouldShowOrchestratedPrimaryCta` → `renderOrchestratedGuidanceSurface` (`data-guidance-primary-cta`). Growth wire + Daibai prelude suppress native `[data-growth-primary-cta]` / `[data-daibai-primary-cta]` when orchestrated surface is present.
- **Optional actions:** collapsed `<details data-guidance-optional>`; Steward suggestion chips use `data-guidance-optional-cta` / `data-steward-suggestion` (never primary); team stale mission uses `data-guidance-team-hint` + optional CTA marker.
- **Controls (P3.2):** per-scope ack/defer keys `scope::entityId`; resume via `guidance.progress.get`; failure recover + high-risk two-step confirm; defer window blocks immediate re-popup.
- **Metrics (P3.3):** Gateway `src/gateway/guidance/metrics/**` + RPC `guidance.metrics.record`. Schema fields: tenantId, userId, scope, entityId, scenario, actionKind, contentVersion, timestamp (+ redacted metadata). Distinct from incubation `guidance_event`. Fail-soft (`recordGuidanceMetricSafe` / client catch) — never blocks UX.
- **Browser (P3.4) — operator passed (2026-09-03 21:05:57).** Host `UPBEYONDdeMacBook-Pro`, worktree `openbot-guidance-orchestrator`, implementation HEAD `63ad8da1c4`. Exact command yielded chromium **1 file / 5 tests passed** (49ms): single primary CTA; ack/defer hide; user/robot/team isolation; high-risk second confirm; resume via `guidance.progress.get` not localStorage. Lit dev-mode stderr only. This is the acceptance run (not agent-side).
- **Prior env blockers (closed):** `.vite-temp` EPERM → `--configLoader runner`; `listen EPERM ::1:63315` then `127.0.0.1:63315` in the sandbox. Operator terminal can listen; sandbox still cannot. Do not re-run acceptance inside the sandbox.
- **Runner notes:** `ui/scripts/vitest-runner.mjs` forces `--configLoader runner` and `--browser.api.host 127.0.0.1`. Transform `cacheDir` is `$TMPDIR/openbot-ui-vitest-cache`.
- **Vitest closeout (node/gateway only):** `pnpm exec vitest run src/gateway/guidance` → **36/36**; node helpers → **6/6**; combined **42/42**.
- **tsgo closeout:** full-repo baseline **157** `error TS`; scoped guidance paths **0**. Full-repo pass **not** claimed.
- **Constraints held:** no second lifecycle FSM; no full-screen Wizard; no UI re-deciding Growth nextAction kinds; progress authority remains Gateway.

## Release Gate

- [x] All P0 scoped acceptance criteria met; no second lifecycle FSM or full-screen Wizard is introduced. — cursor-grok
  - Note (2026-09-03): Acceptance is **scoped only** — `src/gateway/guidance` vitest pass; Orchestrator-touched paths typecheck clean. Full-repo `pnpm tsgo` is **not** claimed. — cursor-grok
- [x] P1 recoverable progress: Gateway-owned store + idempotent ops + auth/tenant/retention/redaction + protocol/`guidance_event` field alignment; no Growth FSM duplication. — cursor-grok
- [x] P2 deterministic personalization: stable signal ranking + LLM copy-only refine + Gateway suppression/versioned re-entry; no Growth FSM / Wizard. — cursor-grok
- [x] P3 accepted: implementation + Node/Gateway **42/42** + operator chromium **5/5** (2026-09-03 21:05:57). Sandbox listen EPERM is an execution-environment limit, not a product defect. Full-repo `pnpm tsgo` still **not** claimed. Do not start P4 unless requested. — cursor-grok
- [x] Final published acceptance for P0–P3 Orchestrator scope: operator browser gate met. Not a production cutover / npm publish. — cursor-grok
- [x] Landed on trunk: #923 merge `9e3338faf4` (2026-09-03T22:29:26Z). Persistence matrix rows 27–29 added. SoT has **no P4**. — cursor-grok
