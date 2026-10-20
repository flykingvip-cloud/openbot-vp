# L0 freeze evidence — 2026-07-27 baseline governance

Snapshot of the shared main worktree (`deploy/user-modeling-v92` checkout) taken during the
2026-07-27 trunk restoration, so that clearing uncommitted state later costs nothing.

Elected baseline for this pass: tag `baseline/2026-07-27`.

## Why this exists

Uncommitted files carry no git author, so an unattributed dirty file cannot be traced to an
agent, paused, or held to acceptance. At snapshot time `scripts/agent-attribution.ts` reported:

- 101 dirty paths
- 23 attributed across 11 agent/task pairs
- 9 CONFLICT (shared hot file claimed by more than one owner)
- **69 UNATTRIBUTED** (no agent signed in for the path)

Retirement rule applied (I3): nothing is deleted until it is either provably contained in the
baseline or archived. This directory is the archive half for L0.

## Contents

| File                        | What it holds                                                             |
| --------------------------- | ------------------------------------------------------------------------- |
| `tracked-modified.patch`    | 64 tracked files with uncommitted modifications (`node_modules` excluded) |
| `untracked-new-files.patch` | 42 untracked files, as applyable `/dev/null` → file diffs                 |
| `untracked-list.txt`        | raw untracked entry list at snapshot time                                 |
| `attribution.txt`           | full `agent-attribution.ts` output at snapshot time                       |
| `stash-retirement.md`       | the 22 stash entries and the archive tag that now holds each              |

## Cleaned in this pass

Only provably generated or junk paths were removed. No source edit was discarded.

- 5 × `*/node_modules/.bin/openclaw` install shims — restored, never committable
- `_to_delete/` — 3 empty `index.lock.*` leftovers

Dirty path count went 101 → 95. The remaining 95 are live agent WIP and were deliberately left
in place; clearing them is now a one-step operation because this bundle exists.

## Stashes

All 22 stash entries were converted to `archive/stash-NN-YYYYMMDD` tags and the stash list was
cleared. See `stash-retirement.md`.

A first redundancy check claimed all 22 stashes were duplicates of existing commits. That check
was wrong: it built its tree map with `git log --all`, which includes `refs/stash`, so stashes
matched each other. Rebuilt against branches and tags only, **20 of 22 stash trees existed in no
branch and no tag** — dropping on the first result would have destroyed 20 unique snapshots.
Hence the tag-first approach.
