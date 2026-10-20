# Phase D2 — build / tsgo

| Gate         | Before (D1) | After (D2) |
| ------------ | ----------- | ---------- |
| `pnpm build` | exit 0      | exit **0** |
| `pnpm tsgo`  | 77          | **77**     |

Capture: `/tmp/tsgo-d2.txt`. No new errors in `tenant-context.ts` / `reply/session.ts`.
