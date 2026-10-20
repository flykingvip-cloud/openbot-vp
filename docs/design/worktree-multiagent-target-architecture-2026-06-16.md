# Multi-User Multi-Agent Workspace: Target Architecture and Migration (2026-06-16)

> Status: design note. Scope: how many users, across many IDEs, running many task
> windows (agents), collaborate without dirtying the working tree and with easy,
> supervised merges.
>
> Positioning: **Loom is a subsystem of OpenBot Fabric**, not a standalone product.
> Everything below must converge with and conform to Fabric's control-plane
> contract and four-layer boundary (see `.kiro/specs/openbot-fabric/`). This doc
> defines the target workspace-governance architecture and the migration path,
> and makes the Loom to Fabric convergence explicit.

## 1. Problem

Today: N agents (multiple users, multiple IDEs, multiple chat windows) read/write
**one shared working tree on one branch**. Consequences already measured in this
repo: ~307 dirty files with ~294 UNATTRIBUTED (no agent signed in). This is the
anti-pattern Loom was created to contain; Loom so far is damage control, not a cure.

Root causes:

1. Sign-in (`## Agents`) is voluntary, manual, out-of-band; agents forget.
2. Deeper Git constraint: uncommitted edits have no author, so the whole dirty
   tree cannot be attributed centrally. You cannot know which window edited an
   uncommitted file from outside the IDE.
3. The only deterministic attribution boundary is **commit**.

## 2. Control-plane authority: one decider, two enforcers (review fix 1)

Risk identified in review: the previous framing read as **three competing
control planes** (Loom, Fabric Policy Runtime, GitHub/Merge Queue), leaving "who
is the final decision system" ambiguous. Resolution, adopted here as a hard rule:

```
Fabric Policy Runtime   = the SINGLE policy authority (ALLOW / DENY / MODIFY)
        ^ signals only
Loom                    = governance DATA / signal layer + local workspace enforcement
        ^ enforcement only
GitHub / Merge Queue    = remote enforcement authority (merge gate), not a decider
TOL                     = execution
```

- **Only Fabric Policy Runtime decides** ALLOW / DENY / MODIFY for tool execution.
- **Loom is a signal layer**, never a policy decision input. It supplies:
  ownership signal, path constraint (hard signal), and **risk annotation** (the
  former "landing policy / hot-file" is demoted from decision input to risk
  annotation). Loom additionally performs **local workspace enforcement** (git
  staging hygiene, sign-in at commit) which is deterministic and path-based, not
  a tool-execution policy engine.
- **GitHub enforces** at merge (required checks, Merge Queue, CODEOWNERS); it does
  not author policy.

This is one policy system plus two enforcement layers, not three policy systems.
The same principle is already encoded in `src/fabric/mappers.ts`: the
`loom.attribution` decisionTrace entry is emitted with `effect: "neutral"` —
attribution is informational input, never the deciding effect by itself.

## 3. The three-stage Policy pipeline (review fix 3)

Fabric's Policy Runtime must not become a "mini-OPA + mini-orchestrator +
mini-risk-engine". It converges into a strict 3-stage pipeline, and Loom feeds
**only Stage 2**:

```
Stage 1  Hard Gate (deterministic, early reject)
         scope · allowlist · exec-approval         -> DENY short-circuits here
              v  (pass)
Stage 2  Governance Signals (metadata only, never gates by itself)
         Loom: ownership signal · path hard-signal · risk annotation
              v
Stage 3  Constraint shaping (execution shaping only)
         sandbox · cost · timeout · network         -> ALLOW / MODIFY constraints
```

