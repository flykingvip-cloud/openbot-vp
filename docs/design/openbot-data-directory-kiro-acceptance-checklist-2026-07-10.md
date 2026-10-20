# OpenBot 数据目录 / Data Space — Kiro 实施验收清单

> **状态：验收基线 v1.0** | 创建：2026-07-10  
> **分工**：**Kiro 团队** — 按规格实施；**Cursor 团队** — 按本文档验收（不通过则退回修复）  
> **规格依据**（冻结，变更须先改文档再验收）：
>
> - [数据目录产品规格 v0.2](/design/openbot-data-directory-product-spec-2026-07-10)
> - [Data Space 数据模型 v1.0](/design/openbot-data-space-model-v1-2026-07-10)

---

## 1. 验收原则

1. **按 Phase 分批验收**：Kiro 交付须标明 Phase；未声明 Phase 的 PR 一律不合并。
2. **证据优先**：每项须附「命令输出 / 测试名 / 截图或录屏」之一；仅 PR 描述不算通过。
3. **架构决策 Q1–Q5 为红线**：任一项违反即 **整批驳回**，不进入部分通过。
4. **Phase 1 禁止大爆炸**：若 PR 在未声明 Phase 3 的情况下重写 `resolveAgentWorkspaceDir` 全链路，**驳回**。
5. **多 Agent 共享树**：验收在可能脏的共享 working tree 上运行时，只评审 Kiro 声明的文件范围；要求 Kiro 在 PR / `tasks.md` 中列出 `paths:` 与 `Agent:` trailer。

---

## 2. 架构决策红线（§14，每 Phase 必查）

| 编号 | 决策                                           | 验收方法                                            | 不通过特征                                                                         |
| ---- | ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1   | 用户资产根 `~/OpenBot`（`data.root`）          | 新装后检查目录 + `config.get`                       | 仍强制用户选路径；默认仍仅 `~/.openbot/workspace` 且无 `data.root`                 |
| Q2   | `agents/<id>/` Agent Space；**无 `bots/`**     | `rg 'bots/' ui/ src/` 员工端路径；目录树检查        | 一级目录仍叫 `bots/`；扁平 `~/OpenBot/workspace` 作为唯一 agent 根（新装）         |
| Q3   | Runtime 不迁；Archive 属用户数据               | 迁移/导出 bundle 清单 + 代码审查                    | 迁移含 `~/.openbot/credentials`；导出/迁移不含 `conversations/archive`（Phase 2+） |
| Q4   | CLI / App 共用 Migration Engine                | 同一 `data.migration.*` 或共享模块被 CLI 与 UI 调用 | 两套独立复制逻辑无共享核心                                                         |
| Q5   | SaaS Gateway **强拒绝** browse + UI **不展示** | SaaS 环境 RPC 403 + UI 无入口                       | 仅藏 UI 但 RPC 仍 200；SaaS 仍可打开文件浏览器                                     |

---

## 3. Phase 1 验收（止损与默认化）

**Kiro 交付物声明模板**：`Phase 1 — 数据目录止损`

### 3.1 必须删除（UI / 状态）

| ID       | 检查项                                     | 验证                                                                                 |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| P1-UI-01 | 员工端系统设置无「更改」「云端」工作区按钮 | 打开系统设置 → 安全；无上述按钮                                                      |
| P1-UI-02 | 无全屏「工作区选择」面板                   | 全文搜索无 `renderWorkspaceSelector` 打开路径 / 无 `workspace-selector-panel` 可触发 |
| P1-UI-03 | 无「手动输入路径」                         | `rg '手动输入路径' ui/` 无匹配                                                       |
| P1-UI-04 | 无「工作区未配置」阻断                     | `workspaceRiskCount` 不因缺省路径 >0；无「去配置工作区」强制 CTA                     |
| P1-UI-05 | 无 `workspaces.local.browse` 员工端调用    | `rg 'workspaces\.local\.(browse\|choose)' ui/src/ui/ports/employee` 无员工设置流调用 |

**命令**：

```bash
rg '手动输入路径|工作区选择|onOpenWorkspaceSelector\("default-local"\)|workspace-picker-shell' ui/src/ui/ports/employee
pnpm exec vitest run ui/src/ui/ports/employee/views/workbench-stage.node.test.ts -t "workspace"
```

### 3.2 必须新增 / 修改（行为）

