# Development Supervisor（IDE CLI / Node Agent）第三方验收说明

> **文档版本**：2026-06-18  
> **适用代码基线**：OpenBot 仓库 `main` 工作树（含 M0–M4 已验收项 + **M5 Node Agent / 三端 UX** 增量）  
> **权威设计来源**：`.kiro/specs/development-supervisor/design.md`、`.kiro/specs/development-supervisor/tasks.md`、`.kiro/specs/development-supervisor/requirements.md`

---

## 1. 验收目标（给第三方团队的一句话）

验证 OpenBot 已实现 **「监督 AI 的开发任务」** 完整链路：在 feature gate 开启的前提下，平台/企业/员工三端 UI 可配置与观测；Gateway 监督引擎可创建任务并驱动 Worker；**IDE 登录型 CLI（cursor-cli / devin-cli 等）经 `local_ide_login + node_agent` 路径在员工 Mac 上执行**；进度与审计可回传到 Web UI。

**不在本次必验范围（明确排除）**：

- `seat_personal` 凭证策略（P3，store 层主动 reject）
- 外部消息渠道（Telegram 等）作为 Reporter 投递面（M4 增强项）
- `enterprise_shared + node_agent`（VDI 未来拓扑）

---

## 2. 产品与设计依据（验收时必须对照）

| 编号       | 设计决策                                                                       | 验收要点                                                   | 设计文档锚点                 |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------- |
| D-EXECCTX  | `ExecutionContext` 为唯一运行输入；Engine **不得**按 credential/placement 分支 | 代码审查：`engine.ts` 只消费已解析的 context               | design.md § ExecutionContext |
| D-RESOLVER | 凭证/落点由 Resolver 纯函数/Port 解析                                          | `execution-context.ts`、`worker-profiles.ts`、policy store | design.md § Resolver         |
| R9         | Feature gate 默认 **OFF**，OFF 时零回归                                        | 未开启时 API 返回 `UNAVAILABLE`；既有 cli-backend 直聊不变 | design.md R9、tasks.md       |
| R10        | 统一 Worker 抽象 + cli-backend `worker` 元数据                                 | `src/fabric/worker/**`、`cli-backend-worker.ts`            | design.md R10                |
| R11        | 实时监督（streaming 降级）                                                     | WS `supervisor.task.event`；Node progress 转发             | design.md R11                |
| M5         | Node Agent 执行 + local IDE auth probe + fallback=escalate                     | 见 §5、§6                                                  | design.md Rollout M5         |

**Worker 默认拓扑（未配置租户 policy 时）** — `src/gateway/supervisor/worker-profiles.ts`：

| Worker ID                                             | credentialPolicy    | executionPlacement |
| ----------------------------------------------------- | ------------------- | ------------------ |
| `cursor-cli`, `devin-cli`, `windsurf-cli`, `grok-cli` | `local_ide_login`   | `node_agent`       |
| 其他（如 `codex-cli`, `kiro-cli`）                    | `enterprise_shared` | `gateway`          |

---

## 3. 交付范围清单（按层次）

### 3.1 Gateway 运行时（M0–M3 + M0.5 + M5）

| 模块                     | 路径                                                | 验收关注点                                                 |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| Fabric Worker Runtime    | `src/fabric/worker/**`                              | Worker 接口、CliWorkerAdapter、能力轴                      |
| 监督引擎                 | `src/gateway/supervisor/engine.ts`                  | 状态机、judge、有界重试                                    |
| ExecutionContext         | `src/gateway/supervisor/execution-context.ts`       | identity + placement 正交解析                              |
| Gateway Worker 执行器    | `src/gateway/supervisor/worker-executor.ts`         | `GatewayWorkerExecutor`                                    |
| **Node Agent 执行器**    | 同上                                                | `NodeAgentWorkerExecutor`                                  |
| Node 席位绑定 Store      | `src/gateway/supervisor/node-seat-binding-store.ts` | 持久化 `~/.openbot/openbot-node-seat-bindings.json`        |
| 租户 Worker Policy Store | `src/gateway/supervisor/worker-policy-store.ts`     | 持久化 `~/.openbot/openbot-worker-execution-policies.json` |
| Worker 健康探测          | `src/gateway/supervisor/worker-auth-probe.ts`       | gateway probe + node probe                                 |
| Node progress 转发       | `src/gateway/supervisor/node-progress.ts`           | Mac → gateway → WS                                         |
| Gateway API              | `src/gateway/server-methods/supervisor.ts`          | 见 §4                                                      |
| Feature gate             | `src/gateway/supervisor/feature.ts`                 | `OPENBOT_SUPERVISOR_ENABLED` / config                      |
| Node 命令契约            | `src/infra/node-commands.ts`                        | dispatch/probe/cancel/progress 事件名                      |

