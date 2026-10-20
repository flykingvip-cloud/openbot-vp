# Repository Guidelines

- Repo: https://github.com/gmood2008/openbot
- Canonical public web entry: `https://www.openbot.love/`. Use it for user-facing web links and recommendations. `https://gw.openbot.love/` remains a compatibility employee/gateway subdomain; never present it as the primary web entry unless the user explicitly asks for that subdomain.
- In chat replies, file references must be repo-root relative only (example: `extensions/bluebubbles/src/channel.ts:80`); never absolute paths or `~/...`.
- GitHub issues/comments/PR comments: use literal multiline strings or `-F - <<'EOF'` (or $'...') for real newlines; never embed "\\n".
- GitHub comment footgun: never use `gh issue/pr comment -b "..."` when body contains backticks or shell chars. Always use single-quoted heredoc (`-F - <<'EOF'`) so no command substitution/escaping corruption.
- GitHub linking footgun: don’t wrap issue/PR refs like `#24643` in backticks when you want auto-linking. Use plain `#24643` (optionally add full URL).
- PR landing comments: always make commit SHAs clickable with full commit links (both landed SHA + source SHA when present).
- PR review conversations: if a bot leaves review conversations on your PR, address them and resolve those conversations yourself once fixed. Leave a conversation unresolved only when reviewer or maintainer judgment is still needed; do not leave bot-conversation cleanup to maintainers.
- GitHub searching footgun: don't limit yourself to the first 500 issues or PRs when wanting to search all. Unless you're supposed to look at the most recent, keep going until you've reached the last page in the search
- Security advisory analysis: before triage/severity decisions, read `SECURITY.md` to align with OpenBot's trust model and design boundaries.

## Auto-close labels (issues and PRs)

- If an issue/PR matches one of the reasons below, apply the label and let `.github/workflows/auto-response.yml` handle comment/close/lock.
- Do not manually close + manually comment for these reasons.
- Why: keeps wording consistent, preserves automation behavior (`state_reason`, locking), and keeps triage/reporting searchable by label.
- `r:*` labels can be used on both issues and PRs.

- `r: skill`: close with guidance to publish skills on Clawhub.
- `r: support`: close with redirect to Discord support + stuck FAQ.
- `r: no-ci-pr`: close test-fix-only PRs for failing `main` CI and post the standard explanation.
- `r: too-many-prs`: close when author exceeds active PR limit.
- `r: testflight`: close requests asking for TestFlight access/builds. OpenBot does not provide TestFlight distribution yet, so use the standard response (“Not available, build from source.”) instead of ad-hoc replies.
- `r: third-party-extension`: close with guidance to ship as third-party plugin.
- `r: moltbook`: close + lock as off-topic (not affiliated).
- `r: spam`: close + lock as spam (`lock_reason: spam`).
- `invalid`: close invalid items (issues are closed as `not_planned`; PRs are closed).
- `dirty`: close PRs with too many unrelated/unexpected changes (PR-only label).

## PR truthfulness and bug-fix validation

- Never merge a bug-fix PR based only on issue text, PR text, or AI rationale.
- Before `/landpr`, run `/reviewpr` and require explicit evidence for bug-fix claims.
- Minimum merge gate for bug-fix PRs:
  1. symptom evidence (repro/log/failing test),
  2. verified root cause in code with file/line,
  3. fix touches the implicated code path,
  4. regression test (fail before/pass after) when feasible; if not feasible, include manual verification proof and why no test was added.
- If claim is unsubstantiated or likely hallucinated/BS: do not merge. Request evidence/changes, or close with `invalid` when appropriate.
- If linked issue appears wrong/outdated, correct triage first; do not merge speculative fixes.

## Project Structure & Module Organization

