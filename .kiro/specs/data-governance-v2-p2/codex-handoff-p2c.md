# Data Governance v2 — P2-c Codex Handoff (CR3: resume parent fsync + staging mkdir parent)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0` (PR #320)  
**Prior tip:** `d541ede03c` / impl `60b526a391` — Changes Required (resume skipped parent fsync; staging mkdir fsynced new dir not parent)  
**P2-a:** Accepted  
**P2-b:** Accepted

## Closed this round

| Finding                                       | Fix                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 resume skipped durable unlink confirmation | Staging present + canonical missing still calls `unlinkFileDurable()` (parent-dir fsync). Domain deletion succeeded only after that returns                                                            |
| P0 staging op dir mkdir fsynced itself        | `mkdirDurableSync`: mkdir -p then fsync **parents** of every newly created directory (staging root / newly created ancestor chain). Fsyncing the new dir is not treated as persisting its parent entry |

## Evidence tests

- `resume does not treat missing canonical as deleted until parent dir fsync succeeds` (parent removed after unlink → `dir_fsync_failed:canonical_unlink`, not `purged`, staging retained)
- `mkdirDurableSync fsyncs parent of new dir, not only the new dir itself`

## Verification

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/lifecycle-p2a.test.ts \
  src/gateway/data-governance/lifecycle-p2b.test.ts \
  src/gateway/data-governance/lifecycle-p2c.test.ts
# → 58 passed (17 P2-a + 19 P2-b + 22 P2-c)
```

## Tips

| Milestone    | Tip                                        |
| ------------ | ------------------------------------------ |
| Prior CR2    | `d541ede03c`                               |
| Impl         | `cfd7f08c77`                               |
| **This CR3** | `249de4bb357e2c9742c7917a2c67f4c386a45e53` |

## Ask of Codex

Re-review **this tip**. If both directory-entry durability P0s are closed → **P2-c Accept**.  
Else **Changes Required** with file/line.
