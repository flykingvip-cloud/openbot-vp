# Implementation Plan — Policy Engine (Package V2 Phase 2)

> 依赖：`.kiro/specs/resource-catalog/` Phase 1。

## Agents

- cursor-agent · role: owner · scope: Policy Engine + tier routingMode · paths: `src/gateway/policy-engine/**`, `src/gateway/model-entitlement/tier-routing.ts`, `src/gateway/model-entitlement/employee-model-gate.ts`, `src/gateway/model-entitlement/entitlement-projection.ts` · since: 2026-06-13

## Tasks

- [x] 1. Policy store（cost / balanced / quality）+ resolve 纯函数
- [x] 2. platform-policy.\* RPC + 注册
- [x] 3. routingMode 配置（legacy | tier）+ tier-routing + projection 演进
- [x] 4. employee-model-gate 接入 Policy 解析（替代内联 aorExecution 优先）
- [x] 5. binding/bundle 扩展 policyId + allowedPolicies
- [x] 6. 定价页 Policy/Tier 编辑 UI — cursor-phase3（见 entitlement-v2 task 6）
