# Day 0 Handoff — repository-wide-branch-convergence

**To:** Human maintainer  
**From:** cursor-convergence-day0  
**Date:** 2026-07-20  
**Status:** **BASE LOCKED** (2026-07-20 proxy maintainer) — SHA `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`  
**Binding:** `docs/design/convergence-base-decision-2026-07-20.md`

---

## 1. Evidence index + how to reproduce

Root: `docs/design/convergence-evidence/2026-07-20/`

| Artifact                                           | Reproduce                                             |
| -------------------------------------------------- | ----------------------------------------------------- |
| `git-status-snapshot.txt`                          | `git status -sb`; `git rev-parse HEAD`                |
| `branch-ref-inventory.tsv`                         | `git for-each-ref refs/heads refs/remotes/origin`     |
| `tag-ref-inventory.tsv`                            | `git for-each-ref refs/tags` + prod SHA reachability  |
| `worktree-inventory.txt`                           | `git status --porcelain` + domain tags                |
| `remote-ahead-behind.tsv`                          | `git rev-list --count A..B` for main/fix/RC/prod      |
| `production-release-baseline.md`                   | Extract `deploy/production/RELEASE_RECORD.md`         |
| `dirty-file-claim.tsv`                             | porcelain × disposition matrix §7.3                   |
| `unattributed-and-conflict-files.md`               | `bun scripts/agent-attribution.ts`                    |
| `known-fail-baseline.md`                           | RELEASE_RECORD + scoped tests; full suite **not** run |
| `critical_feature_checklist.md`                    | RELEASE_RECORD + product domains                      |
| `base-parity-*.md`                                 | ancestry + checklist vs C-main / C-dev / C-prod       |
| `remote-audit/pr-inventory.tsv`                    | `gh pr list --state open\|merged\|closed` (sampled)   |
| `remote-audit/deleted-branch-recoverable-shas.tsv` | `git ls-remote origin 'refs/pull/*/head'`             |
| `remote-audit/patch-id-equivalents.tsv`            | `git cherry` + `git patch-id --stable` samples        |
| `remote-audit/security-candidates-redacted.tsv`    | keyword screen only — **no PoC**                      |
| `feature-ledger.csv`                               | v0 ≤80 active target                                  |
| `feature-manifests/*.yaml`                         | auth_tenant, session, knowledge_import, deploy        |
| Decision (signed)                                  | `docs/design/convergence-base-decision-2026-07-20.md` |

**PR sampling strategy:** open (≤50) + merged (≤80) + closed-unmerged (≤30). Not a full historical dump.

**Security queue:** 3 redacted commit hits on RC subjects (+ header). Details → private Security reviewer path only. Read `SECURITY.md` before severity calls.

---

## 2. Recommended base candidate order (parity — not CI)

| Rank | Candidate                                              | Verdict                                             |
| ---- | ------------------------------------------------------ | --------------------------------------------------- |
| 1    | **Prod SHA `85eee3e7b987…` as convergence start**      | Best anchor: live cutover; then land ledger forward |
| 2    | Future **clean pushed tip that is descendant of prod** | OK once origin/fix catches prod                     |
| ❌   | `origin/fix-scoped-package-templates` current tip      | **Behind prod** — would regress                     |
| ❌   | Local dirty HEAD                                       | Forbidden (50 dirty; multi-agent)                   |
| ❌   | `origin/main`                                          | Far behind prod lineage                             |

---

## 3. Maintainer sign-off checklist

- [x] Role roster filled (proxy: `grok-evolution-closure` for maintainer/release/hotfile/security process)
- [x] Base decision **final** — `convergence-base-decision-2026-07-20.md` @ `85eee3e7b987…`
- [x] `readyz` wecom dated waiver — `readyz-waivers/wecom.md` (expires 2026-08-20)
- [x] Dirty-file freeze-evidence policy accepted in signed decision
- [x] Security reviewer process owner assigned (proxy) for redacted queue

---

## 4. After proxy sign-off — remaining bans

- **No** shared-tree merge / rebase / bulk cherry-pick / stash cleanup
- **No** automatic `park/*` for unclaimed files
- **No** production cutover of a **new** RC without second release confirm
- Landing **only** in worktree `/Users/daniel/AI项目/openbot-convergence` on branch `convergence/2026-07-20`

Worktree (authorized after lock):

```bash
git fetch origin --tags
git worktree add ../openbot-convergence 85eee3e7b987b14b3f83301e3f200b3e1d797cc6
cd ../openbot-convergence && git switch -c convergence/2026-07-20
```

---

## 5. Dirty files

| Metric                    | Count (approx)                 |
| ------------------------- | ------------------------------ |
| Dirty paths               | ~50                            |
| Default `freeze-evidence` | ~40                            |
| Claimed for Day0 commit   | evidence + loom registry paths |
| Attribution CONFLICT      | 2 (see attribution script)     |
| Unattributed              | ~26                            |

See `dirty-file-claim.tsv`. Deadline default = capture+48h → remain freeze-evidence.

---

## 6. What this agent did **not** do

- No shared-tree merge / rebase / cherry-pick / stash
- No `git worktree add` / no `park/*` branches
- No production deploy / no readyz “fix”
- No business runtime code changes for convergence landing
- No public security PoC
- No forged maintainer Sign-off on Base decision

---

## 7. Loom note

Task `repository-wide-branch-convergence` **owner restored** to `grok-evolution-closure` (Day0 briefly flipped owner during register; corrected).  
Session `cursor-convergence-day0-20260720` remains active as contributor for evidence-path commits (`Agent: cursor-convergence-day0`).
