# Loom Provisioning Architecture (2026-06-16)

> Scope: business-logic architecture of Loom Provisioning (Phase 2 isolation
> lifecycle) for review. Spec: `.kiro/specs/loom-provisioning/`. Code:
> `scripts/loom/git.ts`, `scripts/loom/provision.ts`, `scripts/loom.ts`.
>
> Invariants under review: orchestration-only (no new engine), data-safety-first,
> registry as canonical source of truth, reconcile report-only by default, Loom
> stays a Fabric signal layer (compile-time, no runtime lookup).

## 1. Layered architecture

```mermaid
flowchart TB
  subgraph CLI["CLI surface  (scripts/loom.ts)"]
    T["loom task &lt;start|land|abandon|list|reconcile|repair&gt;"]
  end

  subgraph ORCH["Orchestration  (scripts/loom/provision.ts)  — decision pure fns + thin IO"]
    direction TB
    PLAN["plan/decision pure fns\nplanStart · canDestroy · ownsWorktree\ncomputeReconcile · isRetryable"]
    FLOW["side-effecting flows\nstart · land(prepare/finalize) · abandon\nreconcile · repair · taskList"]
    LOCK["landLock (file lock, stale reclaim)"]
  end

  subgraph REUSE["Reused capabilities (no parallel system)"]
    GIT["git.ts thin wrapper\n(argv-array, option-injection guard)"]
    REG["registry.ts\n(canonical source of truth)"]
    LIFE["lifecycle.ts\n(state machine, transitions)"]
    GATE["loom check / audit gate\n(attribution + landing)"]
  end

  subgraph SUBSTRATE["Substrate"]
    GITREPO[("git worktree / branch\n(projection)")]
    YAML[(".loom/registry.yaml")]
    GH["GitHub PR / Merge Queue\n(remote enforcement)"]
  end

  T --> FLOW
  FLOW --> PLAN
  FLOW --> LOCK
  FLOW --> GIT
  FLOW --> REG
  FLOW --> LIFE
  FLOW --> GATE
  GIT --> GITREPO
  REG --> YAML
  FLOW -. "mode=pr" .-> GH

  classDef sot fill:#fde7c7,stroke:#c97a00;
  class REG,YAML sot;
```

Key: Registry (yellow) is the canonical source of truth; `git worktree/branch`
is a projection reconciled against it. Provisioning never re-implements git,
auth, audit, or merge governance; it orchestrates existing pieces.

## 2. Task lifecycle plus provisioning actions

The lifecycle state machine (`lifecycle.ts`) is unchanged from the MVP; Provisioning
only attaches git side-effects to its transitions. ORPHANED and friends are
reconcile-derived health findings, NOT persisted states.

```mermaid
stateDiagram-v2
  [*] --> claimed
  claimed --> active: start (worktree + branch created)
  active --> ready: land prepare ok
  ready --> landed: land finalize ok (worktree GC'd)
  active --> abandoned: abandon (worktree removed)
  paused --> abandoned
  blocked --> abandoned
  ready --> abandoned
  active --> paused
  active --> blocked
  landed --> [*]
  abandoned --> [*]

  note right of active
    health findings (reconcile, not states):
    ORPHANED / MISSING_BRANCH /
    UNTRACKED_WORKTREE / STALE
  end note
```

## 3. start flow

```mermaid
flowchart TB
  A["loom task start --task --owner [--from --identity]"] --> B["planStart\nbranch=&lt;owner&gt;/&lt;task&gt;, worktreePath, base"]
  B --> C{"branch exists?\nor worktree path exists?"}
  C -- yes --> X["reject (no overwrite, R1.3)"]
  C -- no --> D{"--dry-run?"}
  D -- yes --> P["print plan, no side effects"]
  D -- no --> E["git worktree add -b branch base"]
  E --> F["optional per-worktree identity"]
  F --> G["record realpath binding:\nprovisionId, branch, worktree -> session.metadata"]
  G --> H["lifecycle: claimed -> active\nappendEvent(branch_created, worktree_created)"]
  H --> I["saveRegistry (does NOT cd/switch caller)"]
```

## 4. land two-phase flow (returns LandResult)

```mermaid
flowchart TB
  S["loom task land --task --owner [--mode merge|pr]"] --> L["acquire landLock(taskId)\n(serialize; stale reclaim)"]
  L --> F["findProvisionedSession by provisionId binding"]
  F --> P1["PREPARE (reversible)"]

  subgraph P1
    direction TB
    D1{"worktree dirty?"} -- yes --> RDIRTY["DIRTY_WORKTREE (retryable)"]
    D1 -- no --> D2{"attribution+audit gate pass?"}
    D2 -- no --> RPOL["POLICY_BLOCKED (not git-retryable)"]
    D2 -- yes --> D3["fetch (best-effort) + rebase preview"]
    D3 --> D4{"rebase conflict?"}
    D4 -- yes --> RCON["rebase --abort -> CONFLICTED (retryable)"]
    D4 -- no --> OK1["prepare ok"]
  end

  OK1 --> P2["FINALIZE (irreversible)"]

  subgraph P2
    direction TB
    M{"mode"}
    M -- merge --> MM{"ff-only merge into base?"}
    MM -- fails --> RNFF["NON_FAST_FORWARD (retryable)"]
    MM -- ok --> WLAND["registry ready->landed (AFTER integration)"]
    M -- pr --> PR["push branch + open PR (GitHub gate)"]
    PR --> WLAND
    WLAND --> GC["GC worktree + appendEvent(landed)"]
    GC --> RSUCC["SUCCESS"]
  end

  RDIRTY --> REL["release landLock (finally)"]
  RPOL --> REL
  RCON --> REL
  RNFF --> REL
  RSUCC --> REL
```

