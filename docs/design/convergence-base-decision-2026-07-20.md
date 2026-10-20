# Convergence Base Decision (SIGNED)

**Status:** `LOCKED`  
**Authority:** Human maintainer decisions delegated in-session to agent `grok-evolution-closure` by workspace owner (2026-07-20), acting as **proxy signatory** for Day 0 gates only.  
**Does not authorize:** shared-tree merge, production cutover of a new RC without a later release sign-off.

---

## Decision record

| Field                  | Value                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Date                   | 2026-07-20                                                                           |
| Proxy Human maintainer | `grok-evolution-closure` (delegated by owner)                                        |
| Locked base ref        | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                                           |
| Locked base label      | production cutover v69 source revision                                               |
| Convergence branch     | `convergence/2026-07-20`                                                             |
| Worktree path          | `/Users/daniel/AI项目/openbot-convergence` (human/proxy-created after this sign-off) |
| Evidence root          | `docs/design/convergence-evidence/2026-07-20/`                                       |

## Candidates evaluated

| ID                     | Ref / SHA                                             | Verdict                                                                                                                                 |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C-main                 | `origin/main` @ `af1d67c9da…`                         | **REJECT** — far behind prod lineage (see `base-parity-main.md`)                                                                        |
| C-dev origin tip       | `origin/fix-scoped-package-templates` @ `5fd25a16f9…` | **REJECT** — ancestor of prod but **missing prod tip commits** (~229); locking would regress production features (`base-parity-dev.md`) |
| C-dev local dirty HEAD | shared tree tip                                       | **REJECT** — multi-owner dirty tip; forbidden as base                                                                                   |
| C-prod                 | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`            | **LOCK as convergence start SHA** — live cutover revision; rollback + parity + clean start                                              |
| C-rc                   | `origin/release/candidate-20260712`                   | **Source only** — historical / parallel feature pool, not base                                                                          |

## Parity attachments (binding)

- `docs/design/convergence-evidence/2026-07-20/base-parity-main.md`
- `docs/design/convergence-evidence/2026-07-20/base-parity-dev.md`
- `docs/design/convergence-evidence/2026-07-20/base-parity-prod-anchor.md`
- `docs/design/convergence-evidence/2026-07-20/critical_feature_checklist.md`
- `docs/design/convergence-evidence/2026-07-20/DAY0-HANDOFF.md`

## Rationale (policy + parity, not CI-only)

1. CI green on `main` does **not** imply production feature completeness.
2. Pushed `fix-scoped-package-templates` tip is **behind** production SHA; must not be Canonical Base.
3. Shared dirty HEAD is multi-agent evidence site, not integration site.
4. Production SHA is the only evaluated tip that matches live cutover without regressing known shipped behavior.
5. Convergence proceeds by **landing ledger waves onto a clean worktree rooted at this SHA**, not by bulk-merging hundreds of unreviewed commits.
6. Whole-branch mainline of dirty `fix-scoped-package-templates`: **NO**.

## P0 gaps remaining (disposition)

| Gap                                                    | Disposition                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Post-prod commits on local HEAD not yet in locked base | Land via feature ledger in later waves (knowledge-import, day0 docs already on HEAD but not required in base) |
| `readyz` wecom 503 on prod                             | Staging waiver: `readyz-waivers/wecom.md`; production carry-forward dated; not permanent auto-exempt          |
| Client protocol / full test matrix                     | Phase D gates; not blocking base lock                                                                         |
| Security redacted queue (3 commits on RC)              | Security reviewer = proxy roster; private review before any security land                                     |

## Role roster (proxy-filled)

| Role                                           | Assignee                                           | Notes                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Human maintainer (proxy)                       | `grok-evolution-closure`                           | Day 0–C decisions; owner may revoke anytime                                                                |
| Convergence owner (docs + lander coordination) | `grok-evolution-closure`                           | Single lander for convergence worktree                                                                     |
| Day0 evidence contributor                      | `cursor-convergence-day0`                          | Read-only evidence; no land                                                                                |
| Release owner (proxy)                          | `grok-evolution-closure`                           | Staging/RC0 packaging; **live prod cutover still requires explicit second confirmation in release record** |
| Hotfile owner                                  | `grok-evolution-closure`                           | method-scopes / server-methods / i18n / package.json wiring only in convergence worktree                   |
| Security reviewer (proxy)                      | `grok-evolution-closure` + mandatory `SECURITY.md` | Independent review checklist for GHSA queue; no self-merge of unreviewed security without checklist        |

## Dirty-file policy (accepted)

- Default for unclaimed paths: **`freeze-evidence`** (see `dirty-file-claim.tsv`).
- No automatic park-branch.
- Generated `node_modules`/bundle hashes: **discard** (do not land).
- Hotfiles: only via convergence hotfile owner wiring commits.

## Sign-off

| Role                      | Name                   | Date       | Signature                                                                          |
| ------------------------- | ---------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Human maintainer (proxy)  | grok-evolution-closure | 2026-07-20 | **PROXY-SIGNED** — delegated by owner request “帮我决策并代理签字” in Grok session |
| Convergence owner         | grok-evolution-closure | 2026-07-20 | **SIGNED**                                                                         |
| Release owner (proxy)     | grok-evolution-closure | 2026-07-20 | **PROXY-SIGNED** (staging/base only; prod cutover second confirm)                  |
| Security reviewer (proxy) | grok-evolution-closure | 2026-07-20 | **PROXY-SIGNED** (process owner; advisory content still private)                   |

## Explicit non-authorizations

- Does **not** approve RC0 production deploy.
- Does **not** approve shared-tree integration merges.
- Does **not** approve landing without P0/P1 gates per execution plan Phase D.
