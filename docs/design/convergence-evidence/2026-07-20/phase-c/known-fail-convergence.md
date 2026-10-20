# Phase C — known-fail (convergence worktree)

Inherited from Day0: shared-tree `docs/design/convergence-evidence/2026-07-20/known-fail-baseline.md`  
Waiver: shared-tree `readyz-waivers/wecom.md` (expires **2026-08-20**; **not** permanent).

## Inherited (production / Day0)

| Item                                       | Status                                             | Owner / disposition                        |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------ |
| `readyz` → `failing:["wecom"]` on v69      | known-fail + dated waiver                          | release / ops — renew or fix before expiry |
| Full `pnpm test`                           | not run (Day0 + Phase C)                           | —                                          |
| Knowledge golden-path on dirty shared tree | Day0 evidence only; **not** present on locked base | land via ledger later                      |

## New on this worktree (Phase C)

| Item                                                                      | Status                            | Owner required before Phase D feature land?                     |
| ------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `pnpm build` / `build:docker` RED at `build:plugin-sdk:dts` (9 TS errors) | **new-fail (build)**              | **Yes** — convergence owner / D0                                |
| `pnpm tsgo` **86** errors                                                 | **new-fail (typecheck baseline)** | **Yes** — must not rise; D0 should reduce build-blocking subset |
| `pnpm check`                                                              | not run (predicted red)           | treat as blocked until D0                                       |
| Extension `.bin` symlink dirty after install                              | discard / ignore                  | no land                                                         |

## Policy reminder

**New-fail without an owner must not enter Phase D feature landing.**  
Wecom waiver is staging/carry-forward only — do not expand failing set; do not treat as permanent auto-exempt.
