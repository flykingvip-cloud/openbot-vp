# Development Supervisor 验收报告

> 对照文档：`.kiro/specs/development-supervisor/acceptance-guide.zh-CN.md`

## 元信息

| 字段     | 值                                                                                    |
| -------- | ------------------------------------------------------------------------------------- |
| 验收日期 | 2026-06-18                                                                            |
| 验收范围 | development-supervisor（M0–M4 + **M5 Node Agent / 三端 UX**）                         |
| 代码基线 | `ed6ae4072f4fb1285c00f22239248e23be6e597e`（验收当日工作树 HEAD，实施方补证时可更新） |
| 验收人   | Codex（第三方代码/测试口径）                                                          |
| 结论     | **有条件通过** → 待场景 B/C 实机补证后升格为 **完全通过**                             |

---

## P0 结果

| 编号 | 场景                | 结果                      | 证据摘要                                                                                                                   |
| ---- | ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A    | 环境就绪            | **PASS**（代码/测试口径） | Feature gate 默认 off；API 在 gate off 时 UNAVAILABLE — `feature.ts`、`supervisor.ts:197`                                  |
| B    | IDE CLI + Node      | **未现场验证**            | 当前环境无 Mac Node Agent + 已登录 cursor-cli/devin-cli + seat→node 实机链路                                               |
| C    | Gateway Worker 回归 | **未现场验证**            | 当前环境未实际跑 enterprise_shared gateway worker                                                                          |
| D    | 三端 UI + RBAC      | **PASS**（代码/测试口径） | browser tests 全绿；`canCreateSupervisorTask` / `canEditEnterpriseSupervisorPolicy` 与说明一致 — `supervisor-types.ts:230` |
| T    | 自动化测试          | **PASS**                  | 见 §自动化测试                                                                                                             |
| R    | 架构走查            | **PASS**                  | 见 §架构走查                                                                                                               |

---

## 架构走查（R — PASS）

| 检查项                                                                   | 结论 | 代码锚点                                                                              |
| ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------- |
| Feature gate 默认 off，API UNAVAILABLE                                   | 符合 | `src/gateway/supervisor/feature.ts:1`；`src/gateway/server-methods/supervisor.ts:197` |
| ExecutionContext 由 resolver 解析；engine 不按 placement/credential 分支 | 符合 | `execution-context.ts:104`；`engine.ts:325`                                           |
| Node 不可用 → escalate，非静默 fallback gateway                          | 符合 | `engine.ts:327`；`worker-executor.ts:255`                                             |
| `seat_personal` policy 显式拒绝                                          | 符合 | `worker-policy-store.ts:90`                                                           |
| Node progress → active run → WS                                          | 符合 | `node-progress.ts:15`；`server.impl.ts:811` 附近                                      |

---

## 自动化测试（T — PASS）

### Gateway / Fabric

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/supervisor/ \
  src/fabric/worker/ \
  src/gateway/server-methods/supervisor.test.ts
```

**结果**：21 文件，120 测试，全部通过。

### Web UI

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  ui/src/ui/supervisor/ \
  ui/src/ui/ports/platform/advanced/supervisor-panel.browser.test.ts \
  ui/src/ui/ports/employee/views/employee-supervisor-center.browser.test.ts
```

**结果**：7 文件，17 测试，全部通过。

---

## 缺陷列表

| ID  | 严重性 | 描述                        | 状态 |
| --- | ------ | --------------------------- | ---- |
| —   | —      | 代码/测试口径未发现阻塞缺陷 | —    |

---

## 升格条件（待实施方补证）

完成下列项后，将结论改为 **完全通过**：

- [ ] **场景 B**：至少 1 次完整实机链路（见 `acceptance-guide.zh-CN.md` §12 或下方清单）
- [ ] **场景 C**（强烈建议）：同环境 enterprise_shared gateway worker 1 次
- [ ] （可选）场景 D 三端 RBAC 现场截图各 1 张

### 场景 B 留档四件套（实施方填写）

| 项                                                               | 状态 | 附件/路径    |
| ---------------------------------------------------------------- | ---- | ------------ |
| B-pre：`supervisor.worker.health` JSON（node_agent + available） | ☐    | _粘贴或链接_ |
| B-run：`supervisor.task.create` 响应（含 taskId）                | ☐    | _粘贴或链接_ |
| B-live：UI 进度截图或 WS 事件片段                                | ☐    | _粘贴或链接_ |
| B-end：`supervisor.task.get` 终态                                | ☐    | _粘贴或链接_ |

### 场景 C 留档（实施方填写）

| 项                                    | 状态 | 附件/路径    |
| ------------------------------------- | ---- | ------------ |
| C-pre：gateway worker health JSON     | ☐    | _粘贴或链接_ |
| C-run：task.create + 终态             | ☐    | _粘贴或链接_ |
| C-evidence：Gateway 侧 spawn 日志片段 | ☐    | _粘贴或链接_ |

---

## 结论

- [ ] 完全通过
- [x] **有条件通过**
- [ ] 不通过

**说明**：代码实现、架构约束与自动化测试均符合验收说明；P0 场景 B/C 缺少 live 环境端到端证据。补证完成后勾选「完全通过」并更新本文件 §升格条件。

---

## 修订记录

| 日期       | 变更                               | 签署            |
| ---------- | ---------------------------------- | --------------- |
| 2026-06-18 | 初版：Codex 第三方验收，有条件通过 | Codex           |
| _待定_     | 场景 B/C 补证后升格完全通过        | _实施方/复检人_ |
