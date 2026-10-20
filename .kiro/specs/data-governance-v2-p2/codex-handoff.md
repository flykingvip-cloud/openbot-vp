# Data Governance v2 — P2 Codex Handoff (P2-a Round 5)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0` (PR #320)  
**Request:** Re-review **P2-a Round 5** for Accept (TS gate only).  
**P2-b:** remains **Accept-locked** until P2-a Accept.

## Round 4 closed

Catalog-bound skip-fail + commit heal + controlled CAS pause tests.

## Round 5 — TS gate

| Finding                                                             | Fix                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog-cache.test.ts` mock store missing `compareAndPut` (TS2741) | In-memory mock implements full `DataGovernanceCatalogStore.compareAndPut` (resource-version CAS); typed as `DataGovernanceCatalogStore` / `CatalogRecord` — **no** type assertion bypass |

## Verification

```bash
# Targeted governance paths: no catalog-cache.test TS errors
pnpm tsgo 2>&1 | rg "catalog-cache.test" || true

OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/lifecycle-p2a.test.ts \
  src/gateway/data-governance/catalog-store.test.ts \
  src/gateway/data-governance/catalog-cache.test.ts \
  src/gateway/data-governance/envelope.test.ts
# → 43 passed
```

## Tips

| Milestone                | Tip                          |
| ------------------------ | ---------------------------- |
| Round 4                  | `ef52c45e40`                 |
| **This Round 5 package** | branch tip after this commit |

## Ask of Codex

If Round 5 closes the TS2741 mock gap with green evidence → **P2-a Accept**.  
Else **Changes Required**. **Do not unlock P2-b** until Accept.