### 3.2 Mac Node Agent（M5）

| 模块             | 路径                                                             | 验收关注点             |
| ---------------- | ---------------------------------------------------------------- | ---------------------- |
| Worker 命令处理  | `apps/macos/Sources/OpenBot/NodeMode/MacNodeRuntime.swift`       | probe/dispatch/cancel  |
| CLI 映射与执行   | `apps/macos/.../MacSupervisorWorkerRunner.swift`                 | cursor/devin 等 spawn  |
| stream-json 解析 | `apps/macos/.../MacSupervisorStreamJsonParser.swift`             | 结构化 progress        |
| 席位绑定         | `apps/macos/.../MacSupervisorNodeBinder.swift`                   | `supervisor.node.bind` |
| 设置 UI          | `apps/macos/.../SupervisorNodeBindSettingsSection.swift`         | Tenant/Seat/Bind       |
| 命令 advertise   | `apps/macos/.../MacNodeModeCoordinator.swift`                    | 三命令注册             |
| 单测             | `apps/macos/Tests/OpenClawIPCTests/MacNodeRuntimeTests.swift` 等 | mock shell 路径        |

### 3.3 Web UI — 三端（M4.1 + M5 UX）

| 端       | 入口                                              | 关键文件                                                 |
| -------- | ------------------------------------------------- | -------------------------------------------------------- |
| **平台** | 平台 → Advanced → `#platform-advanced:supervisor` | `ui/src/ui/ports/platform/advanced/supervisor-panel.ts`  |
|          | 子面板：Node 绑定总览                             | `ui/src/ui/supervisor/supervisor-node-registry-panel.ts` |
|          | 子面板：Worker 策略                               | `ui/src/ui/supervisor/supervisor-worker-policy-panel.ts` |
|          | 任务看板                                          | `ui/src/ui/supervisor/supervisor-task-board.ts`          |
| **企业** | 设置 → 策略与治理 → 开发监督                      | `enterprise-access-control-surface.ts`（governance 段）  |
|          | 组织架构 → 岗位详情 → 开发监督 Node               | `enterprise-org-position-detail.ts`                      |
|          | 席位绑定组件                                      | `ui/src/ui/supervisor/supervisor-seat-node-panel.ts`     |
| **员工** | Workbench → 设置 → 开发监督任务                   | `employee-supervisor-center.ts`                          |

**RBAC（UI 层，验收必查）** — `ui/src/ui/supervisor/supervisor-types.ts`：

| 能力                                  | 条件                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| 创建/中止监督任务                     | Gateway scope：`operator.write` 或 `operator.admin`（`canCreateSupervisorTask`）         |
| 编辑企业 Worker 策略 / 解除 Node 绑定 | 企业端口：`membershipRole === "enterprise-admin"`（`canEditEnterpriseSupervisorPolicy`） |
| 企业 operator / member                | 策略与绑定 **只读**（无编辑/解除按钮，有只读提示条）                                     |
| 员工 Node 绑定                        | Mac 本地设置自助 Bind；Web 员工端只读就绪清单                                            |

---

## 4. Gateway API 验收矩阵

> 方法注册：`src/gateway/server-methods-list.ts`  
> Scope 划分：`src/gateway/method-scopes.ts`

### 4.1 必读 Scope

