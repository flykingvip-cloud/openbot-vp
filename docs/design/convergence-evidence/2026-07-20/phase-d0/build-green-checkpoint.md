# Phase D0 — build green checkpoint

| Field                  | Value                      |
| ---------------------- | -------------------------- |
| Path                   | **A** (script full green)  |
| Command                | `pnpm build`               |
| Exit                   | **0**                      |
| Elapsed                | ~46s                       |
| `build:plugin-sdk:dts` | **green** (after D0 fixes) |
| Path B used?           | **no**                     |

## Preconditions verified

1. Reproduced Phase C red: `tsc -p tsconfig.plugin-sdk.dts.json` → **9** errors.
2. Applied minimal fixes (see `dts-fix-log.md`).
3. Root `package.json` `build` script now prefixes `pnpm build:collaboration:packages &&` so clean checkouts do not hit collab `UNRESOLVED_IMPORT`.

## Notes

- UI vite build succeeded; chunk-size / dynamic-import warnings only.
- A2UI: “sources missing; keeping prebuilt bundle” (expected on this SHA).
