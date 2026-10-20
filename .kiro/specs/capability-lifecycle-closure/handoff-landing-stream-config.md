# Landing Stream 配置与文件提交任务

## 任务概述

有 4 个已创建的文件因为被 worktree audit hook 标记为 UNMATCHED 而无法提交。需要在 `.loom/registry.yaml` 中为 `capability-lifecycle-closure:kiro-daibai` 任务添加这些文件的 path 模式，然后提交这些文件。

## 背景

这 4 个文件是 capability-lifecycle-closure 任务的核心模块：

1. 资产准入规则引擎（asset-admission）
2. 小组通知服务（group-notification-service）

它们已经编写完成并通过所有测试，但因为是新创建的文件，worktree audit hook 将它们标记为 UNMATCHED，要求显式指定所属 landing stream。

## 待处理的文件

```
src/gateway/asset-admission.ts
src/gateway/asset-admission.test.ts
src/gateway/group-notification-service.ts
src/gateway/group-notification-service.test.ts
```

## 执行步骤

### 步骤 1：查看当前任务的 path 配置

```bash
grep -A 10 "capability-lifecycle-closure:kiro-daibai" .loom/registry.yaml
```

你应该看到类似这样的配置：

```yaml
- id: capability-lifecycle-closure:kiro-daibai
  owner: kiro-daibai
  intent: []
  paths:
    - src/gateway/asset-admission.ts
    - src/gateway/asset-admission.test.ts
    - src/gateway/server-methods/employee-capability.ts
    - src/gateway/skill-lifecycle-store.ts
    - ui/src/ui/capability/employee-capability/types.ts
    - ui/src/ui/controllers/asset-incubation/*
    - ui/src/ui/controllers/my-accumulation.ts
    - ui/src/ui/views/my-accumulation.ts
    - .kiro/specs/capability-lifecycle-closure/tasks.md
```

### 步骤 2：添加新文件的 path 模式

使用 `pnpm loom import` 命令重新导入任务配置，它会自动从 `tasks.md` 的 `## Agents` 部分读取 path 模式：

```bash
pnpm loom import --spec .kiro/specs/capability-lifecycle-closure --write
```

**注意：** 如果 `tasks.md` 的 `## Agents` 部分已经包含了这些文件的路径模式，这一步会自动更新 registry。如果没有，需要先更新 `tasks.md`。

### 步骤 3：手动添加（如果自动导入失败）

如果自动导入没有添加新文件，手动编辑 `.loom/registry.yaml`：

1. 找到 `capability-lifecycle-closure:kiro-daibai` 任务
2. 在 `paths:` 列表中添加：

```yaml
paths:
  - src/gateway/asset-admission.ts
  - src/gateway/asset-admission.test.ts
  - src/gateway/group-notification-service.ts
  - src/gateway/group-notification-service.test.ts
  # ... 保留其他已有的路径
```

### 步骤 4：验证配置

运行 agent-attribution 检查文件是否正确归属：

```bash
bun scripts/agent-attribution.ts
```

你应该看到这 4 个文件现在被归属到 `kiro-daibai (capability-lifecycle-closure)`，而不是 UNMATCHED。

### 步骤 5：提交文件

现在可以提交这 4 个文件了：

#### 5.1 提交 asset-admission 模块

```bash
git add src/gateway/asset-admission.ts src/gateway/asset-admission.test.ts

scripts/committer "feat(asset-admission): add asset content readiness rules and admission gates

- Define 6 asset types (prompt/template/workflow/knowledge/agent/capability) with content requirements
- Implement placeholder detection patterns (filename patterns + text patterns)
- Add evaluateAssetContentReadiness function (returns gaps and readiness status)
- Add assertAssetAdmissible function (hard gate that throws on block-level gaps)
- Add 5 test suites covering all asset types and edge cases
- Tests verify block/recommend severity handling and placeholder detection

This module serves as the single source of truth for asset admission rules,
preventing unfilled placeholders (like 顾氏医案.pdf) from entering incubation funnel.

Task: capability-lifecycle-closure
Agent: kiro-daibai" \
src/gateway/asset-admission.ts \
src/gateway/asset-admission.test.ts
```

#### 5.2 提交 group-notification-service 模块

```bash
git add src/gateway/group-notification-service.ts src/gateway/group-notification-service.test.ts

scripts/committer "feat(group-notification): add group notification service for asset sharing events

- Add sendGroupNotification function (placeholder implementation with TODO for channel routing)
- Add formatAssetShareNotification to format share event messages with Chinese labels
- Map asset types to Chinese labels (提示词/模板/工作流/知识库/智能体/能力)
- Message format: 📢 来自 {sharer} 分享了{type}「{name}」到本小组
- Add 5 tests covering message formatting and notification API
- Use prefixSystemMessage for system message formatting

TODO: Implement actual delivery mechanism (requires channel routing integration).

Task: capability-lifecycle-closure
Agent: kiro-daibai" \
src/gateway/group-notification-service.ts \
src/gateway/group-notification-service.test.ts
```

