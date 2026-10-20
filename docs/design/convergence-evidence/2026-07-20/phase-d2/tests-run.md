# Phase D2 — tests run

```bash
pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks
```

| Result | Value                                  |
| ------ | -------------------------------------- |
| Files  | 1 passed                               |
| Tests  | **29 passed** (was 26; +3 S1/S2/S3/S4) |

## New cases

1. inbound path uses tenant store when webchat user+domain present (**S1**)
2. multitenant off → same global path (**S4**)
3. promote global transcript over newer empty tenant entry (**S2+S3**)
