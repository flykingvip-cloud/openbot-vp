# Known-fail baseline

Captured: 2026-07-20T09:44:38Z  
Agent: cursor-convergence-day0  
Scope: Day0 evidence only — **no full `pnpm test`** (machine load / brief forbid).

## Production / edge (from RELEASE_RECORD)

| Check                  | Status                | Notes                                   |
| ---------------------- | --------------------- | --------------------------------------- |
| healthz (admin/biz/gw) | pass (per v69 record) |                                         |
| readyz                 | **fail**              | `failing:["wecom"]` on v69; same on v68 |
| Edge smoke             | pass (per record)     | biz/admin/gw/www                        |

## Local scoped tests (this workspace, prior session)

| Suite                                                 | Result     | Notes                                      |
| ----------------------------------------------------- | ---------- | ------------------------------------------ |
| localFolder + passive + baidu-oauth + space-import UI | 46/46 pass | knowledge-import merge session             |
| `local-folder-import.golden-path.test.ts`             | 1/1 pass   | team KB → bind → search → consume → reload |

## Not run (explicit)

| Suite                         | Reason                                        |
| ----------------------------- | --------------------------------------------- |
| Full `pnpm test`              | Day0 brief: do not drag machine; record unrun |
| Browser E2E governance suites | not required for Day0 freeze                  |
| Mobile protocol compile gates | Phase D/§10.6 — not Day0                      |

## New-fail tracking

No new Day0 regression hunt performed beyond inventory above.
