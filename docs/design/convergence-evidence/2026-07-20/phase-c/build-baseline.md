# Phase C — build baseline

| Field                                          | Value                                      |
| ---------------------------------------------- | ------------------------------------------ |
| Locked SHA                                     | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` |
| `BASELINE_PATCH`                               | **no** (no source/hotfile edits)           |
| Primary command                                | `pnpm build`                               |
| Also tried                                     | `pnpm build:docker` (same failure class)   |
| Result                                         | **RED** (exit 1)                           |
| Elapsed (`pnpm build` retry after collab pkgs) | ~19–22s to failure                         |

## Failure class

**Source-on-locked-SHA:** not environment/install. After `pnpm build:collaboration:packages`, `tsdown-build.mjs` proceeds; build dies in **`pnpm build:plugin-sdk:dts`** (`tsc -p tsconfig.plugin-sdk.dts.json`) with **9** TypeScript errors.

### First attempt (before collab packages)

`pnpm build` alone failed earlier with 5× `UNRESOLVED_IMPORT` for:

- `packages/collaboration-runtime/dist/index.js`
- `packages/collaboration-openbot-adapter/dist/index.js`
- `packages/collaboration-core/dist/index.js`

**Mitigation (no code patch):** run `pnpm build:collaboration:packages` first (already part of `build:docker` / `check` / `build:plugin-sdk:dts`). Documented as **order dependency**, not BASELINE_PATCH.

### plugin-sdk:dts errors (blocking)

| File                                                      | Summary                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/cogniweave-sdk/src/adapters/local-metadata.ts`  | cast to `LocalMetadataRow[]`                                    |
| `packages/cogniweave-sdk/src/adapters/postgres-client.ts` | missing `@types/pg`; Pool ctor possibly undefined               |
| `packages/cogniweave-sdk/src/cli.ts`                      | `scope.workspaceId` optional vs required                        |
| `src/gateway/billing/seats-store.ts`                      | `string \| null` vs `string \| undefined`                       |
| `src/memory/recall-deny-search-wrapper.ts`                | wrapper methods return `Promise \| undefined` vs `Promise` (×4) |

## Interpretation

- Production image for v69 was cut from this SHA — local full `pnpm build` / `build:docker` **as scripted today** does not complete DTS on a clean checkout.
- Phase C records this as **reproducible known build-red**, not an agent regression.
- Phase D **D0 构建收口** must clear these before feature landing waves claim “build green”.

## Hotfiles

No `package.json` / lockfile / method-scopes / i18n / `app.ts` changes.
