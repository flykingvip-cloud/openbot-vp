# Phase D1 — tests run

## P0 (required)

```bash
pnpm exec vitest run \
  src/gateway/server-methods/enterprise-organization.tenant-scope.test.ts \
  src/gateway/enterprise-data/enterprise-data-tenant-scope.test.ts \
  src/gateway/tenant-context.test.ts \
  --pool=forks
```

| Suite                                          | Result                                            |
| ---------------------------------------------- | ------------------------------------------------- |
| `enterprise-organization.tenant-scope.test.ts` | **4 passed** (forged reject ×2 + match accept ×2) |
| `enterprise-data-tenant-scope.test.ts`         | **3 passed**                                      |
| `tenant-context.test.ts`                       | **26 passed**                                     |
| **Total**                                      | **33 passed**                                     |

## Negative coverage

1. Snapshot with `tenantId: tenant-evil` while auth scope is `tenant-acme` → reject message contains `tenantId must match authenticated enterprise scope`.
2. `requireEnterpriseScope(..., { tenantId: "tenant-evil" })` with membership resolving `tenant-acme` → `null` + same reject message.

## Out of scope (pre-existing red)

```bash
pnpm exec vitest run src/gateway/method-scopes.test.ts --pool=forks
```

Fails on **3** pre-existing unclassified listed methods (not introduced by D1; `enterprise.organization.snapshot` is now classified).