| ID        | 检查项                                           | 验证                                                                         |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| P1-BEH-01 | 新装 / onboard 写入 `data.root` 默认 `~/OpenBot` | 清配置后 onboard；`config.get` 含 `data.root`                                |
| P1-BEH-02 | 创建最小目录树 + `data.schemaVersion: 1`         | 磁盘存在 `~/OpenBot/agents/` 等（见 Data Space §3）；manifest 或配置版本字段 |
| P1-BEH-03 | 未配置路径仍可创建机器人                         | 新用户流程无 workspace 配置步骤即可创建 agent                                |
| P1-BEH-04 | SaaS 员工端展示托管说明                          | 文案含「云端托管」类说明；**无**服务器路径                                   |
| P1-BEH-05 | SaaS Gateway 拒绝 `workspaces.local.browse`      | 公网 `data.mode=managed` 或等价判定下 RPC 返回 403/LOCAL_ONLY                |
| P1-BEH-06 | `openbot doctor` 检查 `data.root`                | doctor 输出含 data.root 存在性/权限项                                        |

**命令**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/server-methods/workspaces.test.ts
pnpm exec vitest run src/gateway/platform-auth/public-request.test.ts  # 若 browse 门禁依赖公网判定
pnpm openbot doctor  # 本机
```

### 3.3 必须保持（Phase 1 禁止项）

| ID       | 检查项                                    | 验证                                                               |
| -------- | ----------------------------------------- | ------------------------------------------------------------------ |
| P1-NO-01 | **未**全面替换 `resolveAgentWorkspaceDir` | `git diff` 若改 `agent-scope.ts` 解析逻辑须 Phase 3 标签，否则驳回 |
| P1-NO-02 | **未**迁移 credentials 到 `~/OpenBot`     | `~/OpenBot` 下无 `credentials/` 副本                               |

### 3.4 测试门禁

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  ui/src/ui/ports/employee/views/workbench-stage.node.test.ts \
  ui/src/ui/ports/employee/render-model.node.test.ts \
  src/gateway/server-methods/workspaces.test.ts
pnpm check   # Kiro PR 合并前须绿（或验收时跑一次并记录）
```

### 3.5 Phase 1 人工验收脚本（SaaS）

1. 打开 <https://www.openbot.love> ，Cmd+Shift+R 强刷
2. 系统设置 → 安全：**无**工作区文件浏览器、**无**更改按钮
3. DevTools → 无 `workspaces.local.browse` 请求（或 403）
4. 创建机器人流程不被「工作区未配置」阻断

### 3.6 Phase 1 签署

| 项                | 验收人 | 日期       | 结果                                        |
| ----------------- | ------ | ---------- | ------------------------------------------- |
| P1 自动化测试     | Cursor | 2026-07-10 | ☑ **驳回**（见下方验收记录）                |
| P1 SaaS 人工      | Cursor | 2026-07-10 | ☑ **驳回**（线上 UI 资产缺失 + 代码未达标） |
| P1 架构红线 Q1–Q5 | Cursor | 2026-07-10 | ☑ **驳回**（Q5 UI 未达标；Q1/Q2 UI 未对齐） |

### 3.7 验收记录 — Phase 1 驳回（2026-07-10，复验 R0）

**交付形态**：工作树 WIP（`fix-scoped-package-templates` 分支），**无** Kiro Phase 1 PR / 无 `Agent:` trailer / 核心文件**未提交**。

**已通过（后端局部，不计 Phase 1 整体通过）**：

| ID                   | 证据                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P1-UI-03             | `rg '手动输入路径' ui/` 无匹配                                                                                             |
| P1-BEH-05（Gateway） | `workspaces.ts` `rejectLocalWorkspaceRpcWhenManaged` + vitest `hard-rejects local workspace RPCs in managed`               |
| P1-BEH-01/02（逻辑） | `src/config/data-space.ts` `initDataSpaceForConfig` + `ensureDataSpace`（`agents/`、`schemaVersion:1`）；`setup.ts` 已接线 |
| P1-BEH-06（逻辑）    | `src/commands/doctor-data-space.ts` + `doctor.ts` import                                                                   |
| P1-NO-01             | `agent-scope.ts` 无 Data Space 全量替换                                                                                    |
| P1-NO-02             | Data Space 树不含 credentials                                                                                              |

**未通过（必须修复）**：

