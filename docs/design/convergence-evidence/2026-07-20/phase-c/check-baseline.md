# Phase C — check baseline

| Field   | Value                                                                                                                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command | `pnpm check`                                                                                                                                                                                                                                                                 |
| Ran?    | **No**                                                                                                                                                                                                                                                                       |
| Reason  | Brief allows skip when slow/fail-prone. `check` includes `build:collaboration:packages` + `pnpm tsgo` + lint suite; tsgo already **86** errors on locked SHA, so check would be **RED** for the same baseline reasons. Full check would also risk long runtime on this host. |

## Expected if run

Likely fails at `pnpm tsgo` step (exit ≠ 0) with the same error set as `tsgo-baseline.md`.

## Phase D note

First green `pnpm check` belongs to **D0 构建收口** checkpoint, not Phase C.
