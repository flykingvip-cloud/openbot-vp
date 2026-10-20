# Production release baseline (read-only extract)

Captured: 2026-07-20T09:44:38Z  
Source: `deploy/production/RELEASE_RECORD.md` (do not treat readyz failures as permanent waivers).

## Latest cutover (2026-07-20) — v69

| Field                      | Value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| Branch                     | `fix-scoped-package-templates`                                          |
| Source revision (prod SHA) | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                              |
| Image tag                  | `openbot:rc-amd64-v69`                                                  |
| Image id                   | `eeeaa0ab97278db03d0b39664fb5663ffbd1bbc02f0a2ba42de17bb0ca4ad506`      |
| Container                  | `openbot-gateway-rc`                                                    |
| healthz                    | 200 (admin/biz/gw per record)                                           |
| readyz                     | **503**, `failing:["wecom"]` (reproduced on v68 before accepting v69)   |
| Rollback                   | `openbot-gateway-rc-prev-v68-safety` / `localhost/openbot:rc-amd64-v68` |

**Reachability of prod SHA in this clone:** YES

## Prior notable tips

| Date       | SHA          | Image        | readyz  |
| ---------- | ------------ | ------------ | ------- |
| 2026-07-18 | `4fac12ee50` | rc-amd64-v55 | 200/200 |
| 2026-07-13 | `5dad0b9d4b` | rc-amd64-v6  | 200/200 |

## Notes for convergence

- Prod tip is **not** a merge base candidate; use as **parity/rollback anchor** only (§4).
- `wecom` readyz 503 is a **known failing probe**, not an automatic permanent exemption — needs dated waiver if carried into RC0 (§11.0).
- Shared dirty tip of `fix-scoped-package-templates` **must not** be locked as Canonical Base.
