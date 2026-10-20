# Legacy Cleanup Wave（Phase 6）— 已完成

> **Status:** `legacy-free`（2026-06-19）  
> LC-1 … LC-7 已从代码中移除。镜像**写**保留；runtime **读**仅 canonical group root。

## 固定句

> `{stateDir}/spaces/{groupId}` 是 UI / 治理镜像，不是 runtime memory 决策真相；runtime 读写以 `resolveGroupCollaborationPaths()` 输出的 group root 为准。

## 已完成项

| ID   | 符号                                      | 完成日     |
| ---- | ----------------------------------------- | ---------- |
| LC-1 | `createGroupFileStore` read fallback      | 2026-06-19 |
| LC-2 | `legacyGroupRootDir` 工厂字段             | 2026-06-19 |
| LC-3 | agent-workspace collaboration root export | 2026-06-19 |
| LC-4 | space-store legacy 枚举                   | 2026-06-19 |
| LC-5 | ledger reader 双源 merge                  | 2026-06-19 |
| LC-6 | `resolveLegacyLedgerPath`                 | 2026-06-19 |
| LC-7 | managed-space read fallback               | 2026-06-19 |

机器可读：`LEGACY_COMPAT_REMOVAL_COMPLETED` in `legacy-compat.ts`.

## 回归门禁

```bash
bun scripts/sync-collaboration-group-charter.ts --group-id <groupId>  # 新群或 charter 缺失时
bun scripts/verify-collaboration-convergence.ts \
  --group-id grp-daniel-hhd-gmail-com-upbeyond \
  --fail-on-warn --run-tests
```
