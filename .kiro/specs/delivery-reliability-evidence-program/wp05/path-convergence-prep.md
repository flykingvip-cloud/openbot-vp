# WP-05 Fabric 单一路径试点 — 预备（PREP）

- 状态：**PREP**（依赖 WP-04 设计；**不实现切换**；**不宣称 G3-B**）
- 日期：2026-10-24（Asia/Shanghai）
- HEAD（撰写时）：`2df36a55748f891d6eb05ad067318bc8783fd794`
- 作者：grokbot-verifiable-delivery
- 约束：无 dual-exec；compare-before-migrate；外部业务写等待 WP-07；不夺取 Fabric execute 所有权。

## 1. 本轮明确不做

- 不实现 legacy↔Fabric 切换开关。
- 不宣称 G3-B / ACCEPTED。
- 不把 loopback `POST /tools/invoke` 再包一层 Fabric 造成递归双路径。
- 不对 outbound / payment / 订单类工具做首迁。

## 2. 首个单路径试点 — 只读工具候选（来自代码）

优先：无外部业务写、已有只读适配或强只读语义。

| 候选 ID | 工具 / surface | 代码锚点 | 外部业务写？ | 试点优先级 | 备注 |
| --- | --- | --- | --- | --- | --- |
| P1 | `memory_search`（orch readonly） | `invokeReadonlySurface` memory 分支（`readonly-invoke.ts` L145–164）；`createMemorySearchTool` | 无业务外写（检索）；**UNKNOWN**：是否触达可写记忆索引副作用 | 高 | orch 已声明不写 Progress Ledger |
| P2 | `web_fetch` / `web_search`（`web_read`） | 同文件 L166–194 | 只读 HTTP；**非** outbound message | 高 | 依赖网络策略；比较时注意 SSRF 既有边界 |
| P3 | `skill_snapshot`（skill surface） | `resolveCronSkillsSnapshot`（L196–207） | 读快照；无远端写 | 中 | 非典型「工具执行」，适合策略绑定演练 |
| P4 | HTTP `memory_get` / `memory_search` | `tools-invoke-http.ts` `MEMORY_TOOL_NAMES` | 同 P1 | 中 | 入口已鉴权假设不可推广（Fabric probes 警告） |
| 排除 | `exec` / shell 类 | Fabric `EXEC_CLASS`（`probes.ts`） | 可改机器状态 | 否（首迁） | 可留在 WP-04 比较实验室，不进 WP-05 收敛 |
| 排除 | `outbound_message` / `external_write` / `broadcast` | `ExecutionSurface`（`types.ts`） | 是 | 否 | 等 WP-07 |
| 排除 | `browser` / `node_exec` | orch flags 默认 off | 高风险副作用 | 否 | |
| 排除 | `sessions_spawn` | `spawn-table.ts` | 递归/子代理 | 否 | |

**建议首迁故事：** 在 **服务端** 对「已选 surface=memory|web_read」的只读动作，请求开始时绑定 `path=legacy|fabric` + `actionId` + `policyVersion`，全程单路径；Fabric 路径仍调用原工具强制边界（现有 tool execute），**禁止** Fabric→loopback→再 Fabric。

## 3. 服务端范围规则草图（设计 only）

```
onRequestStart(req):
  scope = match(tenant, entrypoint, toolName, featureFlags)  # 服务端权威，忽略客户端 path 声明
  if scope.pilot && tool in READONLY_PILOT_SET:
    path = scope.forcedPath  # "legacy" | "fabric" 二选一，永不 both
  else:
    path = "legacy"
  bind ActionBinding{
    actionId,           # 逻辑动作 id（对齐 WP-01）
    policyVersion,      # 策略/规则版本；缺则 incomparable
    path,
    toolName,
    tenantId,
    correlationId
  }
  persist binding (复用既有请求/审计存储增量；禁止第二执行账本)
  forbid: re-enter Fabric from loopback invoker for same actionId
  forbid: dual-exec / shadow-exec of same actionId
```

不变量：

1. **单路径：** 同一 `actionId` 只执行一次业务工具调用。
2. **无 loopback 再入：** `createLoopbackToolInvoker`（`loopback-invoker.ts`）若用于 Fabric execute，不得对已标 `path=fabric` 的同一 action 再次路由回 Fabric 控制面。
3. **权限撤销：** 走既有决定失效/重编译；不在试点层发明第二审批缓存。
4. **比较与执行分离：** WP-04 影子比较可异步/事后；不得在执行热路径双跑。

## 4. 剩余入口清单（keep / migrate / out-of-scope）

诚实未知保留 UNKNOWN。

| 入口 | 建议 | 理由 |
| --- | --- | --- |
| `orchestration_plane` readonly（memory/web_read/skill） | **migrate-candidate（第一刀）** | 已有只读 invoke；live invoke 冻结 |
| `fabric_control_plane` | keep（实验室） | 已是 Fabric；用于比较而非「迁移」 |
| `http_tools_invoke` memory_* | migrate-candidate（第二刀） | 需证明与 orch 路径不双执行 |
| `interactive_chat` 全工具表 | keep（暂） | 面过大；UNKNOWN 耦合 |
| `cron` | UNKNOWN | 未完成策略绑定盘点 |
| `subagent` | keep / out-of-scope 初轮 | spawn 深度与递归风险 |
| `node_host` / `browser` | out-of-scope 初轮 | flag 默认 off + 副作用 |
| `core_channels` / `extension_channels` 外发 | out-of-scope → WP-07 | 外部写 |
| `collab_group` | keep | 交接/责任链优先 WP-02 |
| `constitutional_shadow` | out-of-scope | 不选路径 |
| `org_bus_steward` | UNKNOWN | E0 已标 partial |

## 5. 与 WP-04 / WP-07 依赖

- **WP-04：** 无解释的 `safety_relaxation` 未清前，不切流量。
- **WP-07：** 任何 `idempotent_write` / `reconcilable_write` 工具不得进入本预备试点。
- **ORCHESTRATION_LIVE_INVOKE：** 保持 `false`（`types.ts` L22）；本预备不借编排 live 路径完成 Fabric 收敛。

## 6. 状态声明

- 状态：**PREP**。
- 无切换实现；无 G3-B；无集成测试宣称。
- 下一步：WP-04 比较证据包 → 人指定 P1/P2 试点租户 → 精确文件接管表 → 最小开关（另轮）。
