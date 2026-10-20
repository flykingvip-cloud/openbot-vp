# 术语与不可等同（Phase A）

> 冻结三条 ADR。不发明新对象，不授权重命名。
> 上级：`docs/design/openbot-constitutional-gap-and-feasibility-2026-09-23.md` §2.2、§8.2、附录 A。
> 事实源：PR #1249 差距评估；锚点在当前 `main` 复核（见 `authority-evidence-baselines.md` 的 Phase A 草案 Manifest）。

产品定位是企业 Agent OS。下面的词是治理透镜里的对照，不是代码里已经存在的类型名。

## ADR-1 — Workflow ≠ Path

**状态：** 冻结（Phase A）。真实 Path 工程当前不批准。

**决策：** Workflow 是被命名的流程空间。Path 是一次被选中、且必须落在合法轨迹上的执行。二者不得互称。OpenBot 今天没有宪法 Path 对象；现有的「流程」词也不是一份合法空间。

**依据：**

- 差距评估把 Path 标为宪法对象 `none`，路由身份 `present-ungoverned`。最近的身份是 sessionKey（`src/routing/session-key.ts`），不是授权边界。
- `SECURITY.md`（Profile A）写明 session 标识是路由控制，不是逐用户授权边界。
- 至少五套流程词并存：Lobster（`extensions/lobster/`）、Fabric 图（`src/fabric/contract.ts`）、AOR 图（`packages/aor-core/src/orchestrator.ts`）、休眠编排（`src/task-orchestration/`，`ORCHESTRATION_LIVE_INVOKE = false`）、知识资产 kind `"workflow"`。
- 编排里的 `PathKind` 随模块休眠，不能当成已经选中的合法轨迹。
- C5（Valid Path）在可行性文中为 `fail`：不存在「必须被选中才能执行」的 Path。

**后果：**

- 设计从「Path 缺失」出发。禁止把 `ExecutionPlan`、Lobster 流程或 sessionKey 标成 Path。
- `path=unset` 只是缺口报告，不是热路径收紧的成功门。P8a/P8b/P8c 与 Gate 收紧当前不批准。
- 把五套流程收成「合法轨迹空间」会把未治理轨迹涂装成合法图。

**本 ADR 禁止的等同：**

| 禁止                                                                         | 它实际是什么               |
| ---------------------------------------------------------------------------- | -------------------------- |
| sessionKey = Path                                                            | 路由身份                   |
| Lobster / AOR 图 / Fabric 图 / 休眠编排 / 知识 kind `"workflow"` = Path 空间 | 互不相同的流程词           |
| `PathKind`（休眠）= 已选中的合法轨迹                                         | 类型存在，执行面默认不生效 |
| `src/infra/execution-chain-provenance.ts` = Path                             | 已发生链的审计，不是授权   |

## ADR-2 — receipt ≠ proof

**状态：** 冻结（Phase A）。不得把回执升格为证明。

**决策：** 回执记录「某事件被写入或某步骤被宣称已应用」。证明要求独立核验效果成立。演进域已经把二者分开；其他域的回执不得借用这套证明语义。

**依据：**

- `packages/evolution-core/src/lineage.ts` 的 `ledgerEventIsReceiptNotProof`：`application.applied`、`application.rolled_back`、`rollback_drill.completed`、`observation.excluded`、`external_effect.recorded` 等为 receipt-only。`verification.completed` 不是 receipt-only。
- 同文件 `EvolutionEffectProof = none | linked-only | verified`。`projectEvolutionLineage` 对每步标 `receiptOnly`。
- 技能交付另有 `issueValidationReceipt`（`src/agents/execution-preflight/validation.ts`）。那是校验器回执，不是演进 effect proof，也不是发布祖先证明。
- 预检 trace（`src/agents/execution-preflight/trace.ts`）活在请求内。发布证明是 `provenance/sha-*` 与 forward-only 祖先关系，schema 与前两者不同。
- 模型完成语气不是状态转移，更不是证明（C12 在普通回合上为 partial）。

**后果：**

- 符合性材料不得把 receipt 字段标成 proof。
- 交付门 ≠ 发布门。forward-only 部署检查不能代替技能校验回执。
- 普通聊天没有对等证据对象。禁止用演进 proof 外推成全产品证据层。
- Phase B v1 的影子报告也不是证明，且不写生产 ledger（见切片文）。

**本 ADR 禁止的等同：**