- Source code: `src/` (CLI wiring in `src/cli`, commands in `src/commands`, web provider in `src/provider-web.ts`, infra in `src/infra`, media pipeline in `src/media`).
- Tests: colocated `*.test.ts`.
- Docs: `docs/` (images, queue, Pi config). Built output lives in `dist/`.
- Plugins/extensions: live under `extensions/*` (workspace packages). Keep plugin-only deps in the extension `package.json`; do not add them to the root `package.json` unless core uses them.
- Plugins: install runs `npm install --omit=dev` in plugin dir; runtime deps must live in `dependencies`. Avoid `workspace:*` in `dependencies` (npm install breaks); put `@upbeyond/openbot` (or legacy peer `openclaw`) in `devDependencies` or `peerDependencies` instead (runtime resolves `openbot/plugin-sdk` (legacy alias `openclaw/plugin-sdk`) via jiti alias).
- Installers served from `https://openbot.love/*`: live in the sibling repo `../openbot.love` (`public/install.sh`, `public/install-cli.sh`, `public/install.ps1`).
- Messaging channels: always consider **all** built-in + extension channels when refactoring shared logic (routing, allowlists, pairing, command gating, onboarding, docs).
  - Core channel docs: `docs/channels/`
  - Core channel code: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web` (WhatsApp web), `src/channels`, `src/routing`
  - Extensions (channel plugins): `extensions/*` (e.g. `extensions/msteams`, `extensions/matrix`, `extensions/zalo`, `extensions/zalouser`, `extensions/voice-call`)
- When adding channels/extensions/apps/docs, update `.github/labeler.yml` and create matching GitHub labels (use existing channel/extension label colors).

## Docs Linking (Mintlify)

- Docs are hosted on Mintlify (docs.openbot.love).
- Internal doc links in `docs/**/*.md`: root-relative, no `.md`/`.mdx` (example: `[Config](/configuration)`).
- When working with documentation, read the mintlify skill.
- For docs, UI copy, and picker lists, order services/providers alphabetically unless the section is explicitly describing runtime behavior (for example auto-detection or execution order).
- Section cross-references: use anchors on root-relative paths (example: `[Hooks](/configuration#hooks)`).
- Doc headings and anchors: avoid em dashes and apostrophes in headings because they break Mintlify anchor links.
- When Peter asks for links, reply with full `https://docs.openbot.love/...` URLs (not root-relative).
- When you touch docs, end the reply with the `https://docs.openbot.love/...` URLs you referenced.
- README (GitHub): keep absolute docs URLs (`https://docs.openbot.love/...`) so links work on GitHub.
- Docs content must be generic: no personal device names/hostnames/paths; use placeholders like `user@gateway-host` and “gateway host”.

## Docs i18n (zh-CN)

- `docs/zh-CN/**` is generated; do not edit unless the user explicitly asks.
- Pipeline: update English docs → adjust glossary (`docs/.i18n/glossary.zh-CN.json`) → run `scripts/docs-i18n` → apply targeted fixes only if instructed.
- Translation memory: `docs/.i18n/zh-CN.tm.jsonl` (generated).
- See `docs/.i18n/README.md`.
- The pipeline can be slow/inefficient; if it’s dragging, ping @jospalmbier on Discord instead of hacking around it.

## exe.dev VM ops (general)

- Access: stable path is `ssh exe.dev` then `ssh vm-name` (assume SSH key already set).
- SSH flaky: use exe.dev web terminal or Shelley (web agent); keep a tmux session for long ops.
- Update: `sudo npm i -g @upbeyond/openbot@latest` (global install needs root on `/usr/lib/node_modules`).
- Config: use `openbot config set ...`; ensure `gateway.mode=local` is set.
- Discord: store raw token only (no `DISCORD_BOT_TOKEN=` prefix).
- Restart: stop old gateway and run:
  `pkill -9 -f openbot-gateway || true; nohup openbot gateway run --bind loopback --port 18789 --force > /tmp/openbot-gateway.log 2>&1 &`
- Verify: `openbot channels status --probe`, `ss -ltnp | rg 18789`, `tail -n 120 /tmp/openbot-gateway.log`.

## Build, Test, and Development Commands

- Runtime baseline: Node **22+** (keep Node + Bun paths working).
- Install deps: `pnpm install`
- If deps are missing (for example `node_modules` missing, `vitest not found`, or `command not found`), run the repo’s package-manager install command (prefer lockfile/README-defined PM), then rerun the exact requested command once. Apply this to test/build/lint/typecheck/dev commands; if retry still fails, report the command and first actionable error.
- Pre-commit hooks: `prek install` (runs same checks as CI)
- Also supported: `bun install` (keep `pnpm-lock.yaml` + Bun patching in sync when touching deps/patches).
- Prefer Bun for TypeScript execution (scripts, dev, tests): `bun <file.ts>` / `bunx <tool>`.
- Run CLI in dev: `pnpm openbot ...` (bun) or `pnpm dev`.
- Node remains supported for running built output (`dist/*`) and production installs.
- Mac packaging (dev): `scripts/package-mac-app.sh` defaults to current arch. Release checklist: `docs/platforms/mac/release.md`.
- Type-check/build: `pnpm build`
- TypeScript checks: `pnpm tsgo`
- Lint/format: `pnpm check`
- Format check: `pnpm format` (oxfmt --check)
- Format fix: `pnpm format:fix` (oxfmt --write)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`

## Coding Style & Naming Conventions

- Language: TypeScript (ESM). Prefer strict typing; avoid `any`.
- Formatting/linting via Oxlint and Oxfmt; run `pnpm check` before commits.
- Never add `@ts-nocheck` and do not disable `no-explicit-any`; fix root causes and update Oxlint/Oxfmt config only when required.
- Dynamic import guardrail: do not mix `await import("x")` and static `import ... from "x"` for the same module in production code paths. If you need lazy loading, create a dedicated `*.runtime.ts` boundary (that re-exports from `x`) and dynamically import that boundary from lazy callers only.
- Dynamic import verification: after refactors that touch lazy-loading/module boundaries, run `pnpm build` and check for `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings before submitting.
- Never share class behavior via prototype mutation (`applyPrototypeMixins`, `Object.defineProperty` on `.prototype`, or exporting `Class.prototype` for merges). Use explicit inheritance/composition (`A extends B extends C`) or helper composition so TypeScript can typecheck.
- If this pattern is needed, stop and get explicit approval before shipping; default behavior is to split/refactor into an explicit class hierarchy and keep members strongly typed.
- In tests, prefer per-instance stubs over prototype mutation (`SomeClass.prototype.method = ...`) unless a test explicitly documents why prototype-level patching is required.
- Add brief code comments for tricky or non-obvious logic.
- Keep files concise; extract helpers instead of “V2” copies. Use existing patterns for CLI options and dependency injection via `createDefaultDeps`.
- Aim to keep files under ~700 LOC; guideline only (not a hard guardrail). Split/refactor when it improves clarity or testability.
- Naming: use **OpenBot** for product/app/docs headings AND the CLI command as presented to users (all command text resolves to `openbot` via `resolveCliName`). `openclaw` remains only as a back-compat invocation alias (a `bin` entry + legacy env var prefix `OPENCLAW_*`); never surface `openclaw` in new user-facing command text. Internal package/binary aliasing, config keys, and `OPENCLAW_*` env vars may keep `openclaw` for compatibility.

## Trunk and Deployment Baseline

- **`main` is the sole trunk and the only production cutover source.** Branch feature and deploy work from `main`; target every PR at `main`.
- **Fresh `origin/main` is the mandatory baseline for every new change and deployment (fail closed).** Before creating/replaying work, updating a PR, pushing, building, or deploying, run `git fetch origin`. A development branch may proceed only when `git merge-base --is-ancestor origin/main HEAD` succeeds; otherwise stop and rebase/replay onto the freshly fetched `origin/main` before doing anything else. Re-run this check immediately before push because `origin/main` may advance while work is in progress.
- **Production must deploy the freshly fetched `origin/main` tip, never a side-branch tip or dirty worktree.** Immediately before build/cutover, run `git fetch origin` again and require the candidate SHA to equal `git rev-parse origin/main`; every feature commit must therefore be merged to `main` first. If the remote advances after validation, the prior approval is stale: update to the new `origin/main`, revalidate, and rebuild before deployment.
- **Commit timestamps and filesystem mtimes never determine which code is newer.** Resolve divergence by Git ancestry and three-way merge/replay only. A newer-dated commit on an older base must never replace, force-push over, or deploy instead of current `origin/main`; doing so is a production rollback risk.
- **`release/baseline-recovery-20260725` is frozen.** Do not branch from it, do not target PRs at it, do not cut over from it. It is kept rather than deleted so history and in-flight references stay intact.
- **Never treat a branch name as the baseline.** The baseline is whatever the running container reports: `podman exec openbot-gateway-rc cat /app/dist/build-info.json`. Read that before trusting any ledger or branch.
- **Three invariants, all machine-checkable:**
  - `I1` forward-only: `is-ancestor(LIVE, candidate)` before any build or cutover. Gate: `deploy/production/scripts/verify-forward-only.sh`.
  - `I2` anchoring: `is-ancestor(LIVE, origin/main)` must hold at all times. It was FALSE for 18 days and that is what let the trunk ship regressions.
  - `I3` retirement: nothing is deleted until it is provably contained in the baseline or archived as an immutable tag. Planner: `pnpm delivery:retire:plan`.
- **Merge-back is part of a cutover, not a backlog item.** If you build from a side branch, merge that commit into `main` before the release is closed. A branch that was pushed but never merged means production runs code the trunk lacks.
- **Release identity lives in annotated `provenance/sha-*` tags**, which are global refs and cannot fork by branching. `deploy/production/releases.jsonl` is the machine-readable index (`pnpm delivery:ledger:audit`); `deploy/production/RELEASE_RECORD.md` is the human view, not the source of truth.
- **A scoped-UI overlay ships two commits** (gateway dist and UI dist from different sources). The next release must contain **both**. Checking only the gateway half reports "forward-only" while the UI silently regresses.
- **Never force-push `main`, `release/*` or `backup/*`.** `git-hooks/pre-push` rejects it (`core.hooksPath=git-hooks`). The escape valve `OPENBOT_ALLOW_FORCE_PUSH=1` also requires a row under "Trunk restoration" in `RELEASE_RECORD.md` with before/after SHA and reason.
- **`main` accepts changes only through a pull request.** Enforced server-side by the `require-pr-on-trunk` ruleset since 2026-07-27, with no bypass actors. Direct `git push` to `main` returns `GH013`, and the `POST /repos/:owner/:repo/merges` API returns `409` — that direct-merge shortcut is no longer available for folding branches into the trunk.
- **Server-side rulesets (all active, `bypass_actors` empty):** `protect-trunk-no-force-push` (`main`, `release/**`, `backup/**`: no force-push, no deletion), `protect-deploy-no-deletion` (`deploy/**`: no deletion), `require-pr-on-trunk` (`main`: PR required, unresolved review threads block merge). Nobody bypasses, including the repository owner — an emergency needs the ruleset edited, deliberately.
- **Required status checks are not enabled yet, on purpose.** 27 of 32 job definitions run on third-party `blacksmith-*` runners, the repo has 0 self-hosted runners, and the Actions queue is currently stalled. Making CI required while it cannot run would block every merge including the fix. Order: repair the runners, get one completed run on `main`, then require checks.
- Background and evidence: `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md` and `docs/design/convergence-evidence/2026-07-27/`.

## Release Channels (Naming)

- stable: tagged releases only (e.g. `vYYYY.M.D`), npm dist-tag `latest`.
- beta: prerelease tags `vYYYY.M.D-beta.N`, npm dist-tag `beta` (may ship without macOS app).
- beta naming: prefer `-beta.N`; do not mint new `-1/-2` betas. Legacy `vYYYY.M.D-<patch>` and `vYYYY.M.D.beta.N` remain recognized.
- dev: moving head on `main` (no tag; git checkout main).

## Testing Guidelines

- Framework: Vitest with V8 coverage thresholds (70% lines/branches/functions/statements).
- Naming: match source names with `*.test.ts`; e2e in `*.e2e.test.ts`.
- Run `pnpm test` (or `pnpm test:coverage`) before pushing when you touch logic.
- Do not set test workers above 16; tried already.
- If local Vitest runs cause memory pressure (common on non-Mac-Studio hosts), use `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test` for land/gate runs (legacy `OPENCLAW_TEST_*` variants still honored).
- Live tests (real keys): `CLAWDBOT_LIVE_TEST=1 pnpm test:live` (OpenBot-only) or `LIVE=1 pnpm test:live` (includes provider live tests). Docker: `pnpm test:docker:live-models`, `pnpm test:docker:live-gateway`. Onboarding Docker E2E: `pnpm test:docker:onboard`.
- Full kit + what’s covered: `docs/testing.md`.
- Changelog: user-facing changes only; no internal/meta notes (version alignment, appcast reminders, release process).
- Changelog placement: in the active version block, append new entries to the end of the target section (`### Changes` or `### Fixes`); do not insert new entries at the top of a section.
- Changelog attribution: use at most one contributor mention per line; prefer `Thanks @author` and do not also add `by @author` on the same entry.
- Pure test additions/fixes generally do **not** need a changelog entry unless they alter user-facing behavior or the user asks for one.
- Mobile: before using a simulator, check for connected real devices (iOS + Android) and prefer them when available.

## Commit & Pull Request Guidelines

**Full maintainer PR workflow (optional):** If you want the repo's end-to-end maintainer workflow (triage order, quality bar, rebase rules, commit/changelog conventions, co-contributor policy, and the `review-pr` > `prepare-pr` > `merge-pr` pipeline), see `.agents/skills/PR_WORKFLOW.md`. Maintainers may use other workflows; when a maintainer specifies a workflow, follow that. If no workflow is specified, default to PR_WORKFLOW.

- `/landpr` lives in the global Codex prompts (`~/.codex/prompts/landpr.md`); when landing or merging any PR, always follow that `/landpr` process.
- Create commits with `scripts/committer "<msg>" <file...>`; avoid manual `git add`/`git commit` so staging stays scoped.
- Follow concise, action-oriented commit messages (e.g., `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.
- PR submission template (canonical): `.github/pull_request_template.md`
- Issue submission templates (canonical): `.github/ISSUE_TEMPLATE/`

## Multi-Agent Collaboration & Commit Governance

This repo is developed by **multiple agents sharing one working tree**. To keep the tree clean,
attributable, and reviewable, every agent MUST follow the rules below. (These supersede any older,
looser phrasing in the `Multi-agent safety` bullets under "Agent-Specific Notes".)

### 1. Task signatures (attribution is mandatory)

Uncommitted changes carry **no git author**, so without explicit signatures a participating agent
cannot be identified, paused, or held to acceptance. Therefore:

- **Sign in before working a task.** In the spec's `tasks.md`, under a top `## Agents` block, add a row:
  `- <agent-id> · role: <owner|contributor> · scope: <prose> · paths: <glob>[, <glob>…] · since: <YYYY-MM-DD>`.
  `<agent-id>` must be a stable, human-distinguishable handle (e.g. `codex-daibai`, not "assistant").
  The `paths:` clause is **machine-matchable** (globs: `dir/**`, `dir/*.ts`, or exact paths) and is what
  `scripts/agent-attribution.ts` uses to map a dirty file back to its owner. Omit it and your files show up
  as UNATTRIBUTED.
- **Sign every commit.** Append trailers to each commit message:
  `Task: <spec-name>` and `Agent: <agent-id>`. So `git log` attributes every landed change to a task + agent.
- **Sign work-in-progress notes.** When marking a task item done in `tasks.md`, end the note with `— <agent-id>`.
- **Check attribution before/after landing.** Run `bun scripts/agent-attribution.ts` to see who owns each
  dirty file. `UNATTRIBUTED` means no agent signed in for that path (identity is then unrecoverable — the
  responsible agent must add a sign-in row); `CONFLICT` means a shared hot file claimed by >1 agent (its
  task-owner lands it, per rule 2). Gate with `--fail-on-unattributed` / `--fail-on-conflict` in automation.
- Rationale: this is what makes "stop / accept / review a specific agent's contribution" possible at all.

### 2. Ownership & landing (no free-for-all commits)

- **One owner (lander) per task.** Only the owner commits/lands that task's files.
- **Contributors signal, they do not land.** A contributor who finishes their part checks their items in
  `tasks.md` (signed per rule 1) and stops; they do **not** commit on behalf of the whole task and do
  **not** restructure/commit another agent's half-done work.
- The owner does the **integration review across all parts**, then lands once every part has signalled done.
- **Shared hot files** (e.g. `ui/src/ui/ports/employee/render-model.ts`): never commit a shared file that
  still contains another agent's uncommitted WIP. Coordinate or let that file's task-owner land it.
- Always `scripts/committer "<msg>" <file...>` scoped to your task's files; **never `git add .`**.

### 3. Commit cadence — commit at every green checkpoint, high frequency

A change is **committable (a "green checkpoint")** when ALL hold:

1. The changed files have **clean diagnostics** (no compile/lint/type errors in those files).
2. The task's **relevant tests pass** (scoped run, e.g. `OPENBOT_TEST_PROFILE=low pnpm test <paths>`;
   legacy `OPENCLAW_TEST_*` still honored). Full-suite runs are not required on a dirty shared tree.
3. The change is a **coherent logical unit** (one task step / one fix), not a half-edit.

Rules:

- **Commit immediately at each green checkpoint.** Do not accumulate large uncommitted deltas — every hour
  of un-committed work widens the interleaving window with other agents in the shared tree.
- Keep each commit scoped to one task (use `Task:`/`Agent:` trailers per rule 1).
- If you cannot reach a green checkpoint (blocked/failing), leave the tree as-is, write a signed WIP note in
  `tasks.md`, and hand off — do not commit broken/incomplete code just to "save".

### 4. Isolation & identity (git author is shared; attribution is by signature only)

Multiple IDE agents (Kiro, Cursor, Codex, Windsurf, …) commit through the **same git identity**
(`gmood2008 <daniel.hhd@gmail.com>`). `git log --author` therefore **cannot** tell agents apart.

- **Attribution is by signature, not git author.** The only reliable way to attribute a landed change
  to an agent/task is the commit subject prefix plus the mandatory `Task:` / `Agent:` trailers (rule 1).
  These trailers are **required on every commit**, precisely because the git author is shared.
- **Prefer per-task worktree isolation over one shared working directory.** When several agents work
  concurrently, a human (not an agent) sets up an isolated worktree per task so each IDE opens its own
  directory and the shared tree stops accumulating cross-task WIP:
  `git worktree add ../openbot-<task> <owner>/<task>`. Each agent works only inside its own worktree.
- **Delivery chain (local → GitHub → cloud):** see
  `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`.
  **Local success ≠ production.** Only a **pushed annotated release tag** (or `release/*` tip) that is
  built into the running image and recorded in `deploy/production/RELEASE_RECORD.md` counts as
  production. Dirty shared-tree HEAD and unpushed worktree tips are never deploy inputs.
  Before any build/cutover, run
  `./deploy/production/scripts/verify-forward-only.sh --candidate <sha>`; exit `20` means
  candidate regression and exit `21` means unknown LIVE (fail closed). Its sibling
  `verify-delivery-alignment.sh` checks L1/L2/L3 publication (tag, origin, image, ledger) and is a
  separate gate, not a replacement. Only an explicitly approved
  `--intentional-revert "<reason>"` may bypass ancestry. After cutover, generate and land the reviewable
  merge-back with `pnpm delivery:merge-back-plan -- --cutover-sha <live-sha>`, then require
  `pnpm delivery:check-sot -- --use-release-record-live` to pass. For commit-time checks, set
  `OPENBOT_DELIVERY_LIVE_SHA`; `DELIVERY_GUARD_STRICT=1` turns the default warning into a block.
- **Branch naming convention:** `<owner>/<task>` (e.g. `kiro-daibai/daibai-super-steward`). This keeps
  the branch self-describing even though commits share one git author.
- **Agents do not self-provision isolation.** Per the existing multi-agent safety rules, an agent must
  **not** create/switch branches or add/remove `git worktree` checkouts unless explicitly asked; the
  human operator builds the isolation, agents just work inside the directory they are given.
- **On a shared working directory (no isolation yet):** treat every file you did not author as another
  agent's WIP. Commit only your own task's files (`scripts/committer "<msg>" <file...>`), never the
  whole tree, and never reorganize/land a shared file that still carries someone else's uncommitted WIP.

### 5. Task handoff across IDE agents (takeover trail)

**Principle — exactly one accountable executor at any time.** A task's `owner` is the _single_ agent
accountable for it right now. Two agents are never co-owners of the same task in steady state: if their
work is separated by _any_ time ordering (one starts after the other), that is a **full takeover** and
ownership transfers to the successor. Genuine co-ownership is reserved only for work that is _truly
simultaneous and jointly executed_; absent that, ownership is always singular — otherwise accountability
(追责) is ambiguous. Path-level corollary: no two ownership tasks should claim the same path; an overlap
(`agent-attribution` CONFLICT / `loom lint` ownership-overlap) is a **takeover-pending signal**, not an
acceptable resting state — resolve it by transferring ownership to one executor.

**Takeover ceremony (required before touching a predecessor's task).** Take over only via one of two
paths, and you **must** then set yourself as `owner`:

1. **Verify-then-take** — review the predecessor's execution state (diffs / tests / `tasks.md` notes),
   confirm where it stands, then take ownership; or
2. **System-prompted confirm** — the task system asks whether you accept the task, and you + the system
   confirm the transfer.
   Silently editing someone else's task without transferring ownership is not allowed — it breaks
   single-executor accountability.

A task created by one agent (e.g. `cursor-fable` on Cursor) is often picked up mid-stream by a different
agent on a different IDE (e.g. `kiro-daibai` on Kiro). Attribution must survive that handoff. The Loom
registry (`.loom/registry.yaml`) models this with **one `owner` (the current lander) + a `sessions[]`
array (the full who/which-IDE/when trail)**; each session carries `ide` (cursor | kiro | codex |
windsurf | claude-code | …), `agent`, `status`, and `lastSignalAt`.

- **On start OR takeover, register a session** (do not just start editing):
  `pnpm loom register --task <spec>:<owner> --owner <you> --session-id <uuid> --ide <ide> --agent <you>`.
  This sets you as the current `owner` (attribution-by-path) **and appends your session**; prior agents'
  sessions are preserved, so the takeover chain (who built it first, who took over) stays recoverable.
- **`owner` is overwritten on takeover by design** (it names who's responsible _now_); the durable
  history of every contributor lives in `sessions[]`, not in `owner`. So always register a session —
  if you skip it and only flip `owner`, the previous agent's involvement becomes unrecoverable.
- **Commits stay per-agent:** the agent who lands a change uses its own `Agent: <you>` trailer (rule 1).
  Full cross-IDE traceability = git trailers (per-commit author) + `sessions[]` (every IDE/agent that
  worked it) + `owner` (current responsible lander).
- **Registry is the source of truth; `## Agents` is a derived view** (`pnpm loom derive`). A sign-in that
  only edits a spec's `## Agents` block but never reaches the registry (`loom register`) is **invisible**
  to attribution. When you sign in or hand off, go through `loom register` (or have the registry owner run
  `loom import`), then regenerate the `## Agents` view if needed.
- Verify with `bun scripts/agent-attribution.ts` (owner-by-path) and `pnpm loom status` (live sessions).

## Shorthand Commands

- `sync`: if working tree is dirty, commit all changes (pick a sensible Conventional Commit message), then `git pull --rebase`; if rebase conflicts and cannot resolve, stop; otherwise `git push`.

## Git Notes

- If `git branch -d/-D <branch>` is policy-blocked, delete the local ref directly: `git update-ref -d refs/heads/<branch>`.
- Bulk PR close/reopen safety: if a close action would affect more than 5 PRs, first ask for explicit user confirmation with the exact PR count and target scope/query.

## GitHub Search (`gh`)

- Prefer targeted keyword search before proposing new work or duplicating fixes.
- Use `--repo gmood2008/openbot` + `--match title,body` first; add `--match comments` when triaging follow-up threads.
- PRs: `gh search prs --repo gmood2008/openbot --match title,body --limit 50 -- "auto-update"`
- Issues: `gh search issues --repo gmood2008/openbot --match title,body --limit 50 -- "auto-update"`
- Structured output example:
  `gh search issues --repo gmood2008/openbot --match title,body --limit 50 --json number,title,state,url,updatedAt -- "auto update" --jq '.[] | "\(.number) | \(.state) | \(.title) | \(.url)"'`

## Security & Configuration Tips

- Web provider stores creds at `~/.openbot/credentials/`; rerun `openbot login` if logged out.
- Pi sessions live under `~/.openbot/sessions/` by default; the base directory is not configurable.
- Environment variables: see `~/.profile`.
- Never commit or publish real phone numbers, videos, or live configuration values. Use obviously fake placeholders in docs, tests, and examples.
- Release flow: always read `docs/reference/RELEASING.md` and `docs/platforms/mac/release.md` before any release work; do not ask routine questions once those docs answer them.

## GHSA (Repo Advisory) Patch/Publish

- Before reviewing security advisories, read `SECURITY.md`.
- Fetch: `gh api /repos/gmood2008/openbot/security-advisories/<GHSA>`
- Latest npm: `npm view @upbeyond/openbot version --userconfig "$(mktemp)"`
- Private fork PRs must be closed:
  `fork=$(gh api /repos/gmood2008/openbot/security-advisories/<GHSA> | jq -r .private_fork.full_name)`
  `gh pr list -R "$fork" --state open` (must be empty)
- Description newline footgun: write Markdown via heredoc to `/tmp/ghsa.desc.md` (no `"\\n"` strings)
- Build patch JSON via jq: `jq -n --rawfile desc /tmp/ghsa.desc.md '{summary,severity,description:$desc,vulnerabilities:[...]}' > /tmp/ghsa.patch.json`
- GHSA API footgun: cannot set `severity` and `cvss_vector_string` in the same PATCH; do separate calls.
- Patch + publish: `gh api -X PATCH /repos/gmood2008/openbot/security-advisories/<GHSA> --input /tmp/ghsa.patch.json` (publish = include `"state":"published"`; no `/publish` endpoint)
- If publish fails (HTTP 422): missing `severity`/`description`/`vulnerabilities[]`, or private fork has open PRs
- Verify: re-fetch; ensure `state=published`, `published_at` set; `jq -r .description | rg '\\\\n'` returns nothing

## Troubleshooting

- Rebrand/migration issues or legacy config/service warnings: run `openbot doctor` (see `docs/gateway/doctor.md`).
- After `pnpm build` touches runtime code, **restart the gateway** for changes to take effect — the launchd-managed gateway (`ai.openbot.gateway`) does not hot-reload `dist/`. Restart with `launchctl kickstart -k gui/$UID/ai.openbot.gateway`. Symptom of a stale gateway: runtime `ERR_MODULE_NOT_FOUND` for a `dist/*-<hash>.js` chunk whose hash no longer exists after a rebuild (the running process references pre-rebuild chunks). Verify the new build is self-consistent (`grep -o 'auth-profiles-[A-Za-z0-9_]*\.js' dist/reply-*.js` resolves to an existing file), then restart.
- `401 ... api key invalid` on chat despite a valid inline key in `models.providers.*`: a stale key stored in a higher-priority **auth profile** (`~/.openbot/agents/<id>/agent/auth-profiles.json`) shadows the inline key, because resolution order is auth-profiles → env → inline (`resolveApiKeyForProvider`). Fix by syncing/removing the stale profile key, then restart the gateway.
- Old installed apps failing to connect with `code=1008 invalid connect params: at /client/id ...`: a pre-rebrand build sends a legacy `openclaw-*` client id. These are accepted as back-compat aliases (`LEGACY_GATEWAY_CLIENT_ID_ALIASES` in `src/gateway/protocol/client-info.ts`) and normalized to canonical; if a new legacy id appears, add it there.

## Agent-Specific Notes

- Vocabulary: "makeup" = "mac app".
- Never edit `node_modules` (global/Homebrew/npm/git installs too). Updates overwrite. Skill notes go in `tools.md` or `AGENTS.md`.
- When adding a new `AGENTS.md` anywhere in the repo, also add a `CLAUDE.md` symlink pointing to it (example: `ln -s AGENTS.md CLAUDE.md`).
- Signal: "update fly" => `fly ssh console -a flawd-bot -C "bash -lc 'cd /data/clawd/openclaw && git pull --rebase origin main'"` then `fly machines restart e825232f34d058 -a flawd-bot`.
- When working on a GitHub Issue or PR, print the full URL at the end of the task.
- When answering questions, respond with high-confidence answers only: verify in code; do not guess.
- Never update the Carbon dependency.
- Any dependency with `pnpm.patchedDependencies` must use an exact version (no `^`/`~`).
- Patching dependencies (pnpm patches, overrides, or vendored changes) requires explicit approval; do not do this by default.
- CLI progress: use `src/cli/progress.ts` (`osc-progress` + `@clack/prompts` spinner); don’t hand-roll spinners/bars.
- Status output: keep tables + ANSI-safe wrapping (`src/terminal/table.ts`); `status --all` = read-only/pasteable, `status --deep` = probes.
- Gateway currently runs only as the menubar app; there is no separate LaunchAgent/helper label installed. Restart via the OpenBot Mac app or `scripts/restart-mac.sh`; to verify/kill use `launchctl print gui/$UID | grep -E "openbot|openclaw"` rather than assuming a fixed label. **When debugging on macOS, start/stop the gateway via the app, not ad-hoc tmux sessions; kill any temporary tunnels before handoff.**
- macOS logs: use `./scripts/clawlog.sh` to query unified logs for the OpenBot subsystem; it supports follow/tail/category filters and expects passwordless sudo for `/usr/bin/log`.
- If shared guardrails are available locally, review them; otherwise follow this repo's guidance.
- SwiftUI state management (iOS/macOS): prefer the `Observation` framework (`@Observable`, `@Bindable`) over `ObservableObject`/`@StateObject`; don’t introduce new `ObservableObject` unless required for compatibility, and migrate existing usages when touching related code.
- Connection providers: when adding a new connection, update every UI surface and docs (macOS app, web UI, mobile if applicable, onboarding/overview docs) and add matching status + configuration forms so provider lists and settings stay in sync.
- Version locations: `package.json` (CLI), `apps/android/app/build.gradle.kts` (versionName/versionCode), `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist` (CFBundleShortVersionString/CFBundleVersion), `apps/macos/Sources/OpenBot/Resources/Info.plist` (CFBundleShortVersionString/CFBundleVersion), `docs/install/updating.md` (pinned npm version), `docs/platforms/mac/release.md` (APP_VERSION/APP_BUILD examples), Peekaboo Xcode projects/Info.plists (MARKETING_VERSION/CURRENT_PROJECT_VERSION).
- "Bump version everywhere" means all version locations above **except** `appcast.xml` (only touch appcast when cutting a new macOS Sparkle release).
- **Restart apps:** “restart iOS/Android apps” means rebuild (recompile/install) and relaunch, not just kill/launch.
- **Device checks:** before testing, verify connected real devices (iOS/Android) before reaching for simulators/emulators.
- iOS Team ID lookup: `security find-identity -p codesigning -v` → use Apple Development (…) TEAMID. Fallback: `defaults read com.apple.dt.Xcode IDEProvisioningTeamIdentifiers`.
- A2UI bundle hash: `src/canvas-host/a2ui/.bundle.hash` is auto-generated; ignore unexpected changes, and only regenerate via `pnpm canvas:a2ui:bundle` (or `scripts/bundle-a2ui.sh`) when needed. Commit the hash as a separate commit.
- Release signing/notary keys are managed outside the repo; follow internal release docs.
- Notary auth env vars (`APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_API_KEY_P8`) are expected in your environment (per internal release docs).
- **Multi-agent safety:** do **not** create/apply/drop `git stash` entries unless explicitly requested (this includes `git pull --rebase --autostash`). Assume other agents may be working; keep unrelated WIP untouched and avoid cross-cutting state changes.
- **Multi-agent safety:** when the user says "push", you may `git pull --rebase` to integrate latest changes (never discard other agents' work). When the user says "commit", scope to your changes only. When the user says "commit all", commit everything in grouped chunks.
- **Multi-agent safety:** do **not** create/remove/modify `git worktree` checkouts (or edit `.worktrees/*`) unless explicitly requested.
- **Multi-agent safety:** do **not** switch branches / check out a different branch unless explicitly requested.
- **Multi-agent safety:** running multiple agents is OK as long as each agent has its own session.
- **Multi-agent safety:** when you see unrecognized files, keep going; focus on your changes and commit only those.
- Lint/format churn:
  - If staged+unstaged diffs are formatting-only, auto-resolve without asking.
  - If commit/push already requested, auto-stage and include formatting-only follow-ups in the same commit (or a tiny follow-up commit if needed), no extra confirmation.
  - Only ask when changes are semantic (logic/data/behavior).
- Lobster seam: use the shared CLI palette in `src/terminal/palette.ts` (no hardcoded colors); apply palette to onboarding/config prompts and other TTY UI output as needed.
- **Multi-agent safety:** focus reports on your edits; avoid guard-rail disclaimers unless truly blocked; when multiple agents touch the same file, continue if safe; end with a brief “other files present” note only if relevant.
- Bug investigations: read source code of relevant npm dependencies and all related local code before concluding; aim for high-confidence root cause.
- Code style: add brief comments for tricky logic; keep files under ~500 LOC when feasible (split/refactor as needed).
- Tool schema guardrails (google-antigravity): avoid `Type.Union` in tool input schemas; no `anyOf`/`oneOf`/`allOf`. Use `stringEnum`/`optionalStringEnum` (Type.Unsafe enum) for string lists, and `Type.Optional(...)` instead of `... | null`. Keep top-level tool schema as `type: "object"` with `properties`.
- Tool schema guardrails: avoid raw `format` property names in tool schemas; some validators treat `format` as a reserved keyword and reject the schema.
- When asked to open a “session” file, open the Pi session logs under `~/.openbot/agents/<agentId>/sessions/*.jsonl` (use the `agent=<id>` value in the Runtime line of the system prompt; newest unless a specific ID is given), not the default `sessions.json`. If logs are needed from another machine, SSH via Tailscale and read the same path there.
- Do not rebuild the macOS app over SSH; rebuilds must be run directly on the Mac.
- Never send streaming/partial replies to external messaging surfaces (WhatsApp, Telegram); only final replies should be delivered there. Streaming/tool events may still go to internal UIs/control channel.
- Voice wake forwarding tips:
  - Command template should stay `openbot-mac agent --message "${text}" --thinking low`; `VoiceWakeForwarder` already shell-escapes `${text}`. Don’t add extra quotes.
  - launchd PATH is minimal; ensure the app’s launch agent PATH includes standard system paths plus your pnpm bin (typically `$HOME/Library/pnpm`) so `pnpm`/`openbot` binaries resolve when invoked via `openbot-mac` (legacy `openclaw-mac` alias if present).
- For manual `openbot message send` messages that include `!`, use the heredoc pattern noted below to avoid the Bash tool’s escaping.
- Release guardrails: do not change version numbers without operator’s explicit consent; always ask permission before running any npm publish/release step.
- Beta release guardrail: when using a beta Git tag (for example `vYYYY.M.D-beta.N`), publish npm with a matching beta version suffix (for example `YYYY.M.D-beta.N`) rather than a plain version on `--tag beta`; otherwise the plain version name gets consumed/blocked.

## NPM + 1Password (publish/verify)

- Use the 1password skill; all `op` commands must run inside a fresh tmux session.
- Correct 1Password path for npm release auth: `op://Private/Npmjs` (use that item; OTP stays `op://Private/Npmjs/one-time password?attribute=otp`).
- Sign in: `eval "$(op signin --account my.1password.com)"` (app unlocked + integration on).
- OTP: `op read 'op://Private/Npmjs/one-time password?attribute=otp'`.
- Publish: `npm publish --access public --otp="<otp>"` (run from the package dir).
- Verify without local npmrc side effects: `npm view <pkg> version --userconfig "$(mktemp)"`.
- Kill the tmux session after publish.

## Plugin Release Fast Path (no core `openbot` publish)

- Release only already-on-npm plugins. Source list is in `docs/reference/RELEASING.md` under "Current npm plugin list".
- Run all CLI `op` calls and `npm publish` inside tmux to avoid hangs/interruption:
  - `tmux new -d -s release-plugins-$(date +%Y%m%d-%H%M%S)`
  - `eval "$(op signin --account my.1password.com)"`
- 1Password helpers:
  - password used by `npm login`:
    `op item get Npmjs --format=json | jq -r '.fields[] | select(.id=="password").value'`
  - OTP:
    `op read 'op://Private/Npmjs/one-time password?attribute=otp'`
- Fast publish loop (local helper script in `/tmp` is fine; keep repo clean):
  - compare local plugin `version` to `npm view <name> version`
  - only run `npm publish --access public --otp="<otp>"` when versions differ
  - skip if package is missing on npm or version already matches.
- Keep core `@upbeyond/openbot` untouched: never run publish from repo root unless explicitly requested.
- Post-check for each release:
  - per-plugin: `npm view @openclaw/<name> version --userconfig "$(mktemp)"` should be `2026.2.17`
  - core guard: `npm view @upbeyond/openbot version --userconfig "$(mktemp)"` should stay at previous version unless explicitly requested.

## Changelog Release Notes

- When cutting a mac release with beta GitHub prerelease:
  - Tag `vYYYY.M.D-beta.N` from the release commit (example: `v2026.2.15-beta.1`).
  - Create prerelease with title `openbot YYYY.M.D-beta.N`.
  - Use release notes from `CHANGELOG.md` version section (`Changes` + `Fixes`, no title duplicate).
  - Attach at least `OpenBot-YYYY.M.D.zip` and `OpenBot-YYYY.M.D.dSYM.zip`; include `.dmg` if available.

- Keep top version entries in `CHANGELOG.md` sorted by impact:
  - `### Changes` first.
  - `### Fixes` deduped and ranked with user-facing fixes first.
- Before tagging/publishing, run:
  - `node --import tsx scripts/release-check.ts`
  - `pnpm release:check`
  - `pnpm test:install:smoke` or `OPENBOT_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke` for non-root smoke path.