### 步骤 6：验证提交

```bash
git log --oneline -4
```

应该看到两个新的提交。

### 步骤 7：运行测试确认

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/asset-admission.test.ts \
  src/gateway/group-notification-service.test.ts \
  --reporter=verbose
```

应该看到所有测试通过。

## 预期结果

完成后：

- ✅ `.loom/registry.yaml` 中 `capability-lifecycle-closure:kiro-daibai` 任务包含了 4 个新文件的路径
- ✅ `bun scripts/agent-attribution.ts` 显示这 4 个文件归属到 `kiro-daibai (capability-lifecycle-closure)`
- ✅ 两个新的 git commits 已创建
- ✅ 所有测试通过

## 故障排查

### 问题 1：自动导入未添加路径

**原因：** `tasks.md` 的 `## Agents` 部分可能缺少这些文件的 glob 模式。

**解决：** 手动编辑 `.kiro/specs/capability-lifecycle-closure/tasks.md`，在 `## Agents` 部分的 `paths:` 中添加：

```markdown
## Agents

- kiro-daibai · role: owner · scope: asset admission readiness gate + type inference fix + org-candidate badge real evidence + group share notification · paths: src/gateway/asset-admission.ts, src/gateway/asset-admission.test.ts, src/gateway/group-notification-service.ts, src/gateway/group-notification-service.test.ts, src/gateway/server-methods/employee-capability.ts, src/gateway/skill-lifecycle-store.ts, ui/src/ui/capability/employee-capability/types.ts, ui/src/ui/controllers/asset-incubation/\*, ui/src/ui/controllers/my-accumulation.ts, ui/src/ui/views/my-accumulation.ts, .kiro/specs/capability-lifecycle-closure/tasks.md · since: 2026-07-01
```

然后重新运行 `pnpm loom import --spec .kiro/specs/capability-lifecycle-closure --write`。

### 问题 2：提交时仍显示 UNMATCHED

**原因：** registry 更新未生效或路径模式不匹配。

**解决：**

1. 确认 `.loom/registry.yaml` 中确实包含了这些路径
2. 运行 `bun scripts/agent-attribution.ts` 验证
3. 如果仍然 UNMATCHED，检查路径是否完全匹配（注意通配符 `*`）

### 问题 3：committer 脚本阻塞

**原因：** 可能跨越多个 landing streams。

**解决：** 使用 `git commit` 直接提交（如果 hook 仍然阻塞，说明配置有问题，需要回到步骤 2-4 重新检查）。

## 参考信息

- **任务规范：** `.kiro/specs/capability-lifecycle-closure/tasks.md`
- **会话总结：** `.kiro/specs/capability-lifecycle-closure/session-summary-2026-07-01.md`
- **任务 4 详情：** `.kiro/specs/capability-lifecycle-closure/task4-group-notification-summary.md`
- **AGENTS.md 规则：** `AGENTS.md` 第 126-175 行（多 agent 协作与 commit 治理）

## 文件功能说明

### asset-admission.ts

- 定义 6 种资产类型的内容要求（block/recommend）
- 实现占位符检测（文件名模式 + 文本模式）
- 提供 `evaluateAssetContentReadiness`（评估就绪度）
- 提供 `assertAssetAdmissible`（硬门禁，block 级缺失抛出异常）

### group-notification-service.ts

- 提供 `sendGroupNotification`（发送小组通知，当前占位符实现）
- 提供 `formatAssetShareNotification`（格式化分享通知消息）
- 使用 `prefixSystemMessage` 添加系统消息标记
- TODO: 需要实现真实的 channel 路由和投递机制

## 注意事项

1. **不要修改其他代理的文件**：只处理上述 4 个文件，忽略 `codex/`、`semantic-review/`、`skills/` 等其他代理的工作目录。

2. **保持 commit message 格式**：遵循 Conventional Commits 规范，包含 `Task:` 和 `Agent:` trailers。

3. **测试优先**：提交前确保所有测试通过。

4. **文档同步**：如果修改了 `tasks.md` 的 `## Agents` 部分，记得运行 `pnpm loom derive` 更新派生视图（如果有的话）。

---

**任务优先级：** 高（阻塞后续工作）  
**预计时间：** 15-30 分钟  
**前置任务：** 无（可立即执行）  
**交接人：** kiro-daibai  
**接收人：** [待指定的 agent]