| Scope 类 | 代表方法                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| READ     | `supervisor.task.get/list/subscribe/audit`, `supervisor.worker.list/health`, `supervisor.worker.policy.list`, `supervisor.node.list`, `supervisor.node.bindings.list`, `supervisor.template.list`, `supervisor.runner.status` |
| WRITE    | `supervisor.task.create/abort`, `supervisor.worker.policy.upsert/remove`, `supervisor.node.bind/unbind`                                                                                                                       |

### 4.2 关键 API 行为

| 方法                              | 必验行为                                                                   |
| --------------------------------- | -------------------------------------------------------------------------- |
| `supervisor.task.create`          | 需 goal、repoRoot、workerBackendId；repoRoot 必须含 `.git`；返回 task 快照 |
| `supervisor.worker.health`        | 支持 `tenantId`、`seatId`；local_ide worker 应反映 node 绑定与 probe 结果  |
| `supervisor.node.bind`            | 需 tenantId + seatId + nodeId；写入 binding store                          |
| `supervisor.node.list`            | 返回在线 Node；`supportsSupervisorWorker` 取决于是否 declare 三命令        |
| `supervisor.worker.policy.upsert` | `seat_personal` 必须 **400/reject**                                        |
| `supervisor.task.subscribe` + WS  | 客户端收到 `supervisor.task.event`（含 progress）                          |

**Feature gate 关闭时**：上述 supervisor 方法应返回 `UNAVAILABLE`（或等价错误），且不影响非 supervisor 路径。

---

## 5. 端到端验收场景（建议按序执行）

### 场景 A — 环境就绪（阻塞项）

| 步骤 | 操作                                                                      | 通过标准                                                            |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A1   | 设置 `OPENBOT_SUPERVISOR_ENABLED=1` 或 `gateway.supervisor.enabled: true` | —                                                                   |
| A2   | 重启 Gateway                                                              | `supervisor.runner.status` 或 `supervisor.task.list` 非 UNAVAILABLE |
| A3   | 确认至少一个 CLI backend 配置了 `worker` 元数据                           | `supervisor.worker.list` 非空                                       |
| A4   | Mac OpenBot 以 **Node 模式**连接 Gateway                                  | `supervisor.node.list` 出现该 nodeId                                |
| A5   | Mac Node advertise 含三命令                                               | 列表项 `supportsSupervisorWorker: true`                             |

### 场景 B — IDE CLI 路径（M5 核心）

| 步骤 | 操作                                                                                | 通过标准                                                                   |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| B1   | 员工 Mac 安装并 **IDE 登录** cursor-cli（或 devin-cli）                             | 本机 CLI 可交互登录                                                        |
| B2   | 绑定 seat → node（三选一见 §5.1）                                                   | `supervisor.node.bindings.list` 含对应 seatId                              |
| B3   | 平台/员工端查看 `supervisor.worker.health`（worker=cursor-cli，带 tenantId+seatId） | `placement.executor=node_agent`，`placement.available=true`；auth 探测合理 |
| B4   | 创建监督任务：worker=cursor-cli，repoRoot=**Mac 本机 git 仓库绝对路径**             | 任务创建成功，state 进入 executing/validating 等活跃态                     |
| B5   | 观察任务详情「实时进度」                                                            | 出现 progress 事件（非仅 raw stderr）                                      |
| B6   | 任务结束                                                                            | 终态为 accepted / escalated / failed 等；审计可加载                        |

#### 5.1 Seat → Node 绑定三种合法入口（任一种通过即可）

1. **Mac 设置**：Settings → General → Development Supervisor → Tenant ID + Seat ID → Bind now
2. **企业 Web**：组织架构 → 岗位详情 → 开发监督 Node（需 **enterprise-admin**）
3. **平台 Web**：Advanced → 开发监督 → Node 与席位绑定（填 tenantId）
4. **API**：`supervisor.node.bind`

### 场景 C — Gateway 共享凭证路径（回归）

| 步骤 | 操作                                                             | 通过标准                                                        |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| C1   | 平台 Advanced → 协作工具 → 配置企业共享 API Key（codex/kiro 等） | credential 校验通过                                             |
| C2   | 创建 worker=codex-cli（或 kiro-cli）任务                         | 在 **Gateway 宿主机** spawn，不依赖 Node                        |
| C3   | `supervisor.worker.health`                                       | `executor=gateway`，enterprise_shared 凭证状态 valid/configured |

