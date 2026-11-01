# P1 Fix Run Pin — 2026-11-01

## Host / time

- Host: UPBEYONDdeMacBook-Pro.local
- Time: 2026-11-01 22:42 Asia/Shanghai (CST, UTC+8)
- Machine: USER Mac (machineId 5374ace8-b4f4-487d-b47c-a77c8edec1ca)
- Worktree: `/Users/daniel/AI VP/openbot-p1fix-f68a3c56b`
- Branch: `fix/p1-def001-002-004-20261101`
- Remote: `origin` → `flykingvip-cloud/openbot-vp` (verified)

## New baseline (tip)

- SHA: `f68a3c56b00fe060209678921bfdc28dbd4138b5`
- Subject: 运行时接入平台模型能力准入 (#190)
- Matches expected launch tip.

## Old acceptance pin (evidence only — NOT tip PASS/FAIL)

- SHA: `3f7786f4aad2d439e499c42df9f8bcbd0480e313`
- Worktree (read-only context): `/Users/daniel/AI VP/openbot-acceptance-main-3f7786f4aa`

## Tip vs old pin

- Commits ahead: **1** (`f68a3c56b` only)
- Files changed: **23** (+1735 / −279)
- Note: Old DEF evidence at 3f7786f4… is historical. All DEF-001/002/004 judgments and fixes in this run are re-reproduced on the NEW tip before any code change.

## Scope authorization

- Fix DEF-001, DEF-002, DEF-004 + tests + reviewable PR
- NOT authorized: merge, deploy, live credential tests
- Shared dirty tree `/Users/daniel/AI VP/openbot/` must not be modified
