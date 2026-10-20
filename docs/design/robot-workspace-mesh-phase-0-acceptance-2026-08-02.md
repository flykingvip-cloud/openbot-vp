# Phase 0 验收清单 — 边界冻结

Date: 2026-08-02  
Status: **必须修改点已补齐 · 待专家确认后启动 Phase 1**  
Parent: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md`  
Rule: **专家确认本补丁后即可开工 Phase 1**

---

## 1. 本阶段目标

在**不改入口位置**的前提下，完成 Strong Separation 的地基：

1. 员工端读模型类型契约（My Bots / Collaboration Group）
2. Gateway 命令面命名空间骨架（facade，写操作显式 defer）
3. PR 模板跨层检查清单

本阶段**刻意不做** UI 文案/CTA/六块抽屉（属 Phase 1/2）。

---

## 2. 已交付文件

### 2.1 员工读模型

| 文件                                                                  | 说明                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ui/src/ui/ports/employee/semantic/my-bot-read-model.ts`              | MyBot 六块投影类型、空投影、星级映射、三色简略态、禁 mesh 字段断言                                                   |
| `ui/src/ui/ports/employee/semantic/collaboration-group-read-model.ts` | 协作小组四块投影类型、贡献度 v1 公式                                                                                 |
| `ui/src/ui/ports/employee/semantic/index.ts`                          | 统一导出                                                                                                             |
| `ui/src/ui/ports/employee/semantic/my-bot-read-model.node.test.ts`    | 契约测试                                                                                                             |
| `ui/src/ui/ports/employee/views/workbench-types.ts`                   | `WorkbenchSettingsRobotEntry` 增加 `detailAvailable` / `capabilityCount` / `growthLevel` / `participatingGroupCount` |

### 2.2 Gateway 命令面骨架

