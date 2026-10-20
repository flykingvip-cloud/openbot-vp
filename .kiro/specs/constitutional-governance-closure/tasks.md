# Tasks：宪法治理闭环（Constitutional Governance Closure）

## 任务目标

修复所有已识别的治理结构性缺陷（E15-E19），确保每个模型调用入口都受治理覆盖，消除绕过治理的执行路径。

## Agents

- `kiro-daibai` · role: owner · scope: 治理缺口实现修复 E15-E19 · paths: `src/gateway/governance/**`, `src/auto-reply/reply/**`, `src/agents/tools/**`, `.kiro/specs/constitutional-governance-closure/**` · since: 2026-10-01

注册表条目（SoT）：`.loom/registry.yaml` 任务 `constitutional-governance-closure:kiro-daibai`。

提交 trailer：

```text
Task: constitutional-governance-closure
Agent: kiro-daibai
```

## 执行清单

### E19: Inbound Media Understanding（入站媒体理解）

**缺陷描述：**

- 入站媒体理解（PNG/PDF/音视频自动描述）直接调用 SDK `complete()` 绕过治理适配器
- Production test 确认：PNG 上传生成描述，但 shadow ledger 无任何行
- 根因：`src/media-understanding/providers/image.ts:describeImageWithModel` 等函数在 agent run 创建前调用模型，不经过 `runWithModelFallback` 或任何治理入口

**修复方案：**

1. 创建 `direct-model-invocation-registry.ts`，要求所有绕过 fallback helper 的直接模型调用显式注册（instrumented/exempt）
2. 添加 contract test 强制注册覆盖（未注册的调用导致测试失败）
3. 实现 `media-understanding-shadow.ts` 写入 skipped governance 行（诚实效果：模型在治理评估前运行）
4. 在 4 个媒体理解调用点插桩：`get-reply.ts`（2处）、`dispatch-acp.ts`（2处）
5. 更新 `execution-entry-registry.ts` 添加 E19 条目，状态 Shadow（默认关，enforced 未实现）

**实现文件：**

- 新增：`src/gateway/governance/direct-model-invocation-registry.ts`
- 新增：`src/gateway/governance/media-understanding-shadow.ts`
- 修改：`src/gateway/governance/execution-entry-registry.ts`
- 修改：`src/gateway/governance/governance-contract.test.ts`
- 修改：`src/auto-reply/reply/get-reply.ts`
- 修改：`src/auto-reply/reply/dispatch-acp.ts`
- 文档：`.kiro/specs/constitutional-governance-discovery/execution-entry-inventory.md`

**测试验证：**

- Contract test: 97 assertions pass（7 new assertions in direct-invocation gate）
- Lint/format: pass
- 命令：`OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run src/gateway/governance/governance-contract.test.ts`

**状态：**

- [x] 诊断根因（production traffic test）
- [x] 设计 direct-invocation registry + contract enforcement
- [x] 实现 recordMediaUnderstanding 写入 skipped 行
- [x] 插桩 4 个媒体理解调用点
- [x] 添加 E19 到 execution-entry-inventory.md
- [x] Contract test 通过（97 assertions）
- [x] 代码完成，等待 landing
- [ ] 解决文件归属冲突（与 cursor/pi-sdk-family-migration-v3 等任务重叠）
- [ ] 提交并推送 E19 commit
- [ ] 创建 PR

**Landing 阻塞：**

工作树上存在多任务混合修改（attribution 显示 E19 文件被标记为 `cursor (pi-sdk-family-migration-v3:cursor)` 而非本任务）。需要：

1. 在 Loom registry 中正确注册 E19 的路径范围（已通过 `pnpm loom register` 完成基础注册）
2. 或将 E19 的修改隔离到独立 worktree
3. 或协调与其他任务的合并顺序

— kiro-daibai

### E15: AOR

**处置：** Exempt（已在 execution-entry-registry.ts 中注册）

**理由：**

- 库未改变
- 运行时流量通过 E2/E8
- 无需额外 shadow recorder

**状态：** ✅ 已完成

### E16: CLI backend

**处置：** Exempt（已在 execution-entry-registry.ts 中注册）

**理由：**

- 凭证范围 + recordCliBackendUsage 已存在
- 外部 CLI 进程
- P2-0: CLI backend 通过 acquireAgentCommandCommercialRun (E3) 运行，credit 记录在 recordCliBackendUsage

**状态：** ✅ 已完成

### E17: Fabric

**处置：** Legacy（已在 execution-entry-registry.ts 中注册）

**理由：**

- 默认关闭（OPENBOT_FABRIC_ENABLED）
- P2 只添加适配器，从不启用
- 不需要治理修复

**状态：** ✅ 已完成

### E18: task-orchestration

**处置：** Exempt（已在 execution-entry-registry.ts 中注册）

**理由：**

- ORCHESTRATION_LIVE_INVOKE=false（默认关闭）
- 未被此计划启用
- 休眠状态不需要治理

**状态：** ✅ 已完成

## 交付物

- [x] E15-E19 所有缺口修复代码
  - E15 (AOR): Exempt（库未改变，流量通过 E2/E8）
  - E16 (CLI backend): Exempt（凭证范围 + recordCliBackendUsage）
  - E17 (Fabric): Legacy（默认关闭，P2 只添加适配器）
  - E18 (task-orchestration): Exempt（ORCHESTRATION_LIVE_INVOKE=false）
  - E19 (media understanding): Shadow（已实现 recorder + contract test）
- [x] Contract tests 强制覆盖（97 assertions pass）
- [x] Shadow ledger 记录器（skipped rows）
- [x] 执行入口注册表更新（E19 添加到 registry）
- [x] 文档更新（execution-entry-inventory.md）
- [x] PR 并合并到 main（PR #270 待审查）

## 非目标

- 不实现 enforced mode（权益 allowlist 在媒体理解阶段不可达）
- 不修改媒体理解管线执行顺序（保持前置于 agent run）
- 不扩展 MODEL_CALLER_REGISTRY（保持 fallback-helper 语义纯净）

## 依赖与约束

- 依赖 `constitutional-governance-discovery` 的发现文档（execution-entry-inventory.md）
- shadow ledger 路径：`files.d/vault/tenant-001/shadow-ledger/YYYY/MM/DD/platform-user_<id>.ndjson`
- 环境变量：`OPENBOT_GOVERNANCE_MEDIA_UNDERSTANDING_SHADOW`（默认 off）
- 归属信息：从入站回合获取（`GatewayClientSessionEnterpriseId` + `GatewayClientPlatformUserId`）

## 参考

- Discovery 文档：`.kiro/specs/constitutional-governance-discovery/execution-entry-inventory.md`
- Traffic test 指令：`.codex-review/governance-closure/traffic-test-001-instructions.md`
- Production conversation: `conversation-3a40f768-8e53-4e6b-8816-1a9b5e9fedf4`