### 场景 D — 三端 UI 对照

| 端                     | 路径                            | 通过标准                                                |
| ---------------------- | ------------------------------- | ------------------------------------------------------- |
| 平台                   | `#platform-advanced:supervisor` | 见 Node 列表、绑定表、策略表、创建任务表单、Runner 状态 |
| 企业 admin             | 设置 → 策略与治理               | 开发监督段可 **编辑** 策略、**解除** 绑定               |
| 企业 operator          | 同上                            | **只读**提示 + 表格 + 刷新；无编辑/解除                 |
| 企业 admin             | 组织架构 → 岗位详情             | 可绑定 Node                                             |
| 企业 operator          | 岗位详情                        | 就绪清单只读，无绑定按钮                                |
| 员工（有 write scope） | Workbench → 开发监督任务        | 就绪清单 + **新建任务** + 列表/进度                     |
| 员工（仅 read scope）  | 同上                            | 就绪清单 + 列表；无创建表单，有权限提示                 |

### 场景 E — 负向 / 安全

| 步骤 | 操作                                                   | 通过标准                                                        |
| ---- | ------------------------------------------------------ | --------------------------------------------------------------- |
| E1   | 未绑定 seat 时创建 cursor-cli 任务                     | 应失败或 health 明确提示 placement 不可用（不应静默走 gateway） |
| E2   | Node 离线后创建任务                                    | 合理失败/escalate，UI health 反映 offline                       |
| E3   | `supervisor.worker.policy.upsert` 使用 `seat_personal` | API 拒绝                                                        |
| E4   | Feature gate OFF                                       | UI 显示「监督子系统未启用」；API UNAVAILABLE                    |
| E5   | 企业 operator 调 policy.upsert（若客户端可发）         | Gateway 层 WRITE scope 拒绝（若 session 无 write）              |

---

## 6. 架构一致性审查（代码走查清单）

第三方团队应抽样确认以下 **MUST** 约束在代码中成立：

- [ ] **Engine 不分支 placement**：`src/gateway/supervisor/engine.ts` 不包含 `if (placement === 'node_agent')` 类业务分支（执行差异仅在 executor port）。
- [ ] **Node fallback 默认 escalate**：Node 不可用时不应静默 fallback 到 gateway 执行 local_ide worker（见 `node-agent-registry.ts` / executor wiring）。
- [ ] **Binding 解析顺序**：`tenantId + seatId` → `node-seat-binding-store` → `nodeRegistry` 在线检查。
- [ ] **Progress 链路**：Mac `supervisor.worker.progress` 事件 → `node-progress.ts` → active run registry → WS relay。
- [ ] **凭证指引分支**：`src/agents/cli-backend-credential-guidance.ts` 对 local_ide_login 提示本机 IDE 登录而非平台 Key。
- [ ] **Method scope 与 UI RBAC 一致**：企业 UI 只读 ≠ Gateway 授权；最终以 Gateway scope 为准。

---

## 7. 自动化测试（验收团队应跑通）

### 7.1 Gateway / Supervisor 单测

```bash
cd <repo-root>
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/supervisor/ \
  src/fabric/worker/ \
  src/gateway/server-methods/supervisor.test.ts
```

**重点文件（M5 相关）**：

- `worker-executor.test.ts` — NodeAgentWorkerExecutor
- `node-agent-registry.test.ts` — placement 与 binding
- `node-seat-binding-store.test.ts`
- `worker-policy-store.test.ts` — 含 seat_personal reject
- `worker-auth-probe.test.ts`
- `node-progress.test.ts`

### 7.2 Web UI 浏览器单测

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  ui/src/ui/supervisor/ \
  ui/src/ui/ports/platform/advanced/supervisor-panel.browser.test.ts \
  ui/src/ui/ports/employee/views/employee-supervisor-center.browser.test.ts