| ID        | 现象                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| P1-UI-01  | `workbench-stage-module.ts` 仍有「更改」「云端」按钮                                     |
| P1-UI-02  | `renderWorkspaceSelector` 全屏面板仍可触发；测试仍断言 `workspace-picker-shell` 存在     |
| P1-UI-04  | `workspaceRiskCount = Number(!defaultWorkspaceRoot)`；「去配置工作区」CTA 仍在           |
| P1-UI-05  | `render-model.ts` / `render-model-workbench-actions.ts` 仍调用 `workspaces.local.browse` |
| P1-BEH-03 | 机器人 `workspaceState: unconfigured` 逻辑仍绑定 `defaultWorkspaceRoot`                  |
| P1-BEH-04 | 系统设置仍展示「OpenBot 工作空间根目录」+ `~/openbot/workspaces`，**无** SaaS 托管说明   |
| Q1        | UI 默认文案非 `~/OpenBot`；员工端未读 `data.root`                                        |
| Q2        | 后端已用 `agents/`，UI/状态仍用 `agents.defaults.workspace` 心智                         |
| Q5        | Gateway 已拒 browse（WIP），**UI 仍暴露**文件浏览器入口 → **红线违反**                   |

**测试缺口**：`doctor-data-space` 无单测；`render-model.node.test.ts` 仍覆盖/期望 browse 流程。

**线上**：`https://www.openbot.love/` 返回 `Control UI assets not found`（部署阻断，需 Kiro/DevOps 单独修复后复验 SaaS 人工项）。

**结论**：**Phase 1 整批驳回**。请 Kiro 完成 UI 止损 + 提交正式 PR 后标注「复验 R1」。

---

## 4. Phase 2 验收（数据目录 + 导出/恢复）

**Kiro 交付物声明模板**：`Phase 2 — 数据目录高级能力`

### 4.1 信息架构

| ID       | 检查项                                    | 验证                    |
| -------- | ----------------------------------------- | ----------------------- |
| P2-IA-01 | 入口在 **设置 → 高级 → 数据目录**         | 不在系统设置主卡片      |
| P2-IA-02 | 默认页只读：磁盘名、`~/OpenBot`、已用空间 | 截图对比产品规格 §6.2.1 |
| P2-IA-03 | 「在 Finder 中显示」仅本机 App            | SaaS 无此按钮           |

### 4.2 迁移引擎（Q4）

| ID        | 检查项                                                                      | 验证                          |
| --------- | --------------------------------------------------------------------------- | ----------------------------- |
| P2-MIG-01 | `data.migration.preflight/start/status/cancel` 存在                         | Gateway 方法列表 + 测试       |
| P2-MIG-02 | CLI `openbot data migrate` 调用同一核心                                     | 共享模块路径在 PR 说明中列出  |
| P2-MIG-03 | 状态机：失败回滚，无半迁移                                                  | 集成测试或 scripted e2e       |
| P2-MIG-04 | Bundle 含 `agents/`、`shared/`、`memory/personal/`、`conversations/archive` | 对照产品规格 §7.1             |
| P2-MIG-05 | **不含** credentials / identity                                             | 迁移后 `~/OpenBot` 无 secrets |

### 4.3 导出 / 恢复

| ID        | 检查项                                       | 验证                                    |
| --------- | -------------------------------------------- | --------------------------------------- |
| P2-EXP-01 | `data.export` 或等价 API 生成 zip + manifest | 解压检查清单见 Data Space §8.3          |
| P2-EXP-02 | 导出含 conversations archive                 | 有历史对话的 agent 导出后可检索         |
| P2-EXP-03 | 导出**不含** credentials                     | zip 内无 `credentials`、`auth-profiles` |
| P2-EXP-04 | 从导出恢复后 Gateway 正常、对话可访问        | 人工恢复演练                            |

### 4.4 Conversation 归档

| ID         | 检查项                                          | 验证                       |
| ---------- | ----------------------------------------------- | -------------------------- |
| P2-CONV-01 | Runtime 仍在 `~/.openbot/agents/<id>/sessions/` | 未整体搬迁 runtime         |
| P2-CONV-02 | 归档写入 `agents/<id>/conversations/archive/`   | 关闭会话或触发归档后有文件 |
| P2-CONV-03 | 迁移/导出后用户不感知「失忆」                   | 对比归档前后 UI 历史列表   |

### 4.5 Memory / Access（基础版）