| 禁止                               | 说明                     |
| ---------------------------------- | ------------------------ |
| validation receipt = effect proof  | 交付回执 ≠ 演进证明      |
| 工具返回 / 预检 trace = 可回放证明 | 请求内记录               |
| 模型文本「已完成」= 证明或状态转移 | 完成权按域，不由模型宣布 |
| 发布 provenance = 技能交付证据     | 两套门                   |

## ADR-3 — plugin installed ≠ capability authorized

**状态：** 冻结（Phase A）。不合并登记簿。

**决策：** 插件安装或启用表示它进入该 Gateway 的受信计算基座。能力授权是另一次可审计决定（工具策略、企业 grant、技能契约、人工门）。安装不得显示成已授权可执行。

**依据：**

- `SECURITY.md` Trusted Plugin：安装或启用插件即与本机代码同级信任。这是信任基座，不是能力目录。
- 能力至少分账：工具 allowlist（`src/agents/tool-policy.ts`）、企业能力治理（`src/gateway/capability-governance-store.ts`）、技能生命周期（`src/gateway/skill-lifecycle-store.ts`）、AOR `CapabilityRegistry`、休眠编排的 `ExecutionSurface`（只是路由枚举）。
- 插件注册走 `src/plugins/registry.ts` 的 `registerTool` 与 `src/plugins/loader.ts`。组件成熟度在差距评估里是 `present-ungoverned`：可加载，不是可递归治理的 Node。
- 差距评估风险 7：唯一 Registry 大合并会让「已安装插件」看起来像「已授权能力」。

**后果：**

- 禁止把插件表、设备表、技能表、企业资产表、Loom 开发任务登记并成一本账。
- Profile B 另写：插件不得获得对全部租户数据的无限制进程内访问（`SECURITY.md`）。这不改变 Profile A 的受信插件基座，两套合同保持互斥。
- 「已配对 / 已注册 / 已安装」都不是「已授权可执行」。

**本 ADR 禁止的等同：**

| 禁止                                   | 说明                            |
| -------------------------------------- | ------------------------------- |
| 插件已安装 = 能力已授权                | 受信基座 ≠ grant                |
| 插件 = 可递归治理 Node                 | Component ≠ Node                |
| `ExecutionSurface` 枚举 = 能力授权目录 | 编排路由词，且 live invoke 关闭 |
| 企业能力包种子 = 全部工具的唯一目录    | 热路径工具另有策略过滤          |

## 禁用别名总表

摘自可行性文附录 A。新文档不得发明同义词来绕开。

| 禁止等同                                                     | 说明                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Agent ≠ 唯一 Node                                            | Agent 是实现候选，不是上位类型                                  |
| 设备 Node ≠ Fabric `RuntimeNode`                             | `src/gateway/node-registry.ts` 的配对设备 ≠ 图节点              |
| AOR SDK「node」≠ 宪法 Node                                   | 客户端包名                                                      |
| CogniWeave `NodeType` ≠ 执行 Node                            | 记忆图本体                                                      |
| sessionKey ≠ Path                                            | 见 ADR-1                                                        |
| 五套流程词 ≠ Path 空间                                       | 见 ADR-1                                                        |
| evolution Decision ≠ Fabric `PolicyDecision` ≠ 协作 Decision | 互不兼容                                                        |
| 发布门 ≠ 交付门                                              | 见 ADR-2                                                        |
| `src/runtime.ts` ≠ 宪法 Runtime                              | CLI log/exit 包装                                               |
| 插件已安装 ≠ 能力已授权                                      | 见 ADR-3                                                        |
| 回执 ≠ 证明                                                  | 见 ADR-2                                                        |
| 「Fabric = 治理内核」≠ 默认部署                              | `src/fabric/feature.ts` 默认关；`src/agents/` 不调用 `decide()` |
| 「Pi 热路径无治理 / 裸执行」≠ 事实                           | `attempt.ts` 有预检与工具策略包络                               |
| 「跨域单一写权威」≠ C11 目标                                 | 已纠正。正确目标见权威文                                        |
| 产品合同 / main / 生产 seq ≠ 同一状态                        | 三基线分列                                                      |
| 评审 SHA / seq 96 / seq 97 ≠ 六周常量                        | 只是某次 assessedAt 的快照                                      |

## 本文件不做

不新增宪法类型名，不改 `PROTOCOL_VERSION`，不重命名 Agent / Node / sessionKey，不打开 Fabric，不把 Workflow 收成 Path。