```

### 7.3 Mac 单测（可选，环境受限时可只看 Gateway 集成）

```bash
# 在 macOS 开发机；Peekaboo 相关失败可忽略若与本次改动无关
swift test --filter MacNodeRuntimeTests
swift test --filter MacSupervisorStreamJsonParserTests
```

**通过标准**：上述 vitest 套件在当前基线 **全部 green**；Mac 单测至少 supervisor 相关 case 通过。

---

## 8. 验收判定标准（Sign-off）

### 8.1 必须项（P0 — 任一失败则整体验收不通过）

1. Feature gate 行为符合 R9（OFF 零回归，ON 全链路可用）。
2. **场景 B**（IDE CLI + Node Agent）完整跑通至少一次，含 progress 回传。
3. **场景 C**（Gateway 共享凭证 Worker）回归通过。
4. **场景 D** 三端 UI 入口可访问且 RBAC 表现符合 §3.3。
5. §7.1 + §7.2 自动化测试通过。
6. §6 架构走查清单无 **MUST** 违规。

### 8.2 建议项（P1 — 记录缺陷，不阻塞主链路）

1. Mac `swift test` 全绿（受 macOS SDK / Peekaboo 环境影响）。
2. Runner 队列模式（`OPENBOT_SUPERVISOR_RUNNER_ENABLED`）与 Cron 模式均验证。
3. 多 Node / 多 seat 并发绑定边界。
4. 任务 abort 在 Node 执行中途生效。

### 8.3 已知未交付（验收时标记 N/A，勿判失败）

| 项                               | 说明                            |
| -------------------------------- | ------------------------------- |
| `seat_personal` policy           | P3 billing 阶段                 |
| Reporter 走 Telegram 等外部渠道  | M4 增强                         |
| 员工 Web 端 Node bind            | 设计为 Mac 自助；Web 仅就绪观测 |
| `enterprise_shared + node_agent` | 未来 VDI                        |

---

## 9. 验收交付物模板（请第三方团队填写）

```markdown
## 验收报告

- 验收日期：
- 代码 commit SHA：
- Gateway 版本 / 构建方式：
- 验收人：

### P0 结果

| 编号 | 场景                | 结果 PASS/FAIL | 证据（截图/日志/命令输出） |
| ---- | ------------------- | -------------- | -------------------------- |
| A    | 环境就绪            |                |                            |
| B    | IDE CLI + Node      |                |                            |
| C    | Gateway Worker 回归 |                |                            |
| D    | 三端 UI + RBAC      |                |                            |
| T    | 自动化测试          |                |                            |
| R    | 架构走查            |                |                            |

### 缺陷列表

| ID  | 严重性 | 描述 | 复现步骤 | 关联文件/接口 |
| --- | ------ | ---- | -------- | ------------- |

### 结论

[ ] 通过 [ ] 有条件通过 [ ] 不通过
```

---

## 10. 参考文档索引

| 文档                             | 路径                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| 设计说明                         | `.kiro/specs/development-supervisor/design.md`                       |
| 任务计划与 M0–M3 验收结论        | `.kiro/specs/development-supervisor/tasks.md`                        |
| 需求条目                         | `.kiro/specs/development-supervisor/requirements.md`                 |
| **第三方验收报告（2026-06-18）** | `.kiro/specs/development-supervisor/acceptance-report-2026-06-18.md` |
| 仓库协作规范                     | `AGENTS.md` / `CLAUDE.md`                                            |
| 测试总览                         | `docs/testing.md`                                                    |

---

## 11. 术语表

| 术语                   | 含义                                                           |
| ---------------------- | -------------------------------------------------------------- |
| Development Supervisor | 网关「开发监督者」子系统                                       |
| Worker 面              | cli-backend 上用于监督任务的长时执行能力（相对「模型面」直聊） |
| Node Agent             | 员工 Mac 以 Node 模式连接 Gateway 的本机代理                   |
| local_ide_login        | 凭证来自员工本机 IDE/CLI 登录，非平台 API Key                  |
| node_agent             | 执行落在 Node Agent 本机 spawn CLI                             |
| seat                   | 企业组织中的席位（seatId），与员工岗位绑定                     |
| ExecutionContext       | 单次派发不可变上下文（identity + placement + attribution）     |

---

## 12. 实机补证操作手册（有条件通过 → 完全通过）

> **当前验收状态**：见 `acceptance-report-2026-06-18.md`（Codex 第三方：**有条件通过**）。  
> 实施方在本机 Mac + Gateway live 环境完成下列命令并留档，即可升格 sign-off。

### 12.1 前置（场景 A）

```bash
export OPENBOT_SUPERVISOR_ENABLED=1
# 重启 Gateway（Mac 菜单栏 App 或 launchctl kickstart）

