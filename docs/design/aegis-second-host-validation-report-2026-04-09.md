# Aegis 第二宿主验证报告

## 1. 结论

第二宿主验证当前可以判定为：

1. `@openbot/collaboration-core` 已被 Aegis 作为真实外部包成功消费。
2. `@openbot/collaboration-runtime` 已被 Aegis 作为真实外部包成功消费。
3. Aegis 已通过显式映射层把自身模型投影到协作 SDK。
4. 当前验证结论支持“继续保留 SDK 在 OpenBot 主仓 `packages/` 下演进”。
5. 当前验证结论不支持“立即拆仓”或“立即切入 Aegis 主链路”。

## 2. 本次实际完成内容

已在 Aegis 中新增：

1. `server/collaboration-host/external-sdk.ts`
2. `server/collaboration-host/mappers/task-session-to-collaboration.ts`
3. `server/collaboration-host/mappers/deliverable-to-collaboration.ts`
4. `server/collaboration-host/mappers/decision-to-collaboration.ts`
5. `server/collaboration-host/mappers/runtime-context-to-collaboration.ts`
6. `server/collaboration-host/checks/collaboration-host-smoke.ts`
7. `server/collaboration-host/aegis-adapter.ts`
8. `server/collaboration-host/index.ts`
9. `server/collaboration-host/README.md`
10. `server/collaboration-aegis-adapter/index.ts`
11. `server/collaboration-aegis-adapter/README.md`
12. `server/collaboration-host/mappers/expert-review-to-collaboration.ts`
13. `server/collaboration-host/mappers/session-memory-to-collaboration.ts`

已在 Aegis 中新增测试：

1. `server/collaboration-host/__tests__/collaboration-host-smoke.test.ts`
2. `server/collaboration-host/__tests__/collaboration-host-runtime.test.ts`
3. `server/collaboration-host/__tests__/collaboration-host-core-compat.test.ts`
4. `server/collaboration-host/__tests__/collaboration-host-adapter.test.ts`
5. `server/collaboration-aegis-adapter/__tests__/boundary.test.ts`
6. `server/collaboration-host/__tests__/collaboration-host-review-flow.test.ts`
7. `server/collaboration-host/__tests__/collaboration-host-decision-flow.test.ts`
8. `server/collaboration-host/__tests__/collaboration-host-memory-flow.test.ts`

已在 Aegis `package.json` 中新增：

1. `test:collaboration-host`

## 3. 已验证能力

### 3.1 纯领域能力

已验证：

1. `TaskStateMachine`
2. `validateGroupTemplate`
3. `FinalDecisionPolicy` 相关判定
4. `ReviewStateMachine`
5. `DecisionStateMachine`

说明：

1. Aegis 已能直接消费 `collaboration-core` 的状态机与策略能力。
2. 当前不再依赖相邻源码路径，而是依赖真实本地包。

### 3.2 运行时规则能力

已验证：

1. `resolveMessageRoute`
2. `createRuntimeProjection`
3. `canPublishFinalDecision`
4. `canPublishDeliverable`
5. `buildMemorySummary`
6. `injectTaskMemory`

说明：

1. Aegis 已能通过映射后的对象快照调用 `collaboration-runtime`。
2. 当前已验证 route、projection、final gate、review gate 的最小可用性。

### 3.3 映射与适配边界

已验证：

1. `TaskSessionV2 -> Task`
2. `DeliverableV1 -> Deliverable`
3. `DecisionContract -> Decision`
4. `expertReview -> Review`
5. `TaskSessionV2 / governance / artifact / dialogue -> GroupMemory[]`
6. `Workbench/runtime context -> RuntimeContext`
7. `AegisCollaborationAdapter` 统一边界可输出稳定对象
8. `collaboration-aegis-adapter` 已形成正式宿主侧导出边界

## 4. 当前测试结果

已执行：

```bash
pnpm --dir '/Users/daniel/AI项目/Aegis' run test:collaboration-host
pnpm --dir '/Users/daniel/AI项目/Aegis' run build
```

结果：

1. `8` 个测试文件通过
2. `22` 个测试通过
3. Aegis 全仓 `build` 通过

本次覆盖的测试文件：

1. `server/collaboration-host/__tests__/collaboration-host-smoke.test.ts`
2. `server/collaboration-host/__tests__/collaboration-host-runtime.test.ts`
3. `server/collaboration-host/__tests__/collaboration-host-core-compat.test.ts`
4. `server/collaboration-host/__tests__/collaboration-host-adapter.test.ts`
5. `server/collaboration-aegis-adapter/__tests__/boundary.test.ts`
6. `server/collaboration-host/__tests__/collaboration-host-review-flow.test.ts`
7. `server/collaboration-host/__tests__/collaboration-host-decision-flow.test.ts`
8. `server/collaboration-host/__tests__/collaboration-host-memory-flow.test.ts`

## 5. 边界判断

当前已经证明：

1. SDK 现阶段不需要迁出 OpenBot 主仓。
2. `packages/` 作为当前主研发位置是合理的。
3. 第二宿主接入方式应是“映射层 + adapter 边界”，而不是直接替换 Aegis 现有模型。
4. Aegis 已可通过正式包依赖与正式宿主 adapter 边界消费 SDK。
5. Aegis 已完成 review、decision、memory 三类关键对象链路的宿主侧深链路验证。

当前还没有证明：

1. Aegis 主链路可以直接切换到 collaboration SDK
2. SDK 已适合独立拆仓
3. SDK 已适合直接对外发布
4. `@openbot/collaboration-openbot-adapter` 对第二宿主有直接复用价值

## 6. 风险与未完成项

当前主要未完成项：

1. 尚未把 `collaboration-aegis-adapter` 从目录边界提升为独立可发布适配器包。
2. 尚未形成对外发布或拆仓的发布策略。
3. 尚未验证除 Aegis 之外的第三宿主。
4. 尚未验证更深的宿主侧持久化、审批链和长期运行行为。

## 7. 下一步建议

建议按以下顺序推进：

1. 先决定是否把当前目录边界升级成独立的 `collaboration-aegis-adapter` 包。
2. 若需要进一步证明通用性，再引入第三宿主。
3. 再决定是否进入对外发布或拆仓讨论。
4. 在完成至少两个宿主适配边界之前，不建议讨论 SDK 拆仓或公开发布。

## 8. 最终判断

当前最准确的阶段结论是：

`第二宿主深链路验证已通过，宿主级 build 已通过，正式 adapter 边界已出现，但仍处于生产前验证阶段。`
