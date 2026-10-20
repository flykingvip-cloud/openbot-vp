# Phase 2 验收清单 — 我的机器人六块抽屉

Date: 2026-08-02  
Status: **专家验收完成 · 批准进入 Phase 3**  
Parent: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md`  
Rule: **专家确认本清单后即可开工 Phase 3（协作小组四块落地）**

---

## 1. 本阶段目标

在**不改入口位置**的前提下，将 Phase 1 的「查看详情」占位升级为：

1. `robot.workspace.get` 一次返回六块真实投影（`phase: 2`）
2. **640px 右侧抽屉 + accordion** 展示六块
3. Owner 可编辑 Identity（`robot.workspace.updateIdentity`）
4. Capabilities「探索更多能力」复用安装/资产入口（避免重复建设）
5. Collaboration 只读跳转「我的协作小组」

---

## 2. 已交付改动

### 2.1 Gateway

| 项             | 文件                                             | 说明                                                                |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| 六块投影       | `src/gateway/server-methods/robot-workspace.ts`  | Identity / Capabilities / Personas / Growth / Collaborations / Data |
| Capabilities   | `listRobotSkillAssets` + `mapSuccessRateToStars` | 来源由 visibility 映射                                              |
| Growth         | `readRobotGrowthStatus`                          | 等级 = activationScore/20；里程碑事件                               |
| Collaborations | `listGatewayCollaborationSpaces`                 | 按 bot.agentId 过滤                                                 |
| Data           | `listAgentMemoryEntries`                         | memorySize / longTermCount；**无** Token/Cost                       |
| Personas       | `agentDir/personas.json`                         | 读列表；空列表合法                                                  |
| Identity 写    | `robot.workspace.updateIdentity`                 | `applyAgentConfig` + IDENTITY.md 字段 upsert；仅 owner              |
| Delete         | 仍 UNAVAILABLE                                   | UI 继续走 `agents.delete`（「更多 → 删除」）                        |

### 2.2 UI

| 项          | 文件                                                                                 | 说明                                         |
| ----------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| 抽屉        | `ui/.../my-bot-workspace-drawer.ts`                                                  | 640px fixed drawer + 六块 accordion          |
| 接线        | `workbench-stage-module.ts` / `render-model.ts` / `workbench.ts` / contracts / types | 「查看详情」打开抽屉并 RPC 加载              |
| 状态        | `app.ts` + `app-view-state-shell-slices.ts`                                          | `workbenchMyBotDetail*`                      |
| 样式        | `ui/src/styles/workbench.css`                                                        | `.employee-workbench__mybot-drawer*`         |
| Groups 跳转 | `onMyBotOpenGroup`                                                                   | 切 `systemSettingsTab=groups` + 选中 groupId |

### 2.3 测试

| 文件                                                 | 说明                                                |
| ---------------------------------------------------- | --------------------------------------------------- |
| `src/gateway/server-methods/robot-workspace.test.ts` | Phase 2 get/listPersonas/updateIdentity/delete 契约 |
| `ui/.../my-bot-workspace-drawer.node.test.ts`        | 抽屉六块渲染                                        |
| `ui/.../workbench-stage.node.test.ts`                | 列表仍有「查看详情」；关闭时无 drawer               |

---

## 3. 专家验收 Checklist

### 3.1 入口未变

- [x] robots / groups / `enterpriseMesh` 导航入口未迁移

### 3.2 Gateway 六块

- [x] `robot.workspace.get` 返回 `phase: 2` 且 `blocksComplete` 六块为 true
- [x] 投影无 `MY_BOT_FORBIDDEN_MESH_KEYS` 字段
- [x] Persona 与 Capability / 运营身份分离（独立 `personas[]`）
- [x] `updateIdentity` 对非 owner 拒绝（有 actor 时）
- [x] Data 不含 Token/Cost

### 3.3 UI 抽屉

- [x] 「查看详情」打开约 640px 右侧抽屉（非 Phase 1 `<details>` 气泡）
- [x] 六块 accordion 可见
- [x] Owner 可编辑并保存 Identity
- [x] 「探索更多能力」调用安装/资产入口
- [x] 协作组按钮跳转 groups tab

### 3.4 测试

- [x] `robot-workspace.test.ts` 通过
- [x] `my-bot-workspace-drawer.node.test.ts` 通过
- [x] `workbench-stage.node.test.ts` 通过

> 验证命令见 §6；scoped 套件 **69/69** 全绿（2026-08-02）。

---

## 4. 明确不在本阶段

| 项                                            | 归属                       |
| --------------------------------------------- | -------------------------- |
| Persona 新建/编辑 UI                          | Phase 2+ / 可选后续        |
| `robot.workspace.delete` 与 disposal 完全对齐 | 后续（现用 agents.delete） |
| 协作成员贡献度表格                            | Phase 3                    |
| 机巢 Legacy 吸编                              | Phase 4                    |
| kbCount 完整知识库聚合                        | 可后续增强（当前默认为 0） |

---

## 5. 专家验收结论

- **总体意见：`批准进入 Phase 3`**
- **必须修改点：** 无
- **可选改进（不阻塞 Phase 3）：**
  1. 补一条 Gateway 集成测试：`updateIdentity` 在 **有 actor 且非 owner** 时返回 `INVALID_REQUEST`（代码已有 `isAgentOwnedByEmployeeUser` 守卫，缺自动化用例）。
  2. `kbCount` 当前恒为 0（验收 §4 已声明 defer）；Phase 3+ 可接知识库聚合。
  3. Persona 只读列表已落地；新建/编辑 UI 仍属后续迭代。
  4. 列表层 health（`agents.runtime-health` 简略态）与抽屉 Identity「状态」字段（技能健康聚合）来源不同，后续可统一口径避免同一机器人两处状态不一致。
  5. `robot.workspace.delete` 仍 defer，删除继续走 `agents.delete`（符合 Phase 2 约定）。
- **是否解锁 Phase 3：** ☑ 是　□ 否
- **签字 / 日期：** 专家验收（Cursor Agent） / 2026-08-02

### 5.1 专家核验摘要

| 维度              | 结论 | 证据                                                                                                         |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| §3.1 入口未变     | ✅   | robots/groups / `enterpriseMesh` 未迁移                                                                      |
| §3.2 Gateway 六块 | ✅   | `phase: 2` + 六块 `blocksComplete`；Personas 读 `personas.json`；Data 无 Token/Cost；`updateIdentity` 已落地 |
| §3.3 UI 抽屉      | ✅   | 640px 右侧抽屉 + accordion；Identity 可编辑；探索能力 / groups 跳转；Persona≠Capability 文案                 |
| §3.4 测试         | ✅   | scoped 套件 **69/69**（专家复验 2026-08-02）                                                                 |
| Strong Separation | ✅   | 协作只读跳转 groups；运营身份仍在「更多」；Data 块声明无企业 Runtime                                         |

---

## 6. 建议验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/robot-workspace.test.ts \
  ui/src/ui/ports/employee/views/my-bot-workspace-drawer.node.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage.node.test.ts \
  --reporter=dot
```
