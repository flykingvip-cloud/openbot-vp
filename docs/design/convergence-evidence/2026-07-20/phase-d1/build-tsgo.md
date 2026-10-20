# Phase D1 — build / tsgo

| Gate                    | Before (D0) | After (D1) |
| ----------------------- | ----------- | ---------- |
| `pnpm build`            | exit **0**  | exit **0** |
| `pnpm tsgo` error count | **77**      | **77**     |

## Notes

- Mid-flight, untyped `respond` callbacks in the new tenant-scope test briefly raised tsgo to **82** (+5). Fixed with `RespondFn` / `satisfies RespondFn` → back to **77**.
- No exemption needed; ceiling held.
- Capture: `/tmp/tsgo-d1b.txt` (77 × `error TS`).
