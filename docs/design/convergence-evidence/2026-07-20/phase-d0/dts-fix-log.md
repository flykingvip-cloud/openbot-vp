# Phase D0 — dts fix log

## Reproduce (Step 1)

```text
pnpm build:collaboration:packages  # exit 0
pnpm exec tsc -p tsconfig.plugin-sdk.dts.json
# → 9 errors (matches Phase C build-baseline)
```

## Fixes (all path A)

| #   | File                                                      | Error                                           | Fix                                                                                             |
| --- | --------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `packages/cogniweave-sdk/src/adapters/local-metadata.ts`  | illegal cast `.all() as LocalMetadataRow[]`     | drop cast; feed `unknown[]` into existing `asPayloadRows`                                       |
| 2–3 | `packages/cogniweave-sdk/src/adapters/postgres-client.ts` | missing `@types/pg`; Pool possibly undefined    | load via `new Function("return import(s)")` (no static module resolve); assign after null-check |
| 4   | `packages/cogniweave-sdk/src/cli.ts`                      | `ScopeInput` vs required `Scope` for recover    | narrow workspace/project/agent before call                                                      |
| 5   | `src/gateway/billing/seats-store.ts`                      | `endTime: string \| null` → `updatedAt: string` | `closed.endTime ?? now`                                                                         |
| 6–9 | `src/memory/recall-deny-search-wrapper.ts`                | optional inner methods → `Promise \| undefined` | `async` wrappers returning concrete Promises / safe defaults                                    |

**Rejected approaches:** `@types/pg` lock churn; `src/types/pg-shim.d.ts` (landing-stream UNMATCHED); `@ts-ignore`.

## Post-fix

`pnpm exec tsc -p tsconfig.plugin-sdk.dts.json` → **exit 0**.
