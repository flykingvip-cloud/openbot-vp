# Phase D4 — build / tsgo

| Gate         | Before (D3) | After (D4) |
| ------------ | ----------- | ---------- |
| `pnpm build` | 0           | **0**      |
| `pnpm tsgo`  | 77          | **77**     |

Capture: `/tmp/tsgo-d4b.txt`. Mid-flight was 80 (+3 from missing `explicit-metadata-store` + binding trim narrowing); fixed with stub store + narrow guard → back to 77.
