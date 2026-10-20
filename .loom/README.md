# `.loom/` — Loom workspace registry (single source of truth)

`registry.yaml` is the committed single source of truth for **ownership** (`tasks`)
and **landing** (`landingStreams`). Once this file exists, the runtime entry points
read it instead of their legacy sources:

- `scripts/agent-attribution.ts` → ownership `tasks`
- `scripts/worktree-audit.ts` → audit `landingStreams`

(Set `LOOM_FORCE_LEGACY=1` to force the legacy path; `loom check` uses this to
compare against the frozen legacy baseline.)

## The Registry is a stateful SoT — `import` is one-time migration, NOT sync

The registry was **seeded once** from the legacy sources (`LEGACY_RULES` in
`scripts/worktree-audit.ts` + the `## Agents` blocks in `.kiro/specs/*/tasks.md`)
via `loom import --write`. Since then it has accumulated live state that has **no
legacy counterpart** and cannot be reconstructed from legacy:

- task `sessions` (who is working what, on which IDE, liveness),
- `ownerHistory` takeover chains (accountability / 追责),
- directly-registered tasks (via `loom register`, never in a `## Agents` block),
- landing streams legacy `AuditRule` cannot express — notably
  `landingPolicy: parallel` streams like `HUB`, plus `WPL` / `USRM` / `CCR` /
  `KIRO-TRI` added by real feature work.

Therefore **edit rules directly in `registry.yaml`; do NOT "regenerate" it.**
`loom import --write` _fully replaces_ the registry from legacy, setting
`sessions` / `ownerHistory` to `[]` and dropping every registry-native stream, so
it would destroy all of the above. It is **guarded**: it refuses to write when
live state would be lost and reports exactly what, requiring `--force` (a full,
informed-consent overwrite). `import` is a one-time migration tool, not a sync
tool. `LEGACY_RULES` remains only as a dead fallback (used when no registry
exists, e.g. bare test fixtures) until task 6.3 removes it.

> Historical note: this section previously told owners to run
> `loom import --write` after any rule change. That is obsolete and contradicts
> the guard — the registry is now authoritative and stateful. Corrected 2026-07-28.

`loom check` builds its "registry side" via `importFromLegacy()` (from
`LEGACY_RULES`), so **`loom check` Parity OK does NOT prove the committed registry
matches legacy** — it only checks that the legacy table imports consistently.
Registry drift from legacy is expected and intended (the registry is where hand
edits live). CI runs `pnpm loom:check:strict` (warn-only) against the frozen
legacy baseline. See `.kiro/specs/loom-workspace-orchestrator/` (tasks 6.3, 8.2).

## Editing

- Add/update ownership: `pnpm loom register --task <id> --owner <o> --paths a,b`
- Propose paths (read-only, with confidence): `pnpm loom suggest --task <id>`
- Accept proposed paths: `pnpm loom accept --task <id> --paths a,b`
- Validate: `pnpm loom lint --strict`
- View: `pnpm loom status`

Do not hand-edit ambiguously; `loom lint` checks duplicate ids, empty owners,
dangling `canLandWith`, and cross-task path overlaps.

## Commit-boundary sign-in (M1 routine)

Uncommitted edits have no git author, so the only deterministic attribution
boundary is the **commit**. Sign in for exactly the files you are about to commit,
right before committing — this keeps attribution complete without claiming paths
you did not touch:

```sh
# 1. stage your files (or let the committer do it)
# 2. see which staged files are not yet owned by any task
pnpm loom unattributed --staged
# 3. sign in for your staged files under your task (never steals another
#    task's owned paths; skips files already owned elsewhere)
pnpm loom claim --staged --owner <agent-id> --task <task-id>
# 4. commit your scoped files
scripts/committer "<msg>" <file...>
```

`loom claim` writes to the registry and refreshes the session heartbeat, so a
routine claim at every commit keeps `lastSignalAt` (and dead-session detection)
accurate. Set `LOOM_AGENT=<agent-id>` to omit `--owner`.

## Maintainer-gated promotions (tracked, not yet enabled)

These two M1 hardening steps are deliberately **not** auto-enabled; they change
shared enforcement surfaces and require a maintainer decision after a clean
observation window:

- **CI parity → required.** `.github/workflows/ci.yml` runs `loom check --strict`
  with `continue-on-error: true` (warn-only). Promote to a required check (drop
  `continue-on-error`) after a 1–2 week window with zero false positives. See
  spec task 8.2 phase two.
- **pre-commit sign-in gate.** A non-blocking `loom unattributed --staged` warn
  step could be added to `git-hooks/pre-commit`, but that file's calling contract
  is frozen for the MVP (design §3.4). Any change there is a separate,
  explicitly-approved guardrail edit.
