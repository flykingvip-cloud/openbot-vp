# Base parity — C-main (`origin/main`)

Captured: 2026-07-20T09:46:11Z  
Candidate tip: `af1d67c9da3497887d8cb8333ec4f858e4ebe2c5` (`origin/main`)  
Prod anchor: `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` (not a merge base)

## Summary

`origin/main` is **behind** the production fix-scoped lineage on most product work (`ahead=4 behind=652` vs prod SHA). **Not suitable as Canonical Base for RC0 product completeness** unless product explicitly accepts a mainline reset (unlikely).

## Parity table vs production critical checklist

| Area                                            | Prod need             | On C-main?                                          | Evidence / method                                                                                                                                               | P0 gap?                          |
| ----------------------------------------------- | --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Critical features (login/tenant/chat/knowledge) | Required              | **Likely incomplete** vs prod tip                   | `git rev-list --count af1d67c9da3497887d8cb8333ec4f858e4ebe2c5..85eee3e7b987b14b3f83301e3f200b3e1d797cc6` = large; main not ancestor of prod cutover branch tip | **Yes**                          |
| Data format / store versions                    | Compatible            | Unknown without migrate dry-run                     | No Day0 migrate run                                                                                                                                             | Unknown → treat as risk          |
| RPC / method surface                            | Prod RPCs             | Likely missing newer knowledge/local-folder methods | local-folder handlers landed on fix-scoped after prod; main even further                                                                                        | **Yes**                          |
| Client protocol (UI/mobile)                     | Handshake + fields    | Unverified                                          | §10.6 not run                                                                                                                                                   | Risk                             |
| Deploy (image/nginx/healthz)                    | healthz+readyz policy | N/A as base for current prod image                  | Prod image built from fix-scoped                                                                                                                                | **Yes** if choosing main as base |

## P0 gaps

1. Missing large volume of fix-scoped / RC product commits relative to prod.
2. Cannot claim production feature parity.
3. CI status on main (if green) **does not** override above.

## Recommendation

**Eliminate as Canonical Base** for this convergence wave. May remain historical source for cherry-picks only after ledger mapping.
