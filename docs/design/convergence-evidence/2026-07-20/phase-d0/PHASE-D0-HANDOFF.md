# PHASE-D0-HANDOFF — for Phase D1

**From:** `cursor-convergence-phase-d0`  
**Date:** 2026-07-20  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`

---

## 1. Final HEAD

- Locked base: `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`
- D0 fix tip (pre-docs): `62cce75600`
- Docs pack: this `phase-d0/` commit atop tip

## 2. Path

**Path A** — root `pnpm build` **exit 0** (full script including `build:plugin-sdk:dts`).

## 3. Build

| Command      | Exit  |
| ------------ | ----- |
| `pnpm build` | **0** |

## 4. tsgo

| Before | After  |
| ------ | ------ |
| 86     | **77** |

## 5. Phase D1 start?

### `YES_WITH_GATES`

Gates:

1. Land only in this worktree; no shared-tree merge.
2. Hotfile wiring only via convergence owner (do not adopt unrelated dirty `app.ts` / `method-scopes.ts` WIP already present).
3. Keep `pnpm tsgo` error count **≤ 77** (or document).
4. wecom readyz waiver unchanged (expires 2026-08-20).
5. First knife: **D1 身份/租户/权限** (execution plan §10.2).

## 6. Not done

- No D1/D2/D3/D4 feature landing
- No RC0 / staging / production cutover
- No `git push`
- No bulk cherry-pick from dirty shared tip
- Did not clear UI shell-slices (23) or enterprise-data-m1 (9) tsgo noise

## 7. Commits (D0 fixes)

| SHA          | Subject                               |
| ------------ | ------------------------------------- |
| `9c3d4ed0c3` | cogniweave local-metadata + CLI scope |
| `c435504bdc` | recall-deny Promise returns           |
| `37b8b6023a` | pg dynamic Function load              |
| `a4d4a1c481` | seats updatedAt coalesce              |
| `62cce75600` | build script collab prefix            |