| ID          | 检查项                               | 验证                                 |
| ----------- | ------------------------------------ | ------------------------------------ |
| P2-MEM-01   | 支持「忘记此条记忆」最小路径         | UI 或 API 之一 + 测试                |
| P2-MEM-02   | 删除 Agent 时 memory 处置三选一      | 对话框文案与行为符合 Data Space §4.2 |
| P2-GRANT-01 | `access-grants.jsonl` 或等价授权记录 | 授权后有记录、可撤销                 |

### 4.6 Phase 2 测试门禁

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/data-migration*.test.ts \
  src/gateway/server-methods/data-export*.test.ts
# Kiro 须补充实际测试路径
pnpm test  # 或 scoped 列表由 Kiro PR 提供
```

---

## 5. Phase 3 验收（企业与存储策略）

**Kiro 交付物声明模板**：`Phase 3 — Enterprise Data Policy`

| ID         | 检查项                                                       | 验证                |
| ---------- | ------------------------------------------------------------ | ------------------- |
| P3-ENT-01  | 企业端可配置保留/删除/备份策略                               | 企业管理员 UI + API |
| P3-ENT-02  | SaaS 路径 `tenants/<t>/users/<u>/OpenBot` 与 `tenant/shared` | 路径测试 + 隔离测试 |
| P3-ENT-03  | 共享 Agent 使用 `tenant/shared/agents/<id>/`                 | 文档 + 集成测试     |
| P3-CODE-01 | `resolveDataSpacePaths` 替代旧 workspace 散落逻辑            | 代码审查 + 回归测试 |
| P3-BAK-01  | NAS/Cloud **备份**任务，非 Primary 推荐                      | UI 文案审查         |

---

## 6. Kiro 提交要求（验收前置）

每个 Phase PR / 交付须包含：

1. **Phase 标签**：`Phase 1` / `2` / `3`（标题或 PR 正文首行）
2. **变更文件列表** + `Agent: <kiro-id>` / `Task: data-directory` trailer
3. **验收证据**：
   - 通过的 vitest 命令与输出摘要
   - SaaS 或本机人工步骤结果（Phase 1 至少 SaaS）
   - 若改 Gateway：`workspaces` / `data.*` 相关测试
4. **已知未做项**：明确不在本 Phase 的范围，避免验收范围争议
5. **部署说明**（若动 UI）：`pnpm ui:build` + 是否需重启 gateway

缺少 1–3 任一项 → **暂不验收**，退回补充。

---

## 7. 驳回与复验流程

```text
Kiro 交付 → Cursor 按 §3/4/5 验收
    ├─ 通过 → 勾选签署表 + 回复合并/部署许可
    └─ 驳回 → 出具「验收驳回单」（模板 §8）
              → Kiro 修复 → 标注「复验 R1」→ 只重测失败项 + 红线
```

**驳回单必填**：违反的 ID（如 P1-UI-02）、复现步骤、期望行为、规格章节链接。

---

## 8. 验收驳回单模板

```markdown
## 数据目录验收驳回 — Phase N — R<round>

**交付**：PR #**_ / commit _** / Kiro agent \_\_\_

### 违反项

- [ ] P\_-\_\_\_ : <简述>
- [ ] Q\_ : <架构红线>

### 复现

1. ...
2. ...

### 期望（规格引用）

- docs/design/openbot-data-directory-product-spec-2026-07-10.md §\_\_\_
- docs/design/openbot-data-space-model-v1-2026-07-10.md §\_\_\_

### 复验范围

仅重测：P\_-\_\_\_, ...
```

---

## 9. Cursor 验收人备忘

| 动作                   | 说明                                                       |
| ---------------------- | ---------------------------------------------------------- |
| 不代写 Kiro 范围外功能 | 验收只判是否符合规格，不顺手补实现                         |
| 部署后验 SaaS          | Phase 1 UI 变更须在 openbot.love 强刷复验                  |
| 安全项必查             | 任何 bundle 含 credentials → 一律驳回                      |
| 文档先行               | Kiro 若改架构须先升规格版本，否则按旧规格驳回              |
| 登记结果               | 通过后在本文档 §3.6 / §4 签署表填日期；或建 issue 评论链接 |

---

## 10. 文档修订记录

| 版本 | 日期       | 说明                                             |
| ---- | ---------- | ------------------------------------------------ |
| v1.0 | 2026-07-10 | 初版：Kiro 实施 / Cursor 验收分工与分 Phase 清单 |
