# Phase 3 验收清单 — 协作小组四块落地

Date: 2026-08-02  
Status: **专家验收完成 · 批准进入 Phase 4**  
Parent: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md`  
Rule: **专家确认本清单后即可开工 Phase 4（机巢运营 + 绩效成型）**

---

## 1. 本阶段目标

在**不改入口位置**的前提下：

1. `collaboration.space.get` 返回 `phase: 3` 四块投影（含成员贡献度 v1）
2. 成员区展示 **身份 / 职责 / 贡献度 / 最近活跃** 表格
3. 群规则字段归入「群治理」（开放讨论、最大回复、归档等）
4. My Bots Collaboration → 同设置页「我的协作小组」跳转（无新路由）
5. `collaboration.space.update*` 写 facade 落地（包装现有 members.update）

---

## 2. 已交付改动

### 2.1 Gateway

| 项        | 文件                                                         | 说明                                                                          |
| --------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| get 投影  | `src/gateway/server-methods/collaboration-space-boundary.ts` | `phase: 3`；成员四列 + rules 完整                                             |
| 贡献度 v1 | 扫描 `agents/*/sessions/sessions.json`                       | `sessionCount/total*100`；space 别名归因 owner                                |
| 身份/职责 | `memberRoleMap` + owner/admin/coordinator                    | 中文标签                                                                      |
| update\*  | `updateBasic` / `updateMission` / `updateRules`              | facade → `updateGatewayCollaborationSpaceMembers`（保留现有 members/invites） |

### 2.2 UI

| 项     | 文件                                    | 说明                                  |
| ------ | --------------------------------------- | ------------------------------------- |
| 成员表 | `collaboration-group-members-table.ts`  | 四列渲染                              |
| 列表行 | `buildWorkbenchSettingsGroupMemberRows` | 本地身份/职责/活跃；贡献度由 get 补齐 |
| 加载   | `loadCollaborationGroupProjection`      | 切组 / 进 groups tab 时拉 get         |
| 群治理 | `workbench-stage-module.ts`             | 开放讨论 / 最大回复 / 归档状态        |
| 跳转   | `onMyBotOpenGroup`                      | 关闭抽屉 → groups + 选中 groupId      |

### 2.3 测试

| 文件                                             | 说明              |
| ------------------------------------------------ | ----------------- |
| `collaboration-space-boundary.test.ts`           | get/update\* 契约 |
| `collaboration-group-members-table.node.test.ts` | 四列渲染          |
| `workbench-stage.node.test.ts`                   | 成员/群治理文案   |

---

## 3. 专家验收 Checklist

### 3.1 入口未变

- [x] robots / groups / `enterpriseMesh` 导航入口未迁移

### 3.2 Gateway

- [x] `collaboration.space.get` 返回 `phase: 3` 且 `blocksComplete` 四块为 true
- [x] 成员含 identity / duty / contribution / lastActiveAt
- [x] 贡献度口径为 session 占比（§7.5）
- [x] update\* 不再 UNAVAILABLE（未知 groupId → INVALID_REQUEST）
- [x] 规则块含 openDiscussion / maxVisibleBotReplies / confidentiality / archived

### 3.3 UI

- [x] 「三、成员」为四列表格（非仅计数骨架）
- [x] 「四、群治理 · 协作规则」展示开放讨论 / 最大回复 / 归档
- [x] 文案标明协作层治理（非企业机巢）
- [x] My Bots 协作组按钮跳转 groups tab（`onMyBotOpenGroup`）

### 3.4 测试

- [x] `collaboration-space-boundary.test.ts` 通过
- [x] `collaboration-group-members-table.node.test.ts` 通过
- [x] `workbench-stage.node.test.ts` 通过

> scoped 套件 **67/67** 全绿（2026-08-02）。

---

## 4. 明确不在本阶段

| 项                                            | 归属                       |
| --------------------------------------------- | -------------------------- |
| 贡献度 v2（独立 contributionScore）           | 后续                       |
| 成员表内联编辑身份/职责                       | 后续（仍走成员管理面板）   |
| 机巢 Legacy 吸编 / 运营引擎                   | Phase 4                    |
| 页面 section 严格 DOM 重排为 1→2→3→4 视觉顺序 | 可选改进（标题已四块对齐） |

---

## 5. 专家验收结论

- **总体意见：`批准进入 Phase 4`**
- **必须修改点：** 无
- **可选改进（不阻塞 Phase 4）：**
  1. ✅ UI 保存已改走 `collaboration.space.update*` facade
  2. ✅ `updateRules` 已支持 openDiscussion / maxVisible + UI toggle
  3. ✅ 详情区 DOM 已重排为 1→2→3→4
  4. 成员身份/职责内联编辑仍走「管理成员」面板（§4 defer）。
  5. ~~贡献度 v2 独立 `contributionScore`~~ → **已在后续清理轮落地**（见 Phase 4 验收 §4）。
- **是否解锁 Phase 4：** ☑ 是　□ 否
- **签字 / 日期：** 专家验收（Cursor Agent） / 2026-08-02

### 5.1 专家核验摘要

| 维度              | 结论 | 证据                                                                            |
| ----------------- | ---- | ------------------------------------------------------------------------------- |
| §3.1 入口未变     | ✅   | robots/groups / `enterpriseMesh` 未迁移                                         |
| §3.2 Gateway      | ✅   | `phase: 3` 四块完整；成员四列 + session 占比贡献度；update\* 已落地             |
| §3.3 UI           | ✅   | 成员四列表格；群治理展示开放讨论/最大回复/归档；协作层文案；My Bots 跳转 groups |
| §3.4 测试         | ✅   | scoped 套件 **67/67**（专家复验 2026-08-02）                                    |
| Strong Separation | ✅   | 协作详情无企业成本/Runtime；群治理标明「非企业机巢」                            |

---

## 6. 建议验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/collaboration-space-boundary.test.ts \
  ui/src/ui/ports/employee/views/collaboration-group-members-table.node.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage.node.test.ts \
  --reporter=dot
```