openclaw gateway call supervisor.runner.status --params '{}'
openclaw gateway call supervisor.node.list --params '{}'
```

Mac：**Settings → General → Development Supervisor** → 填 `tenantId` + `seatId` → **Bind now**。  
确认本机 `cursor-cli`（或 `devin-cli`）已完成 IDE 登录。

### 12.2 场景 B — IDE CLI + Node（P0 必做）

将 `TENANT`、`SEAT`、`REPO_ROOT`（Mac 本机含 `.git` 的绝对路径）替换为实际值。

```bash
# B-pre
openclaw gateway call supervisor.worker.health --params '{
  "tenantId":"TENANT",
  "seatId":"SEAT",
  "workerBackendIds":["cursor-cli"]
}'

# B-run
openclaw gateway call supervisor.task.create --params '{
  "goal":"验收探针：只读列出仓库根目录文件",
  "repoRoot":"REPO_ROOT",
  "workerBackendId":"cursor-cli",
  "tenantId":"TENANT",
  "seatId":"SEAT"
}'

# B-end（替换 TASK_ID，可多次轮询直至终态）
openclaw gateway call supervisor.task.get --params '{"taskId":"TASK_ID"}'
openclaw gateway call supervisor.task.audit --params '{"taskId":"TASK_ID"}'
```

**通过线**：health 中 `placement.executor=node_agent` 且 `placement.available=true`；任务曾进入 `executing`；UI 或 WS 出现 progress；终态合理（非 placement 失败导致的 escalate）。

**留档**：四件套 JSON + 进度截图 → 填入 `acceptance-report-2026-06-18.md` §升格条件。

### 12.3 场景 C — Gateway enterprise_shared（强烈建议）

先在 **平台 Advanced → 协作工具** 为 `codex-cli` / `kiro-cli` 配置企业共享 API Key。  
`REPO_ROOT` 为 **Gateway 宿主机** 可访问的 git 路径。

```bash
openclaw gateway call supervisor.worker.health --params '{
  "workerBackendIds":["codex-cli"]
}'

openclaw gateway call supervisor.task.create --params '{
  "goal":"验收探针：echo hello",
  "repoRoot":"REPO_ROOT",
  "workerBackendId":"codex-cli",
  "tenantId":"TENANT"
}'
```

**通过线**：health 显示 `executor=gateway`；执行不经过 Node；终态合理。

### 12.4 场景 B 失败排查

| 现象                     | 检查                                                 |
| ------------------------ | ---------------------------------------------------- |
| health `available=false` | `supervisor.node.bindings.list`；Mac Bind 是否成功   |
| create 后立刻 escalated  | health JSON + Gateway 日志；Node 是否 declare 三命令 |
| 无 progress              | `node-progress.ts` 路径；Mac Node 日志；WS 订阅      |
| repoRoot 错误            | 必须是 **Node 本机** 绝对路径且含 `.git`             |

### 12.5 补证完成后

1. 更新 `acceptance-report-2026-06-18.md`：勾选 §升格条件、改结论为 **完全通过**、填修订记录。
2. 更新 `tasks.md` §M5 验收结论为 **完全通过**（附报告链接）。

---

_本文档由实施方根据 design.md / tasks.md 与当前代码结构整理，供第三方独立验收使用。若代码与设计冲突，以 **design.md 冻结决策** 为准提起缺陷；若 design 明确标注「未来/P3」，勿作为本次 P0 失败依据。_
