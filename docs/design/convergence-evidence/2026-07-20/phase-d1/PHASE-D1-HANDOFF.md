# PHASE-D1-HANDOFF — for Phase D2

**From:** `cursor-convergence-phase-d1`  
**Date:** 2026-07-20  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`

---

## 1. Final HEAD

- Locked base: `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`
- D0 docs tip (pre-D1): `cdc439e051`
- D1 feature tip (scopes): `f75cb321f4`
- D1 docs pack tip: branch `HEAD` after docs commits (verify: `git rev-parse HEAD`)

### D1 commits

| SHA           | Subject                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `96dd2ec5be`  | fix(gateway): reject forged tenantId on organization.snapshot          |
| `6fdd566151`  | fix(gateway): reject forged tenantId in requireEnterpriseScope         |
| `f75cb321f4`  | chore(scopes): register enterprise.organization.snapshot read scope    |
| `5eeb86c322`  | docs(convergence): Phase D1 auth/tenant thin-pack evidence and handoff |
| `72e5d0a9af`+ | follow-up docs commits for SHA table / tip wording                     |

## 2. Landed

| Item                                                                     | Status  |
| ------------------------------------------------------------------------ | ------- |
| `enterprise.organization.snapshot` → `requireResolvedEnterpriseTenantId` | done    |
| `requireEnterpriseScope` forged-tenant gate                              | done    |
| `method-scopes` register snapshot                                        | done    |
| Negative + regression vitest (33)                                        | green   |
| `auth_tenant.yaml` real refs                                             | updated |

## 3. Not landed

- D2 session store same-root / `chat.history` promote / empty-tenant heal
- D3/D4 product packs
- Closing 3 pre-existing unclassified listed RPCs (non-auth)
- UI shell-slices / enterprise-data-m1 tsgo cleanup
- Shared-tree monthly-usage WIP (discarded)

## 4. Tests

See `tests-run.md` — 33/33 P0 green; forged-tenant negatives included.

## 5. tsgo

| Before | After  |
| ------ | ------ |
| 77     | **77** |

## 6. Build

`pnpm build` exit **0**.

## 7. Phase D2 start?

### `YES_WITH_GATES`

Gates:

1. Land only in this worktree; no shared-tree merge.
2. Keep `pnpm build` green; `pnpm tsgo` ≤ **77**.
3. Hotfile wiring minimal + separate `chore(scopes|methods)` commits.
4. Discard unrelated WIP on worktree (monthly-usage / `app.ts` keep appearing — do not adopt).
5. First knife: **session 读写同根 / promote heal**（执行计划 §10.3 / 4B′）.

## 8. Suggested D2 first cut

- Session store read/write same root
- `chat.history` promote path
- Empty tenant entry must not block heal
