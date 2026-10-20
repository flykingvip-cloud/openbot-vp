# Base parity — C-dev (`fix-scoped-package-templates`)

Captured: 2026-07-20T09:46:53Z

| Ref                                   | SHA                                        | Role                                   |
| ------------------------------------- | ------------------------------------------ | -------------------------------------- |
| `origin/fix-scoped-package-templates` | `5fd25a16f92bb673757c94e356f6fa1eb1bf14c7` | Pushed tip                             |
| Local `HEAD` (shared dirty tree)      | `a1c01567f5ecff5b578eeabb688d95f4d314dfe5` | **Not eligible as base**               |
| Prod anchor                           | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` | Parity / rollback / optional start SHA |

## Ancestry facts (this clone)

| Question                           | Result                                |
| ---------------------------------- | ------------------------------------- |
| Is origin/fix an ancestor of prod? | **YES**                               |
| Is prod an ancestor of origin/fix? | **NO** (origin tip **behind** prod)   |
| Is prod an ancestor of local HEAD? | **YES**                               |
| Local HEAD vs origin/fix           | ~342 commits ahead (unpushed + local) |

## Parity table

| Area                               | Prod need        | origin/fix tip               | local HEAD         | P0 gap?                     |
| ---------------------------------- | ---------------- | ---------------------------- | ------------------ | --------------------------- |
| Contains prod SHA features         | Required         | **Missing prod tip commits** | Contains prod      | **Yes on origin tip**       |
| Knowledge localFolder + golden E2E | Next RC desire   | Missing (post-prod local)    | Present            | origin tip + need push/land |
| RPC/method surface                 | Prod+            | Behind prod                  | Ahead of prod      | origin tip                  |
| Client protocol                    | Handshake        | Unverified                   | Unverified         | risk                        |
| Deploy/readyz                      | wecom known-fail | N/A                          | N/A                | waiver later                |
| Cleanliness                        | Clean locked SHA | Clean remote tip             | **50 dirty files** | local tip banned            |

## P0 gaps

1. Pushed origin tip **does not include production cutover SHA** — locking it as base would **regress** prod features.
2. Local HEAD includes prod + knowledge-import + Day0 docs but is a **dirty shared tip** — forbidden as Canonical Base.
3. Maintainer should lock either: **prod SHA** as start, or a **future clean pushed tip** that is a descendant of prod.

## Recommendation

**C-dev remote tip: reject as Canonical Base (would drop prod).**  
**Local dirty tip: reject.**  
**Best related option:** start convergence from **prod SHA** then land ledger items (or push a clean descendant of prod first).