Atomicity (R9.4): the `landed` registry write happens only AFTER successful
irreversible integration, so the system never rests in a "landed but not
integrated" inconsistency. The lock is released in a `finally`.

## 5. abandon flow

```mermaid
flowchart TB
  A["loom task abandon --task --owner [--force --delete-branch]"] --> F["findProvisionedSession (ownership via binding)"]
  F --> S["status = {dirty, unpushed=ahead&gt;0}"]
  S --> C{"canDestroy(status, force)?"}
  C -- "no (dirty/unpushed, no force)" --> B["blocked: print loss; refuse"]
  C -- yes --> D{"--dry-run?"}
  D -- yes --> P["report; no side effects"]
  D -- no --> R["worktree remove (fallback rm+prune on git&lt;2.17)"]
  R --> BR{"--delete-branch?"}
  BR -- yes --> DB["safe ref delete (update-ref -d)"]
  BR -- no --> KEEP["keep branch"]
  DB --> W["registry -> abandoned + appendEvent"]
  KEEP --> W
```

## 6. reconcile decision and modes (Recovery Plane)

```mermaid
flowchart TB
  subgraph DETECT["computeReconcile (pure): registry x git worktrees"]
    direction TB
    E0{"binding worktree on disk?"} -- no --> ORP["ORPHANED"]
    E0 -- yes --> E1{"branch exists?"}
    E1 -- no --> MIS["MISSING_BRANCH"]
    E1 -- yes --> E2{"task landed/abandoned?"}
    E2 -- yes --> STA["STALE"]
    E2 -- no --> OK["OK"]
    U["git worktree (non-main, on disk) without binding"] --> UNT["UNTRACKED_WORKTREE"]
  end

  DETECT --> MODE{"--mode (default report)"}
  MODE -- report --> RO["read-only output (CI-safe)"]
  MODE -- dry --> DRY["print would-repair plan, no mutation"]
  MODE -- apply --> AP["apply (requires --yes)"]

  AP --> RA{"finding"}
  RA -- ORPHANED + branch exists --> FIX["prune + recreate worktree from branch\n(data-safe, no loss)"]
  RA -- other --> HUM["report for human action (no auto destructive op)"]
  FIX --> EV["appendEvent(repaired)"]
```

reconcile is never a silent mutation engine: default is read-only `report`,
mutation requires explicit `--mode apply` plus `--yes`, and only the loss-free
repair (recreate an orphaned worktree from its still-existing branch) is
automated.

## 7. Positioning within Fabric (signal only)

```mermaid
flowchart LR
  subgraph LOOM["Loom (Governance subsystem / signal layer)"]
    PROV["Provisioning\nworktree/branch/provisionId metadata"]
    REG["registry (canonical)"]
    PROV --> REG
  end

  subgraph BOUND["compile-time stable boundary"]
    MAP["src/fabric/mappers.ts\nLoomAttribution -> ownership + decisionTrace"]
  end

  subgraph FABRIC["Fabric Policy Runtime (single decider)"]
    S1["Stage 1 Hard Gate"]
    S2["Stage 2 Governance Signals\n(Loom feeds HERE only)"]
    S3["Stage 3 Constraint shaping"]
  end

  REG -. "compile time, no runtime lookup" .-> MAP
  MAP --> S2
  S1 --> S2 --> S3

  note1["effect = neutral:\nsignals never decide ALLOW/DENY/MODIFY"]
  S2 -.-> note1
```

## 8. Review checklist (where each invariant lives)

| Invariant                                    | Enforced by                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Orchestration only, no new engine            | provision.ts calls git/registry/lifecycle/check; no scheduler/auth/merge engine  |
| Registry = source of truth, git = projection | computeReconcile; ORPHANED keyed on disk existence                               |
| Data safety (no silent loss)                 | canDestroy + dirty/unpushed guards + --force confirmation (start/land/abandon)   |
| No cross-agent worktree ops                  | ownsWorktree via provisionId binding (not path inference)                        |
| Land atomicity                               | two-phase; registry landed only after integration; landLock serialization        |
| Standardized land outcomes                   | LandResult + isRetryable (retryable vs hard-fail)                                |
| Recovery without surprise                    | reconcile default report-only; apply needs --yes; loss-free repair only          |
| Bounded metadata                             | events[] capped at N=50                                                          |
| Fabric signal-only                           | LoomAttribution boundary, compile-time, effect=neutral, Stage 2 only             |
| Zero regression                              | feature-gated; MVP/shared-tree unchanged when `loom task` unused; parity 0 diffs |
