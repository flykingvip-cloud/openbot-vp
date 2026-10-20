# 交接清单：Landing Stream 配置任务

## 快速交接

**任务：** 配置 4 个 UNMATCHED 文件的 landing stream 并提交

**文件：**

- `src/gateway/asset-admission.ts`
- `src/gateway/asset-admission.test.ts`
- `src/gateway/group-notification-service.ts`
- `src/gateway/group-notification-service.test.ts`

**详细指令：** 参见 `handoff-landing-stream-config.md`

## 核心步骤

```bash
# 1. 导入任务配置到 registry
pnpm loom import --spec .kiro/specs/capability-lifecycle-closure --write

# 2. 验证归属
bun scripts/agent-attribution.ts

# 3. 提交 asset-admission 模块
git add src/gateway/asset-admission.ts src/gateway/asset-admission.test.ts
scripts/committer "feat(asset-admission): add asset content readiness rules and admission gates

- Define 6 asset types with content requirements
- Implement placeholder detection patterns
- Add evaluateAssetContentReadiness and assertAssetAdmissible
- Add 5 test suites covering all asset types

Task: capability-lifecycle-closure
Agent: kiro-daibai" \
src/gateway/asset-admission.ts \
src/gateway/asset-admission.test.ts

# 4. 提交 group-notification-service 模块
git add src/gateway/group-notification-service.ts src/gateway/group-notification-service.test.ts
scripts/committer "feat(group-notification): add group notification service for asset sharing events

- Add sendGroupNotification (placeholder with TODO for channel routing)
- Add formatAssetShareNotification with Chinese labels
- Add 5 tests covering message formatting

Task: capability-lifecycle-closure
Agent: kiro-daibai" \
src/gateway/group-notification-service.ts \
src/gateway/group-notification-service.test.ts

# 5. 验证
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/asset-admission.test.ts \
  src/gateway/group-notification-service.test.ts
```

## 预期结果

- ✅ 4 个文件在 agent-attribution 中归属到 `kiro-daibai (capability-lifecycle-closure)`
- ✅ 2 个新的 commits
- ✅ 所有测试通过

## 问题？

参见 `handoff-landing-stream-config.md` 第 "故障排查" 部分。