| 文件                                                         | RPC                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/gateway/server-methods/robot-workspace.ts`              | `robot.workspace.get` / `.listPersonas` / `.updateIdentity` / `.delete`        |
| `src/gateway/server-methods/collaboration-space-boundary.ts` | `collaboration.space.get` / `.updateBasic` / `.updateMission` / `.updateRules` |
| `src/gateway/server-methods/mesh-boundary-facade.ts`         | `mesh.operations.*` / `mesh.performance.*`                                     |
| 接线                                                         | `server-methods.ts` / `server-methods-list.ts` / `method-scopes.ts`            |
| 测试                                                         | `robot-workspace.test.ts` / `mesh-boundary-facade.test.ts`                     |

行为约定（验收要点）：

- `robot.workspace.get`：返回六块 shell；Identity 可从 agents 填充；其余块空 + `phase: 0`
- `robot.workspace.updateIdentity` / `.delete`：`UNAVAILABLE`，文案标明 **Phase 2**（禁止提前双写）
- `collaboration.space.*` 写方法：`UNAVAILABLE` → **Phase 3**
- `mesh.operations.*` / `mesh.performance.*`：facade 到现有 `governance.*` / `mesh.governance.*`
- Scope：读方法 `operator.read`；员工写方法 `operator.write`；`mesh.operations.intervene` 为 `operator.admin`

### 2.3 PR 治理

| 文件                               | 说明                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| `.github/pull_request_template.md` | 新增 **Strong Separation / Layer Check** 勾选段（对照方案 §6） |

---

## 3. 专家验收 Checklist

### 3.1 边界契约

- [x] MyBot 投影类型包含六块：Identity / Capabilities / Personas / Growth / Collaborations / Data
- [x] `MY_BOT_FORBIDDEN_MESH_KEYS` 覆盖 cost / token / runtimeHost / budget / governanceStatus 等，且有断言测试
- [x] Persona 与 Capability 在类型上分离（独立 `personas[]`）
- [x] Collaboration Group 投影含 basic / mission / members / rules 四块
- [x] 员工投影未引入企业成本字段

### 3.2 命令面分桶

- [x] 新 RPC 使用 `robot.workspace.*` / `collaboration.space.*` / `mesh.operations.*` / `mesh.performance.*` 命名
- [x] 已在 `listGatewayMethods` + `method-scopes` 注册（13 个 Phase 0 RPC 均已归类）
- [x] 写 RPC 未在 Phase 0 实际落库（defer UNAVAILABLE 可接受）
- [x] Mesh facade 未把 Prompt/Skill 安装暴露为员工可写接口

### 3.3 PR 模板

- [x] PR template 含跨层检查段，并引用方案文档路径
- [x] 勾选项覆盖：员工无企业成本/Runtime；协作只读；机巢无 Identity/Prompt 编辑；术语禁用；命令分桶；Persona 不混表

### 3.4 入口未变

- [x] 未改导航：`workbenchSystemSettingsTab` robots/groups、`enterpriseMesh` 仍为入口
- [x] 本阶段无 UI 可见行为变更（`WorkbenchSettingsRobotEntry` 新增可选字段未接线渲染，符合 Phase 0 范围）

### 3.5 测试

- [x] `ui/.../my-bot-read-model.node.test.ts` 通过
- [x] `src/gateway/server-methods/robot-workspace.test.ts` 通过（3/3）
- [x] `src/gateway/server-methods/mesh-boundary-facade.test.ts` 通过（2/2）
- [x] `src/gateway/phase-0-boundary-rpc.test.ts` 通过 — **Phase 0 范围限定闸门**（断言 13 个 boundary RPC 同时在 `listGatewayMethods`、`coreGatewayHandlers`、`method-scopes` 且 scope 正确）

> **脚注（§3.5）：** 全量 `src/gateway/method-scopes.test.ts` 仍可能因 Phase 0 **之前既有**未归类方法失败（如 `governance.*` 等约 17 项）。该失败为历史债务，**不视为**本次 Phase 0 交付回归；Phase 0 验收以 `phase-0-boundary-rpc.test.ts` 为准。归类债务建议在 Phase 4 前消化。

---

## 4. 明确不在本阶段（防范围膨胀）

| 项                                         | 归属    |
| ------------------------------------------ | ------- |
| 文案去除「治理」、CTA 分层、health 三色 UI | Phase 1 |
| My Bots 六块抽屉 UI                        | Phase 2 |
| Persona 存储落地                           | Phase 2 |
| 协作小组四块 UI + 贡献度展示               | Phase 3 |
| Legacy 吸编 Active / 运营+绩效 Tab         | Phase 4 |

---

## 5. 专家验收结论

- **总体意见：`批准但需修改`**（2026-08-02 初审）→ 执行团队已提交必须修改补丁（见 §5.2）
- **必须修改点：**
  1. **§3.5 测试闸门**：补一份 **Phase 0 范围限定** 的 scope 回归测试（建议 `src/gateway/phase-0-boundary-rpc.test.ts`），断言 13 个 boundary RPC 同时出现在 `listGatewayMethods` 与 `method-scopes` 且 scope 正确；并在 §3.5 脚注标明 `method-scopes.test.ts` 全量失败为 **Phase 0 前既有债务**（`governance.*` 等），不视为本次交付回归。
  2. **Gateway ↔ UI 类型对齐**：`robot.workspace.get` / `collaboration.space.get` 响应中的 `phase` / `blocksComplete` 应纳入 `MyBotProjection` / `CollaborationGroupProjection` 为可选元数据，或从 Phase 0 响应剥离，避免 UI 契约与 Gateway 漂移。
- **可选改进（不阻塞 Phase 1）：**
  - `buildWorkbenchSettingsRobotEntries` 预填 `detailAvailable` / `capabilityCount` 等列表摘要字段（Phase 2 抽屉懒加载的前置）。
  - 归类 `governance.*` 等 17 个既有未 scope 方法（Mesh facade 底层依赖；建议在 Phase 4 前完成）。
  - 修复 `server-methods.ts` 中 `robot-workspace` import 行拼接格式。
  - CI 增加 PR 模板 Strong Separation 段落的 bot 提醒（非强制勾选校验）。
- **签字 / 日期：** 专家验收（Cursor Agent） / 2026-08-02

### 5.2 必须修改点补丁状态（执行团队）

| #    | 要求                                              | 状态          | 证据                                                                                     |
| ---- | ------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| 1    | Phase 0 范围限定 scope 回归 + §3.5 脚注           | ✅ 已完成     | `src/gateway/phase-0-boundary-rpc.test.ts`；§3.5 已加脚注                                |
| 2    | `phase` / `blocksComplete` 纳入 UI 投影可选元数据 | ✅ 已完成     | `MyBotProjection` / `CollaborationGroupProjection` 增加可选字段；空投影默认带 `phase: 0` |
| 可选 | `server-methods.ts` import 行格式                 | ✅ 已顺手修复 | `robotWorkspaceHandlers` 与下一 import 分行                                              |

请专家确认 §5.2 后，**批准启动 Phase 1**。

### 5.1 分项核验摘要

| 维度                            | 结论     | 说明                                 |
| ------------------------------- | -------- | ------------------------------------ |
| 读模型六块 + 禁 mesh 字段       | ✅       | `my-bot-read-model.ts` + 断言测试    |
| 协作四块 + 贡献度 v1 公式       | ✅       | `collaboration-group-read-model.ts`  |
| 命令面 13 RPC + defer 写        | ✅       | 写方法 UNAVAILABLE → Phase 2/3       |
| Mesh 不暴露员工 Prompt/Skill 写 | ✅       | facade 仅 list / intervene / ranking |
| PR 跨层清单                     | ✅       | `.github/pull_request_template.md`   |
| 入口未动 / 无 UI 行为变更       | ✅       | 符合 Phase 0 刻意不做 UI 的约定      |
| 专项测试                        | ✅ 10/10 | 三个 Phase 0 测试文件全绿            |
| method-scopes 全量              | ⚠️       | 既有债务；Phase 0 RPC 本身已注册     |

---

## 6. 一句话

Phase 0 只钉死**读模型契约 + 命令面桶 + PR 跨层闸门**；UI 止血留给 Phase 1，避免未验收越界开工。