- **Stage 1 is the only place a request is rejected** on hard signals (path /
  scope / domain per Rule #1). Loom never participates in Stage 1.
- **Stage 2 is metadata only.** Loom attribution, ownership, and path risk
  annotation are attached for explainability (`decisionTrace`) and to inform
  Stage 3 shaping; a Stage 2 signal can never, by itself, flip ALLOW to DENY.
- **Stage 3 shapes execution** (sandbox profile, cost budget, timeout, network
  egress) for ALLOW / MODIFY; it does not author allow/deny.

Loom's single insertion point is Stage 2. This keeps the decider (Fabric) and the
signal layer (Loom) cleanly separated and is what makes "one decider, two
enforcers" enforceable rather than aspirational.

## 4. Target architecture (three physical layers, none optional)

Physically the work still lands in three layers; the authority model in section 2
governs who decides versus who enforces.

```
Layer 2  Remote integration + supervision (GitHub / GitLab)
         protected main, required checks, CODEOWNERS, Merge Queue, PR review
              ^  push branch / open PR
Layer 1  Local governance + enforcement (Loom: signals + workspace hygiene)
         ownership registry (signal), path constraints (hard signal),
         risk annotation (landing/hot-file), parity gate, claim sign-in,
         lifecycle  — enforces git staging hygiene; does NOT author policy
              ^  reads/writes
Layer 0  Isolation (no shared dirty tree)
         one branch <owner>/<task> per task window (agent)
         same machine -> git worktree ; different users -> own clone
```

### Layer 0: isolation eliminates the dirty-tree problem at the source

- One task window (agent) maps to one branch `<owner>/<task>`.
- Same machine, many windows: `git worktree` (independent working dirs, zero
  edit-time interleaving). Different users/machines: each their own clone.
- There is no shared dirty tree to dirty. Edit-time interleaving goes to zero.
- This is Loom design Phase 2 (Provisioning), not yet implemented.

### Layer 1: Loom local governance and enforcement (what is built today)

- Ownership registry (`tasks`) and audit landing streams (`landingStreams`),
  attribution, `loom check` parity gate, `loom claim` one-step sign-in,
  lifecycle state machine, `loom lint`, cross-branch hot-file detection.
- **Role under the authority model (section 2):** Loom is a **signal layer plus
  local workspace enforcement**, not a policy authority. It (a) supplies
  ownership signal, path hard-signal, and risk annotation to Fabric's Policy
  Runtime Stage 2, and (b) enforces deterministic git staging hygiene locally. It
  never authors ALLOW / DENY / MODIFY for tool execution.
- In an isolated world Loom shifts from "untangle the shared tree" to
  "coordinate landing order, attribute commits, warn on cross-branch hot files,
  and supply governance signals to Fabric".

### Layer 2: GitHub is required (it owns the half Loom cannot)

| Concern         | Loom (local, pre-commit)               | GitHub (remote, post-commit)          |
| --------------- | -------------------------------------- | ------------------------------------- |
| Who owns what   | ownership registry / `claim`           | PR author + branch name + CODEOWNERS  |
| Keep tree clean | isolation + pre-commit audit           | protected branch + required checks    |
| Easy merges     | landing policy / risky-mix (local預判) | Merge Queue (auto rebase + serialize) |
| Supervision     | `loom status` (local in-flight)        | PR list / checks / review (authority) |
| Zero regression | `loom check --strict`                  | branch protection required check      |

Recommended GitHub configuration:

- Protected `main`: required status checks (CI plus `loom check`), required
  review, linear history.
- **Merge Queue** on: auto-rebase each branch onto main, re-run checks, serialize
  integration. This is the authoritative form of Loom's local landing policy and
  is the answer to "easy merges" under many concurrent branches.
- **CODEOWNERS**: path to owner mapping enforced at PR review. This is GitHub's
  native version of Loom's ownership registry; the two should be generated from a
  single source (see sections 6 and 9).

## 5. Identity model resolved by isolation

The hard problem from the shared-tree world (uncommitted edits have no author,
so 294 files are UNATTRIBUTED) dissolves under isolation:

- A task window equals a branch. The branch name `<owner>/<task>` IS the durable,
  human-distinguishable agent identity.
- Commits on that branch carry a real author plus branch plus PR identity.
- Cross-port / chat-window detection is unnecessary for attribution: the branch
  is the handle. (External CLI probing can at best enumerate IDE instances and
  listening runtime ports, never a specific chat window; only an in-IDE
  extension can inject a true window handle. See the prior analysis.)
- Recency is already covered by `session.lastSignalAt`; sign-in friction is
  removed by `loom claim` at the commit boundary.

## 6. Loom to Fabric convergence (mandatory framing)

Per `.kiro/specs/openbot-fabric/` Rule #3 and Rule #4:

> AOR owns execution structure (the only Planner). Fabric owns permission +
> transformation + audit. TOL owns execution. **Loom owns static governance
> metadata.** Loom is a compile-time metadata source, NOT an engine; it is
> physically independent from Fabric and is not merged into it; runtime Loom
> lookup is forbidden (Loom hints are baked into the PolicyDecision at decide
> time, via a stable read boundary).

This workspace-governance architecture must therefore land as follows:

1. **Loom is a signal layer, not a second control plane and not a policy input
   beyond signals.** The registry (ownership tasks, paths as path hard-signals,
   attribution, lifecycle) is **governance data**. Loom feeds Fabric only three
   signal kinds: **ownership signal, path constraint (hard signal), and risk
   annotation**. The former "landing policy / hot-file" is **demoted from a
   decision input to a risk annotation** (review fix 1). Worktree provisioning
   and GitHub integration are workspace-level enforcement of the same data, not a
   parallel decider.

2. **Consumption is via the existing stable boundary, at compile time, into the
   Signal stage only.** Fabric reads Loom through `src/fabric/mappers.ts`
   (`attributionToOwnership`, `attributionTraceEntry`) over a stable
   `LoomAttribution` shape, with no `src -> scripts` coupling. Loom signals enter
   the Policy Runtime **only at Stage 2 (Governance Signals)** of the pipeline in
   section 3; they never gate (Stage 1) and never author constraints (Stage 3) by
   themselves. No runtime Loom lookup; no new engine inside Fabric.

3. **Conform to Fabric architecture laws:**
   - Rule #1: Path / scope / domain are deterministic hard signals; intent never
     participates in any gate. Loom already enforces this (path hard, intent
     soft); the workspace layer must keep it.
   - Reuse-first: do not build a parallel permission, audit, or scheduling system.
     Worktree provisioning reuses Git; merge governance reuses GitHub; decision
     and audit reuse Fabric Policy Runtime and `control-plane-audit`.
   - Feature-gated, zero-regression: any workspace-governance enforcement wired
     into commit or CI must not relax existing reject sets, and must be gateable.
   - Single decision point plus recompile: governance metadata is an input to the
     one compile-time decision; it is not re-evaluated at runtime.

4. **Do not merge Loom into Fabric.** Loom remains the `scripts/`-side workspace
   governance tool and metadata producer; Fabric remains `src/fabric/**`. The
   convergence is a data contract (Loom metadata to Fabric `PolicyDecision`
   inputs), not a code merge.

### 6.1 Concept to artifact to platform to Fabric mapping

| Workspace concept           | Loom artifact                | GitHub feature                | Fabric contract element                                  |
| --------------------------- | ---------------------------- | ----------------------------- | -------------------------------------------------------- |
| Ownership (who owns a path) | registry `tasks` / `claim`   | CODEOWNERS                    | `attributionToOwnership` to PolicyDecision metadata (S2) |
| Landing policy / hot-file   | `landingStreams` / risky-mix | Merge Queue / required checks | risk annotation (Stage 2 signal) + local staging enforce |
| Path hard-signal            | glob match (`glob.ts`)       | path filters                  | scope / allowlist probes (Stage 1 hard signals, Rule #1) |
| Attribution audit           | `agent-attribution` / parity | PR author / commit author     | `decisionTrace` `loom.attribution` (effect: neutral)     |
| Sign-in (agent identity)    | `loom claim` at commit       | branch `<owner>/<task>` + PR  | `source.{userId,tenantId}` on `ToolRequest`              |
| Lifecycle (alive / dead)    | `state` / `lastSignalAt`     | open / closed PR              | run-state projection (Trace Layer)                       |

Note the corrected row 2: landing policy and hot-file risk map to a **Stage 2
risk annotation plus local staging enforcement**, NOT to a "governance metadata
input to decide". Loom never decides; it annotates and locally enforces staging.

## 7. Product-layer SDK abstraction (review fix: platform surface)

Today the work is internal architecture. To be a sellable platform, Fabric needs
a stable product-layer SDK. This is a recommendation to the Fabric spec owner;
the Workspace API is the only surface Loom directly backs.

```
OpenBot Fabric SDK
  ├── Policy API      decide(ToolRequest) -> PolicyDecision (3-stage pipeline, §3)
  ├── Execution API   run(decision) -> result (TOL substrate)
  ├── Graph API       orchestrate DAG (simplified: chain + fork/join + deps, §8)
  ├── Audit API       decisionTrace + control-plane-audit query
  └── Workspace API   ownership / attribution / lifecycle  <- Loom adapter
```

- **Policy / Execution / Graph / Audit APIs are Fabric-owned** and out of scope
  for this doc except as consumers of Loom signals.
- **Workspace API is the Loom adapter.** It exposes ownership, attribution, and
  lifecycle as a read interface over the `LoomAttribution` boundary. Commercially
  this is "workspace governance SDK" (IDE / CLI / CI integration); Fabric is the
  "control-plane SaaS"; TOL is the execution substrate.
- This keeps the platform story honest: Loom is one product surface (Workspace
  API) inside the Fabric SDK, not a competing platform.

## 8. Recommendations for the Fabric spec owner (kiro-fabric)

These belong to `openbot-fabric` (owner `kiro-fabric`) and are recorded here as
cross-team recommendations only; this doc does not modify that spec.

1. **Graph Runtime: downgrade from engine to orchestrator (review fix 2).** For
   v1, Fabric's Graph Runtime should be an **Execution DAG Orchestrator**, not a
   full graph engine. Keep: linear chain, fork/join, dependency ordering. Drop
   for v1: Selector strategy (belongs to AOR, the only Planner per Rule #3),
   policy-aware graph construction (policy must be resolved before graph
   construction, not during it), and dynamic mutation / graph rewrite (defer to
   v2). Rationale: avoid a workflow-engine + policy-engine + execution-engine
   three-in-one whose complexity is uncontrollable in v1, and avoid re-defining
   AOR Planner/Selector inside the kernel.

2. **Policy Runtime: converge to the 3-stage pipeline (review fix 3).** Adopt the
   Hard Gate / Governance Signals / Constraint shaping pipeline from section 3 as
   the canonical structure, with deterministic early reject in Stage 1, Loom as
   Stage 2 metadata only, and Stage 3 as execution shaping only. This bounds the
   Policy Runtime and prevents it from sprawling into a mini-OPA + mini-risk
   engine.

3. **Preserve the production-grade assets already present:** `decisionTrace`
   (explainability), feature-gated zero-regression rollout, and the static
   `LoomAttribution` read boundary (no `src -> scripts` coupling). These are
   correct and should not be diluted during convergence.

## 9. Migration roadmap (from shared tree to isolation plus GitHub plus Fabric)

Phased, each step independently shippable, zero-regression, feature-gated.

- **M0 (done): Loom local governance MVP.** Registry single source of truth,
  attribution and audit cutover (registry-gated with legacy fallback), `loom
check` parity gate (M1), CLI, lifecycle, `claim` sign-in. This is the bridge
  that keeps the current shared tree governable during migration.

- **M1: commit-boundary sign-in becomes routine.** Adopt `loom claim --staged`
  in the commit flow; add the pre-commit warn gate (`loom unattributed
--staged`); CI parity step promoted from warn to required after a clean window.
  Outcome: committed work is always attributed even before isolation lands.

- **M2: Loom Phase 2 provisioning (isolation).** Implement `loom task
start/land/abandon`: create per-task worktree plus branch `<owner>/<task>` plus
  per-worktree git identity; land via merge or PR; GC on completion. A human
  authorizes provisioning (per AGENTS multi-agent safety); agents work only in
  their assigned worktree. Outcome: shared dirty tree retired; edit-time
  interleaving goes to zero.

- **M3: GitHub integration as the authoritative integration layer.** Turn on
  protected main, required checks (CI plus `loom check`), Merge Queue, and
  CODEOWNERS generated from the Loom registry (`loom derive` extended to emit
  CODEOWNERS). Outcome: easy, serialized, supervised merges; supervision via PRs.

- **M4: Fabric convergence.** Expose the workspace-governance metadata as
  **Stage 2 signals only** (ownership signal, path hard-signal, risk annotation)
  to Fabric via the `LoomAttribution` boundary, so the Policy Runtime consumes
  them at compile time in `PolicyDecision` without deciding on them. Back the
  Fabric SDK Workspace API (section 7) with the same adapter. Keep Loom
  independent; no runtime lookup; conform to Rules #1 to #4. Outcome:
  tool-execution decisions are governance-aware (signals only), sharing one
  metadata source with the workspace layer; Loom never becomes a decider.

- **M5 (later): IDE extension (Fabric / Loom view layer).** Inject true
  session/window handles and heartbeat, making `lastSignalAt` and dead detection
  reliable and binding chat windows to branches automatically. This is the only
  way to reach window-level identity; it is out of scope until the CLI and
  contract are stable.

## 10. Risks and costs (honest)

- Disk and build cost: N worktrees or clones means N working copies and N build
  artifact sets. Shared `.git` and pnpm store help; build caches do not.
- Isolation is not zero-conflict: hot files (a god-file edited by many branches)
  move the conflict from invisible dirty-tree interleaving to explicit merge or
  Merge Queue conflict. Strictly better, but the real fix is architectural
  (split the god-file); tooling can only warn.
- GitHub features (branch protection, Merge Queue, CODEOWNERS) must be enabled at
  the repository; they are not on by default.
- Convergence discipline: it is tempting to grow Loom into a second control
  plane. Rule #3 and #4 forbid this. Loom must stay a signal layer plus local
  enforcer, consumed by Fabric at compile time in Stage 2 only.

## 11. One-line summary

Retire the shared working tree. Isolate every task window as a branch plus
worktree, govern locally with Loom, integrate and supervise on GitHub via PRs,
Merge Queue, and CODEOWNERS, and feed Loom's governance metadata into Fabric's
single compile-time PolicyDecision as **Stage 2 signals only**. Fabric is the one
decider; Loom and GitHub are the two enforcers. Loom is the Governance subsystem
of Fabric (its Workspace API surface), not a separate product; the architecture
converges on Fabric's contract and four-layer boundary.
