# Data Governance v2 — P2-b Codex Handoff (CR4: index FP keeps archive)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0` (PR #320)  
**Prior tip:** `cf97567975` — Changes Required (dangling archive on index FP mismatch + TS2367)  
**P2-a:** Accepted

## Closed this round

| Finding                                                      | Fix                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 fingerprint mismatch kept index entry but deleted archive | On `skipped_fingerprint_mismatch`, **do not** unlink create-owned archive; return `{ compensated: false, partial: true, archiveDeleted: false }` + skip recovery receipt        |
| P1 TS2367 outcome narrowing                                  | `withConversationArchiveIndexLock<T>` returns callback result; `compensateArchiveIndex` returns `Promise<ArchiveIndexCompensateOutcome>` from lock (no outer mutable + compare) |

## Evidence test

`index fingerprint mismatch keeps subsequent entry and archive target`:

- subsequent index entry retained
- archive file retained
- recovery receipt written
- `compensated === false`, `partial === true`, `archiveDeleted === false`

## Verification

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/lifecycle-p2a.test.ts \
  src/gateway/data-governance/lifecycle-p2b.test.ts
# → 36 passed

pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | rg "lifecycle-conversation-adapter" || true
# → no adapter TS errors
```

## Tips

| Milestone    | Tip                                        |
| ------------ | ------------------------------------------ |
| Prior CR3    | `cf97567975`                               |
| **This CR4** | `bfb90a49dc9087086769c64971723295aaffb7e2` |

## Ask of Codex

Re-review **this tip**. If P0/P1 closed → **P2-b Accept**.  
Else **Changes Required** with file/line.
