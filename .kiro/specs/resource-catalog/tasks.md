# Implementation Plan — Resource Catalog (Package V2 Phase 1)

> 关联：AOR 平台控制平面套餐管理 V2 — 模块二 Resource Catalog。

## Agents

- cursor-agent · role: owner · scope: Resource Catalog Phase 1（Tier/Model/CreditWeight store + RPC + 定价页资源目录 UI） · paths: `src/gateway/resource-catalog/**`, `src/gateway/server-methods/resource-catalog.ts`, `ui/src/ui/capability/resource-catalog/**`, `ui/src/ui/ports/platform/pricing/**` · since: 2026-06-13

## Tasks

- [x] 1. 类型与 store 骨架（Tier / ModelCatalog / CreditWeight）
- [x] 2. resolve 纯函数 + 测试
- [x] 3. platform-resource-catalog.\* RPC + 注册
- [x] 4. binding allowedTiers 双轨 + doctor 检查
- [x] 5. 平台定价页「资源目录」子页 + i18n
- [ ] 6. Phase 2：Policy Engine 独立化（后续 spec）
