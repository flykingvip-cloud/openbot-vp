# Convergence Base Decision (DRAFT — SUPERSEDED)

> **Superseded 2026-07-20** by signed document:  
> [`convergence-base-decision-2026-07-20.md`](./convergence-base-decision-2026-07-20.md)  
> Locked SHA: `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` (proxy maintainer sign-off).

# Original DRAFT (not signed)

- Date: 2026-07-20
- Maintainer: _TBD — Sign-off blank_
- Candidates evaluated:
  - C-main: `af1d67c9da3497887d8cb8333ec4f858e4ebe2c5` (`origin/main`)
  - C-dev origin tip: `5fd25a16f92bb673757c94e356f6fa1eb1bf14c7` (`origin/fix-scoped-package-templates`)
  - C-dev local dirty HEAD: `a1c01567f5ecff5b578eeabb688d95f4d314dfe5` (**disqualified**)
  - C-prod anchor: `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` (prod v69; not long-lived base alone)
- Parity reports attached:
  - base-parity-main.md: reject — far behind prod lineage
  - base-parity-dev.md: origin tip behind prod; local tip dirty
  - base-parity-prod-anchor.md: use as start/rollback anchor
- Critical feature checklist path: `docs/design/convergence-evidence/2026-07-20/critical_feature_checklist.md`
- Locked base ref/SHA: _TBD by Human maintainer_
- P0 gaps remaining and disposition: _TBD_
- Rationale (policy + parity, not CI-only): _Draft recommendation below — not a lock_
- RC 20260712 role: historical / parallel source (`7638217f4cd3c211809443a2bbcba2327d856f32`) — not prod tip
- Production SHA role: **rollback + parity + recommended convergence start**
- Whole-branch mainline of fix-scoped-package-templates: **NO** (dirty tip / origin behind prod)
- Convergence branch name: `convergence/2026-07-20` (human-created later)
- Worktree path (human-created): _TBD_
- Sign-off: **_blank — DRAFT only_**

## Draft recommendation (agent — non-binding)

1. **Do not** lock `origin/main` or dirty local HEAD.
2. **Do not** lock `origin/fix-scoped-package-templates` while it is behind prod.
3. Prefer Human locks **`85eee3e7b987b14b3f83301e3f200b3e1d797cc6`** as convergence starting SHA, then land ledger waves in a new worktree.
4. Alternatively: first push a **clean** descendant of prod to origin, then lock that tip.

## Sign-off

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| Human maintainer |      |      |           |
