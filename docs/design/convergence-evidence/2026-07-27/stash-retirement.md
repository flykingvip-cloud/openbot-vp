# Stash retirement — 2026-07-27

22 stash entries were archived as annotated tags pointing at the stash commits themselves, then the stash list was cleared. A stash IS a commit, so the tag makes its worktree tree permanently reachable.

Verified before clearing: every stash commit had an `archive/stash-*` tag pointing at it (0 unarchived).

Durability: indices 00-17 are pushed to origin. Indices 18-21 (2026-04 to 2026-06 whole-tree snapshots, ~5000-6700 files each, on the dead `codex/openbot/localization-workspace` lineage) exceeded the push payload limit and remain local-only tags — same durability as the stash entry they replace, so no regression.

| stash      | saved at                  | message                                                                                                                                  | archive tag                 | commit         |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------- |
| stash@{0}  | 2026-07-25 08:25:18 +0800 | On deploy/user-modeling-v92: unrelated-chat-wip                                                                                          | `archive/stash-00-20260725` | `2f04c2c31c8d` |
| stash@{1}  | 2026-07-25 08:12:19 +0800 | On deploy/user-modeling-v92: import-ia-all                                                                                               | `archive/stash-01-20260725` | `720e7e3d1b44` |
| stash@{2}  | 2026-07-25 08:12:07 +0800 | On deploy/user-modeling-v92: import-ia-wip-checkout                                                                                      | `archive/stash-02-20260725` | `cec2340eefb4` |
| stash@{3}  | 2026-07-25 08:08:31 +0800 | On deploy/user-modeling-v92: release-record-wip                                                                                          | `archive/stash-03-20260725` | `fecbe5418b9f` |
| stash@{4}  | 2026-07-24 22:43:08 +0800 | On deploy/user-modeling-v92: wip-before-v92                                                                                              | `archive/stash-04-20260724` | `e1f180255896` |
| stash@{5}  | 2026-07-24 22:33:41 +0800 | On consolidation/main-wip-rescue-20260724: pre-merge-wip                                                                                 | `archive/stash-05-20260724` | `315194f549a0` |
| stash@{6}  | 2026-07-24 22:33:31 +0800 | On consolidation/main-wip-rescue-20260724: loom registry wip                                                                             | `archive/stash-06-20260724` | `bf8fc7805636` |
| stash@{7}  | 2026-07-24 22:29:04 +0800 | On main: wip-before-archive-cherry-pick                                                                                                  | `archive/stash-07-20260724` | `4409fc111345` |
| stash@{8}  | 2026-07-23 22:36:19 +0800 | On fix-scoped-package-templates: stash before checking restore-control-ui-v82 branch                                                     | `archive/stash-08-20260723` | `95f56be9f93f` |
| stash@{9}  | 2026-07-22 15:30:45 +0800 | WIP on fix-scoped-package-templates: bee5e0a580 UI: vault-sync team i18n (en + zh-CN)                                                    | `archive/stash-09-20260722` | `4ba3d12e6f96` |
| stash@{10} | 2026-07-21 09:31:58 +0800 | WIP on fix/enterprise-channel-credentials-configure: 6f225deaa8 fix(ui): make enterprise channel credentials configurable under settings | `archive/stash-10-20260721` | `0d3accd7b7a4` |
| stash@{11} | 2026-07-19 16:32:06 +0800 | On release/candidate-20260712: wip-qiaomu-cut-and-cutover-on-rc                                                                          | `archive/stash-11-20260719` | `4821bcd7bfa6` |
| stash@{12} | 2026-07-18 14:26:49 +0800 | On release/candidate-20260712: wip-unrelated-before-billing-b1b3-202607181426                                                            | `archive/stash-12-20260718` | `1bb07395a060` |
| stash@{13} | 2026-07-13 13:26:13 +0800 | On fix-scoped-package-templates: enterprise-readonly-wip                                                                                 | `archive/stash-13-20260713` | `00594f13c61d` |
| stash@{14} | 2026-07-13 12:59:57 +0800 | On fix-scoped-package-templates: before-pr34-rebase                                                                                      | `archive/stash-14-20260713` | `1de882a7b539` |
| stash@{15} | 2026-07-13 12:31:43 +0800 | On pr/workbench-enterprise-ui: temp-all-before-pr44                                                                                      | `archive/stash-15-20260713` | `f7748feb886a` |
| stash@{16} | 2026-07-13 12:31:34 +0800 | On fix-scoped-package-templates: temp-before-pr44-rebase                                                                                 | `archive/stash-16-20260713` | `2c376d364d42` |
| stash@{17} | 2026-06-01 21:11:46 +0800 | On (no branch): codex-temp-push-residual-2026-06-01                                                                                      | `archive/stash-17-20260601` | `70b496e95572` |
| stash@{18} | 2026-06-01 21:10:55 +0800 | On codex/openbot/localization-workspace: codex-temp-push-2026-06-01                                                                      | `archive/stash-18-20260601` | `82affe5265ea` |
| stash@{19} | 2026-05-28 10:26:03 +0800 | WIP on codex/openbot/localization-workspace: 963bf8969f feat(skills): add jimeng-video-gen skill for AI video generation                 | `archive/stash-19-20260528` | `87fb30d7b3d9` |
| stash@{20} | 2026-05-24 12:36:56 +0800 | WIP on codex/openbot/localization-workspace: 963bf8969f feat(skills): add jimeng-video-gen skill for AI video generation                 | `archive/stash-20-20260524` | `eb0a893a4e22` |
| stash@{21} | 2026-04-04 16:54:35 +0800 | WIP on codex/openbot/localization-workspace: b34af6fc99 chore: initialize local openclaw workspace                                       | `archive/stash-21-20260404` | `24dbe1f0eae3` |
