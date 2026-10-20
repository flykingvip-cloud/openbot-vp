# PHASE-C-HANDOFF — for Phase D lander

**From:** `cursor-convergence-phase-c`  
**Date:** 2026-07-20  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`

---

## 1. HEAD / BASELINE_PATCH

| Item                                 | Value                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Locked base                          | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                                                             |
| Final HEAD after Phase C docs commit | primary pack `0bf0c53dd0`; branch tip after handoff edits (docs-only) atop locked base `85eee3e7b987…` |
| `BASELINE_PATCH`                     | **no**                                                                                                 |

---

## 2. One-line results

| Gate    | Result                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------- |
| install | **GREEN** (~13.5s; lockfile unchanged)                                                                  |
| build   | **RED** — fails in `build:plugin-sdk:dts` (9 TS errors); collab packages must be built first for tsdown |
| tsgo    | **RED baseline** — **86** errors (recorded; non-zero allowed)                                           |
| check   | **skipped** (would fail via tsgo)                                                                       |

---

## 3. Error baseline numbers

- **tsgo error count:** `86`
- **build-blocking dts errors:** `9`
- **wecom readyz:** inherited waiver (expires 2026-08-20)

---

## 4. Can Phase D start?

### `YES_WITH_GATES`

Gates:

1. **D0 构建收口 first** — clear `build:plugin-sdk:dts` (and drive tsgo ≤ 86) before claiming build-green checkpoints.
2. Hotfiles only via convergence owner wiring commits.
3. Do not expand readyz failures beyond `{wecom}` without a new waiver.
4. No shared-tree merge; land only in this worktree.
5. New-fail from Phase C (build-red / tsgo-86) are **owned** by convergence owner for D0 — not “unowned drift”.

---

## 5. Recommended first feature knife (after D0)

**D1 — 身份 / 租户 / 权限** (execution plan §10.2)

Reasons:

- Production critical path (login / tenant / seat) is the parity checklist P0.
- D2 session invariants benefit from stable identity/tenant context already on the wire.
- Knowledge matrix (D4) and thin session packs (D3) should not precede authz correctness on a build that is still red.

Sequence reminder: `D0 → D1 → D2 → D3 → D4`.

---

## 6. Explicitly not done

- No feature merge / cherry-pick / knowledge-import land
- No RC0 image / staging cutover / production deploy
- No `git push`
- No shared-tree business code edits
- No hotfile edits; no public security PoC
- No permanent wecom “fix”

---

## 7. Report index

All under `docs/design/convergence-evidence/2026-07-20/phase-c/`:

- `env-baseline.md`
- `install-log-summary.md`
- `build-baseline.md`
- `tsgo-baseline.md`
- `check-baseline.md`
- `known-fail-convergence.md`
- `hotfile-touch-policy.md`
- `PHASE-C-HANDOFF.md` (this file)
