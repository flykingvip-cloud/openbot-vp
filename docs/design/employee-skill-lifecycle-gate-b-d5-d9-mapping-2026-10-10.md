# 员工技能生命周期：闸门 B 材料（D5 / D9 映射）

> **文档状态：闸门 B 草案 / 待独立验收勾选 / 未实施产品改动**
>
> 日期：2026-10-10
> 系统边界：**D0=A 已冻结**（产品负责人，2026-10-10）。对象是私有仓 `https://github.com/upbeyond/openbot` 的 gateway：员工技能资产、`employee-install`、执行投影、runtime binding。
> 本文是闸门 B 的映射说明。它把 D5 四层**目标语义**指到现有符号，并给出 D9 的推荐默认，供独立验收决定能否冻结。
> **本文件的勾选不等于批准实施。** 闸门 A 尚未完全通过（生产部署版本待核实）。闸门 B 的专家勾选完成之前，禁止开分层状态的落地 PR。两道闸门都未满足时，禁止落地产品改动。
> 本文不修改 `src/`、`ui/`、`extensions/`、`skills/`，不改测试，不改配置默认值，不改提示词，不改 `docs/tools/`、`docs/cli/`、`docs/zh-CN/`。

十五分钟阅读路径：文首、§1 目标语义、§2 映射表、§3 禁止误映射、§4 D9 勾选、§5 与垂直切片五步的对应。§6 的冻结勾选在交付时保持未勾。

## 0. 本文件自洽范围

独立验收只凭本文件判断「D5 / D9 能否冻结」。下面这些事实写在本文里。

| 项 | 本文采用的值 |
| --- | --- |
| D0 | **A，已冻结。** B/C/D 不适用。公开仓 `https://github.com/CopilotKit/OpenBot` 的 `save_skill`、`skills.yaml`、Intelligence Learning 不进入本映射 |
| 分析 | 本私有仓 PR #545，「Docs: 员工端技能进化通道现状分析」，draft，未合入。分支 `cursor/employee-skill-lifecycle-analysis-05dc`。文件 `docs/design/employee-skill-lifecycle-channel-2026-10-10.md`。独立验收：**有条件通过（文档阶段）** |
| 方案 | 本私有仓 PR #546，「Docs: 员工端技能生命周期方案（D0=A 已冻结，实施仍暂缓）」，draft，未合入。分支 `cursor/employee-skill-lifecycle-opt-plan-aa8c`。文件 `docs/design/employee-skill-lifecycle-channel-optimization-plan-2026-10-10.md` 与 `docs/design/target-codebase-evidence-2026-10-10.md`。独立验收：**有条件通过（文档阶段）**。D5 / D9 在该方案 §7.2 仍是未勾选的决定 |
| 垂直切片 | 本私有仓 PR #549，「Docs: 员工技能生命周期垂直切片设计与验收勾选」，draft，未合入。分支 `cursor/employee-skill-lifecycle-vertical-slice-0747`。文件 `docs/design/employee-skill-lifecycle-vertical-slice-2026-10-10.md`。独立验收：**有条件通过（文档阶段）**。该文件规定观测笔记怎么记，不落地四层字段 |
| 闸门 A | 本私有仓 PR #550，「Docs: 闸门 A 技能路径基线差异记录（生产待核实）」，draft，未合入。文件 `docs/design/employee-skill-lifecycle-gate-a-baseline-diff-2026-10-10.md`。**部分通过**：技能路径无 diff 已记录。**完全通过仍否**：生产部署版本待核实 |
| 调查基线 | `93ce9df262b3666d83f64c559a5e7801e6bde089`（#543） |
| 符号读取时的 `origin/main` | `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`（#548）。基线是该 HEAD 的祖先。#550 记录：第 3 节技能路径在基线与该 HEAD 之间 diff 为空。本文符号在该 HEAD 上读取 | 
| 推送前复核的 `origin/main` | `156b03113c6cb45f2be56da57dccae65f4f8a5e3`（#547，Control UI: fill fullscreen computer preview）。相对 `8ce4b0fe…` 只多这一笔。对 §2 映射所用技能路径再做 `git diff 93ce9df… 156b03113c6cb45f2be56da57dccae65f4f8a5e3`，结果仍为空。行号在这些路径仍无 diff 时有效；符号名优先 |
| 生产部署版本 | **待核实。** 不得把调查基线或 `8ce4b0fe…` 写成生产版本。因此闸门 A 完全通过仍否 |
| 公开仓同号 #545 | 编号撞车。公开仓对 `employee-install`、`skill-lifecycle-store`、`runtime-binding-sync`、`install-pack-to-robot` 为 0 命中，这是预期 |

D5 正文与 D9 推荐默认沿用 #546 的修订文本，并按现有符号补上映射。本文不改写 #545 的调查结论，不勾选 #546 §7 的决定，不把 #549 的 §5.2 执行勾选补上，也不把 #550 的生产空位填上。

## 1. D5 分层状态：目标语义

以下四层是**目标语义**。它们描述将来验收和（闸门通过之后的）实施应该如何分别记录状态。

**现有 store 没有这些字段。** `RobotSkillRelation`、`skill-assets/store.json`、`employee-install.json`、`RuntimeCapabilityBinding` 都没有 `requested` / `linked` / `pending` / `ready` / `failed` / `not_required` / `synced` 这一套安装生命周期枚举。本文不声称代码已经写入它们，也不授权本轮去加字段。

层与层独立更新。任何一层的成功都不能填满其他层。

| 层 | 目标状态 | 含义 |
| --- | --- | --- |
| 安装关系 | `requested` / `linked` | 技能与机器人的关系是否已经建立。`requested` 表示本次操作已受理，关系尚未提交到 store。`linked` 表示关系已在 store 中建立 |
| 执行投影 | `pending` / `ready` / `failed` | `ob-asset-<skillId>/SKILL.md` 是否已按可执行 lifecycle 物化。`pending` 表示尚未核对或正在物化。`ready` 表示物化结果可被后续加载使用。`failed` 表示本次物化失败并带有原因 |
| 运行时绑定 | `not_required` / `pending` / `synced` / `failed` | 仅当 D9 规定该入口需要通道 B（`syncInstallToRuntime`）时，才使用 `pending` / `synced` / `failed`。不需要绑定的入口保持 `not_required` |
| 最终可用性 | `ready` / `degraded` / `failed` | 按该入口的必需条件计算。`ready`：必需条件全部满足。`degraded`：投影 `ready`，但该入口的辅助同步失败。`failed`：必需条件未满足 |

目标规则：

1. 若保留字段或文案 `installed`，它只表示关系为 `linked`（含旧 API 里已经写成 true 的历史记录的兼容读法）。它单独存在时，不得推断投影 `ready`，不得推断绑定 `synced`，不得推断可用性 `ready`。`employee-install` 的请求状态 `installed` 连「关系 `linked`」都不是，见 §3.1。
2. 通道 B 只有在 D9 把该入口标成「需要绑定」时才进入成功门槛。标成 `not_required` 的入口，绑定失败不是这个入口的失败。
3. 可用性 `ready` 还要求：该入口所声称的执行路径，能在**下一轮真实 loader 或真实执行上下文**中观察到。同一次请求里读回刚写的文件不算。
4. 工具策略仍可能在 loader 之后滤掉技能。投影可以保持 `ready`，可用性不得写成 `ready`。这是可用性计算的一部分，不是第四个投影状态。
5. 失败必须带结构化原因，并且允许对同一关系重试。
6. 失败不得破坏该机器人上原先已经有效的关系与投影。
7. 回滚只允许发生在「本次操作创建、且仍然由本次操作拥有」的关系上。本次物化失败时，可以撤掉这条新关系。不得撤掉更早存在的有效关系，也不得因为绑定失败删掉已经 `ready` 的投影。
8. 历史数据只有 `installed=true`、没有四层字段时：关系按 `linked` 解释；投影保持 `pending`，直到一次核对把它写成 `ready` 或 `failed`；绑定按 D9 对该入口的分类解释，未知时用 `pending`，不得直接写成 `synced`；可用性不得默认 `ready`。这条读法适用于机器人关系上的旧安装记录。`employee-install` 请求上的 `installed` 适用 §3.1，不升级成关系 `linked`。

### 1.1 名称碰撞：代码里的 binding 有两套

验收时必须先分开这两个名字。把它们合成一个「绑定成功」会让闸门 B 失去意义。

| 口头层 | 代码模块 | 写出的东西 | 对应 D5 的哪一层 |
| --- | --- | --- | --- |
| 通道 A，执行投影 | `src/gateway/skill-execution-binding/` | `CONFIG_DIR/skill-execution-bindings/<agentId>/ob-asset-<skillId>/SKILL.md` | **执行投影**。目录名里的 binding 不是 D5 的运行时绑定 |
| 通道 B，运行时绑定 | `syncInstallToRuntime`（`src/gateway/runtime-binding-sync.ts`）→ `upsertBinding`（`src/gateway/agent-runtime-store.ts`） | agent runtime 上的 `RuntimeCapabilityBinding` | **运行时绑定**。它不物化 `SKILL.md` |

`loadSkillExecutionBindingEntries` 在 `respectRuntimeBindingPause` 为真时，会用通道 B 里 `bindingState === "disabled"` 的记录把投影名从 loader 结果里拿掉。文件还在，下一轮条目可以没有它。可用性计算要看见这个交点；它不把投影改写成 `failed`，也不把通道 B 的 `BindingState` 换成 D5 可用性。

## 2. 与现有实现的映射

符号在 `8ce4b0fe7bfc227dbc19f42610be7e14530f837c` 上读取。#550 记录这些路径相对调查基线无 diff。推送前复核到 `156b03113c6cb45f2be56da57dccae65f4f8a5e3` 时，同一组路径 diff 仍为空，行号继续有效。下表是读模型：从现有返回值和文件推断验收笔记该写哪一层。它不是新 schema。

### 2.1 总表

| D5 层或对照项 | 路径 | 符号 | 现有数据里实际有什么 | 目标语义怎么读 |
| --- | --- | --- | --- | --- |
| 安装关系 | `src/gateway/skill-lifecycle-store.ts` | `installSkillToRobotAsset`；模块内类型 `RobotSkillRelation`（约第 307 行，**未 export**）；字段落在 `SkillAssetStore.robotRelations` | `id`、`agentId`、`skillId`、`enabled`、`installedVersion`、`lastInvokedAt`、`usageCount`、`createdAt`。没有 `requested` / `linked` | 该 `(agentId, skillId)` 已有一条关系，且本次安装把它写成 `enabled: true`：笔记记 `linked`。函数返回前尚未 `writeStore`：笔记可记 `requested`。返回类型是导出的 `RobotSkillEntry`，不是四层对象 |
| 关系变更信号 | 同上，约第 410 行；hook 在 `src/gateway/skill-execution-binding/register-hooks.ts` | `emitSkillRelationMutation`；`ensureSkillExecutionBindingHooksRegistered` | hook 异常被空 `catch`（注释 hooks must not break asset mutations）。hook 调用 `syncSkillExecutionBinding` 与 `syncExecutableAssetBinding`，**都不读**返回值。gateway 启动处：`src/gateway/server.impl.ts` 调用 `ensureSkillExecutionBindingHooksRegistered` | 关系已写入或函数已返回，投影仍是 `pending`，直到单独看到 sync 结果或下一轮 loader。禁止从 `installSkillToRobotAsset` 的返回值填投影 `ready`。MCP 侧效应见 §2.2，不进入四层 |
| 可执行 lifecycle | `src/gateway/skill-execution-binding/types.ts` | `EXECUTABLE_LIFECYCLES`；同文件 `NON_EXECUTABLE_LIFECYCLES`、`EXECUTABLE_ASSET_TYPES`、`SKILL_EXECUTION_BINDING_PREFIX` | 可执行：`private` / `reviewing` / `approved` / `published`。不可执行：`draft` / `rejected` / `retired`。类型：`capability`、`workflow`、`prompt`、`template`、`agent`、`tool`、`mcp`。`knowledge` 不在集合里。`reviewing` 可执行是该文件的显式注释 | 不在 `EXECUTABLE_LIFECYCLES` 内，或类型不在 `EXECUTABLE_ASSET_TYPES`：投影不得为 `ready`。这是投影资格，不是安装关系，也不是通道 B |
| 投影资格判断 | `src/gateway/skill-execution-binding/materialize.ts` | `isExecutableSkillProjectionEligible` | 同时要求 `enabled`、lifecycle 命中 `EXECUTABLE_LIFECYCLES` 且未命中 `NON_EXECUTABLE_LIFECYCLES`、类型命中 `EXECUTABLE_ASSET_TYPES` | 返回 false：本次物化应删除目录并给出 reason。资格通过只说明**可以**物化，不说明文件已在，也不说明下一轮 loader 已看见 |
| 投影物化 | `src/gateway/skill-execution-binding/sync.ts`；`materialize.ts` | `syncSkillExecutionBinding`；`materializeSkillExecutionBinding` | 结果类型 `SyncSkillExecutionBindingResult`：`action` 为 `materialised` / `removed` / `skipped`，可带 `reason`。`skipped` 的 reason 含 `missing-ids`。不可执行时 `removed`，reason 为 `disabled`、`non-executable-lifecycle` 或 `non-executable-asset-type`。物化路径由 `resolveBoundSkillDir` 决定，目录名 `ob-asset-<skillId>`，文件 `SKILL.md`。成功写入使用 `writeFileSync` **原地覆盖** | `action=materialised` 且文件在该目录下：笔记可记投影 `ready` 的候选。`removed` / `skipped`：记 `failed` 并抄 `reason`。返回值被 hook 丢掉时记 `pending`，reason 写「返回值未被安装 RPC 保留」。同一次 RPC 内文件刚写好，不得当成下一轮 `ready` |
| 投影进入下一轮 | `src/agents/pi-embedded-runner/skills-runtime.ts`；`src/gateway/skill-execution-binding/sync.ts` | `resolveEmbeddedRunSkillEntries`；`loadSkillExecutionBindingEntries`；`mergeSkillEntriesWithBindings` | 有 `agentId` 时合并 live binding，来源标记 `openbot-lifecycle-binding`（`loadSkillsFromDir` 的 `source`）。技能名 `skillExecutionSkillName` → `ob-asset-<skillId>`。随后 `applySkillPolicyToEntries` | 可用性 `ready` 的执行证据是**下一次**该函数的 `skillEntries` 含该名字，且来源链路是 `openbot-lifecycle-binding`。本行是投影是否进入 turn，不是通道 B 的 `synced` |
| 工具与策略 | `src/auto-reply/reply/runtime-skill-policy.ts`；`src/agents/skills/skill-policy.ts`；`src/gateway/skill-execution-binding/skill-tool-wrappers.ts`；`src/agents/pi-tools.ts`；`src/agents/pi-embedded-runner/tool-split.ts` | `resolveRuntimeSkillPolicy`；`composeSkillPolicy`；`applySkillPolicyToEntries`；`applySkillPolicyToAllowlist`；`isToolAllowedBySkillPolicy`；`skillPolicyTokenMatchesToolName`；`createLifecycleSkillIdentityTools`；`buildSkillIdentityToolName`；`SKILL_IDENTITY_TOOL_PREFIX` | 策略是 `{ allow?, block }`。身份工具名 `ob_sk_<skillId>__<baseTool>`。`skill-policy.ts` 里的前缀常量是模块私有副本；对外常量在 `skill-tool-wrappers.ts`。`isLifecycleSkillToolEligible` 再套一层：关系 `enabled`、`isExecutableSkillProjectionEligible`、治理 pause、`bindingState === "disabled"` | 策略滤掉或身份工具不合格：投影行保持原记录，可用性不写 `ready`，原因写策略过滤或工具不合格。禁止因此新建一套与 `SkillPolicy` 平行的总开关 |
| 运行时绑定（通道 B） | `src/gateway/runtime-binding-sync.ts`；写入 `src/gateway/agent-runtime-store.ts` 的 `upsertBinding` | `syncInstallToRuntime` | 返回 `{ synced, reason?, runtimeAgentId?, manifestId?, bindingId? }`。`synced: false` 的 reason：`missing-user`、`platform-auth-disabled`、`user-not-found`、`membership-not-found`、`registry-entry-not-found`、`target-runtime-agent-not-found`、`runtime-agent-not-found`。不抛这些业务失败。不调用 `materializeSkillExecutionBinding` | D9 把该入口标成需要绑定时：`synced: true` 记 `synced`；`synced: false` 记 `failed` 并抄 reason。函数未被调用：记 `not_required` 或 `pending`，禁止记 `synced`。本函数的成功不物化投影 |
| 对照：employee-install 的 `installed` | `src/gateway/server-methods/employee-install.ts` | `executeInstallConfirmation`；`employee-install.apply-configuration`；`bindingStatus` | 无配置请求在调用 `syncInstallToRuntime` **之前**写 `request.status = "installed"`（约第 391 行）。`synced: false` 与抛错只 `console.warn`。空 `userEmail` 跳过同步，状态仍是 `installed`。`apply-configuration` 先写 `installed`（约第 972 行），重新激活失败只 warn。`bindingStatus` 的 `installed` 在请求为 `installed`、`pending-configuration`，或存在任意 binding 对象时为 true。持久化 `~/.config/openbot/stores/employee-install.json`（`INSTALL_STORE_FILE`）。文件头称 Phase 1 stub。本入口不调用 `materializeSkillExecutionBinding` | **禁止映射为可用性 `ready`，也禁止映射为投影 `ready` 或绑定 `synced`。** 笔记只允许写「请求已标记 installed」。详见 §3.1 |

### 2.2 安装关系：`installSkillToRobotAsset` / `RobotSkillRelation`

`installSkillToRobotAsset`（`skill-lifecycle-store.ts`）查找 `(agentId, skillId)`。没有则 push 一条 `RobotSkillRelation`：`enabled: true`，`installedVersion` 取资产当前 `version`。已有则把这两项更新为同样的值。然后 `writeStore`，再 `emitSkillRelationMutation({ op: "install" })`。

RPC `robot-skills.install`（`src/gateway/server-methods/skill-lifecycle.ts`）在调用它之前可能先 `saveSkillAsset`（registry 有条目且本地还没有资产时，显式 `lifecycle: "published"`），并调用 `assertRobotSkillInstallAllowed`。调用之后：

- 不等待、不读取投影 sync 的结果。
- 连接上带有 `userEmail` 时，额外 `await syncInstallToRuntime({ cfg, userEmail, capabilityId: skillId })`，不传 `targetRobotId`，也不读取 `synced` / `reason`。
- 无抛错时 `respond(true, { skill })`。`skill` 是 `RobotSkillEntry`。

因此 `{ skill }` 只证明关系写入路径返回了。目标语义里它最多支撑关系 `linked`。

撤销、升级、删除走同一张 `robotRelations`，不是另一套状态字段：

| 操作 | 符号 | 对关系行的效果 | 随后的投影信号 |
| --- | --- | --- | --- |
| 卸载 | `removeRobotSkillAsset`；RPC `robot-skills.remove` | 删掉该 `(agentId, skillId)`。本来没有则抛 `SkillAssetStoreError` | `op: "remove"`。关系已不在时 `syncSkillExecutionBinding` 走 `removeSkillExecutionBindingFiles` |
| 升级 | `upgradeRobotSkillAsset` | 把 `installedVersion` 改成资产当前 `version` | `op: "upgrade"`。随后物化会 `writeFileSync` 覆盖 `SKILL.md` |
| 删除资产 | `deletePersonalSkillAsset` | 删掉该 `skillId` 的全部关系 | 每个受影响 `agentId` 发 `op: "delete"` |
| 开关 | `toggleRobotSkillAsset` | 改 `enabled` | `op: "toggle"`。`enabled: false` 时物化 reason 为 `disabled` |

`requested` 在现有 store 中没有落点。目标语义用它表示「RPC 已受理、`writeStore` 尚未发生」。验收笔记在函数返回后看到关系行，就记 `linked`，不要补写一个不存在的 `requested` 字段。

同一 hook 还会调用 `syncExecutableAssetBinding`（`src/gateway/executable-asset-binding/sync.ts`），返回值同样不被读取。该函数只在资产带 `mcpBinding`、校验通过、且 lifecycle 属于 `EXECUTABLE_LIFECYCLES` 时，把 MCP 配置写入 mcporter，并可能记一条健康样本。`action` 为 `mcp-upserted` 或 `skipped`。它不是 D5 的第四层，也不是通道 B。MCP 配置写成功不能填投影 `ready`，不能填绑定 `synced`，不能填可用性 `ready`。健康样本不是发布门。

### 2.3 可执行 lifecycle：`EXECUTABLE_LIFECYCLES` / `isExecutableSkillProjectionEligible`

投影资格是集合判断，不是安装成功位。

- `EXECUTABLE_LIFECYCLES` = `private`、`reviewing`、`approved`、`published`。
- `NON_EXECUTABLE_LIFECYCLES` = `draft`、`rejected`、`retired`。
- `isExecutableSkillProjectionEligible` 还要求 `enabled === true` 且 `assetType` 属于 `EXECUTABLE_ASSET_TYPES`。

`reviewing` 在可执行集合里。`saveSkillAsset` 附近若仍有「跳过 draft/reviewing」的注释，以 `isExecutableSkillProjectionEligible` 为准。收紧 `reviewing` 属于方案 D4，不在本闸门改代码。

身份工具使用同一资格：`isLifecycleSkillToolEligible` 在关系未启用或 `isExecutableSkillProjectionEligible` 为 false 时不生成 `ob_sk_*`。工具没生成，不等于投影文件的 D5 状态已经写成 `failed`；两边都要单独看。

### 2.4 投影物化：`syncSkillExecutionBinding` / `materializeSkillExecutionBinding`

`syncSkillExecutionBinding` 的顺序：

1. `agentId` 或 `skillId` 为空 → `{ action: "skipped", reason: "missing-ids" }`。
2. `listRobotSkillAssets` 找不到该技能 → `removeSkillExecutionBindingFiles`。
3. `getSkillRuntimeDefinitionForBinding(skillId, { version: relation.installedVersion })` 抛错 → 删除投影文件。
4. 否则调用 `materializeSkillExecutionBinding`。

`materializeSkillExecutionBinding` 在资格失败时删除目录并返回 `removed`。资格通过时 `mkdir` + `writeFileSync` 覆盖 `SKILL.md`，返回 `materialised` 与 `materialisedPath`。

读模型：

| `SyncSkillExecutionBindingResult.action` | 投影笔记 | 不得同时写下的结论 |
| --- | --- | --- |
| `materialised` | `ready` 的候选。还要等下一轮 loader 才允许可用性 `ready` | 绑定 `synced`；UI「安装成功」 |
| `removed` | `failed`，reason 用返回值 | 绑定 `synced`；把旧的其他技能关系一并标失败 |
| `skipped` | `failed` 或 `pending`。有 reason 就抄；hook 把结果丢掉则 `pending` | 可用性 `ready` |

升级时的覆盖是现有行为：新内容直接写入同一 `SKILL.md`。D9 的推荐默认要求「新投影进入 `ready` 之前，旧投影继续代表旧版本」。这是目标，**当前实现尚未这样做**。冻结 D9 时验收人要知道：同意该默认，等于同意将来的实施 PR 改变这次覆盖；本文不实施这个改变。

### 2.5 工具与策略：runtime skill policy、`ob_sk_*`

一次 turn 里，投影正文和身份工具是两条过滤器，都在投影物化之后。

1. `resolveRuntimeSkillPolicy` 用群组 profile 与 participation overlay 调 `composeSkillPolicy`，得到 `SkillPolicy`。
2. `resolveEmbeddedRunSkillEntries` 在合并 live 投影之后调用 `applySkillPolicyToEntries`。`allow` 未定义且 `block` 为空时原样返回。
3. 工具名单走 `applySkillPolicyToAllowlist` / `isToolAllowedBySkillPolicy`。匹配函数 `skillPolicyTokenMatchesToolName` 认识精确名、折叠名、核心别名，以及 `ob_sk_<skillId>__<baseTool>`。
4. `createLifecycleSkillIdentityTools`（`src/agents/pi-tools.ts` 调用）只为 `isLifecycleSkillToolEligible` 通过的关系生成身份工具。前缀常量 `SKILL_IDENTITY_TOOL_PREFIX = "ob_sk_"`。`renderSkillMarkdown` 会在 `SKILL.md` 正文里建议同一名字。

映射到可用性，而不是新的投影枚举：

| 观察到的事实 | 投影 | 可用性 |
| --- | --- | --- |
| 下一轮 `skillEntries` 含 `ob-asset-<skillId>`，策略未滤掉 | 保持 `ready` | 在该入口其余必需条件也满足时，才可以记 `ready` |
| loader 可见，随后被 `applySkillPolicyToEntries` 滤掉 | 保持 `ready` | `failed`，原因写策略过滤 |
| 投影文件在，身份工具因 pause、`bindingState === "disabled"` 或资格失败而没有 `ob_sk_*` | 文件仍按投影行记录 | 不得写 `ready`。原因写工具不合格或 runtime binding disabled |
| 只有 `ob_sk_*` 名字出现在投影 markdown 正文里 | 不因此升级 | 正文建议不是一次真实调用，也不是可用性 `ready` |

这套策略已经是执行门。闸门 B 的要求是：将来的四层状态**映射到**这些函数的结果，禁止再做一套平行总开关去决定「技能能不能跑」。

### 2.6 通道 B：`syncInstallToRuntime`

`syncInstallToRuntime` 写的是租户 runtime agent 上的 capability binding（`upsertBinding`，`bindingType: "tenant-installed"`）。它查找平台用户、唯一 membership、registry 条目和 runtime agent。个人资产经常没有 registry 条目，返回 `registry-entry-not-found`，同时通道 A 的投影仍可能已经物化。

谁在调用它（入口分类的代码事实，角色由 §4 决定）：

| 调用点 | 何时调用 | 是否阅读 `synced` / `reason` |
| --- | --- | --- |
| `robot-skills.install` | 仅当连接上能解析出 `userEmail`。不传 `targetRobotId` | 否。RPC 仍返回 `{ skill }` |
| `installSkillKeysOntoRobot` | 仅当同时提供 `userEmail` 与 `cfg`。异常被空 `catch`。未提供时该项仍留在返回值 `installed` | 否 |
| `executeInstallConfirmation` | 仅当 `userEmail` 非空。失败只 `console.warn`。状态在调用前已是 `installed` 或 `pending-configuration` | 只用于 warn 和可选的 `bindingId`。响应体不带 reason |
| `employee-install.apply-configuration` | 不直接再调 `syncInstallToRuntime`。若已有 `bindingId`，尝试 `updateBindingState(..., "active")` | 失败只 warn，RPC 仍成功 |

`RuntimeCapabilityBinding.bindingState` 的枚举是 `active` / `warming` / `degraded` / `disabled`（`agent-runtime-store.ts`）。其中的 `degraded` 表示治理限流，`canInvokeBinding` 对它返回 `allowed: true`。**它不是 D5 可用性 `degraded`。** D5 的 `degraded` 只表示：投影 `ready`，且该入口把通道 B 标成辅助，而 `syncInstallToRuntime` 失败。

### 2.7 对照项：employee-install 的 `installed`

本行是对照，不是四层里的成功态。

| 现有符号或字段 | 它表示什么 | 目标语义允许的笔记 | 禁止的映射 |
| --- | --- | --- | --- |
| `request.status = "installed"` | 安装请求记录被标成完成。写入时机在 runtime sync 之前 | 「请求已标记 installed」 | 关系 `linked`、投影 `ready`、绑定 `synced`、可用性 `ready` |
| `bindingStatus().installed === true` | 请求状态为 `installed` 或 `pending-configuration`，或任意 binding 对象存在 | 原样引用该布尔，留在对照行 | 可用性 `ready` |
| `installSkillKeysOntoRobot` 返回值里的数组名 `installed` | `installRegistrySkillOntoRobot` 返回 `ok: true` 的那些 key。`ok` 发生在 `installSkillToRobotAsset` 返回之后，runtime sync 之前 | 关系行的候选。绑定另计 | 用这个数组宣布下一轮可执行 |
| `robot-skills.install` 成长里程碑 `firstSkillInstalledAtMs` | 关系写入之后的 fire-and-forget，失败被吞 | 不进入四层 | 把它当成投影或可用性证据 |

`employee-install.confirm` 今天不物化 `SKILL.md`。对照行的投影固定记「本入口未物化」，不标 `ready`。

## 3. 禁止误映射

冻结 D5 的前提是验收人接受下面三条排除。缺任何一条，本文 §6 的 D5 勾选保持未勾。

### 3.1 `installed` 不得映射为 `ready`

- 关系 `linked` 只说明 `robotRelations` 里有这条关系。
- 请求状态 `installed` 只说明 `employee-install.json` 里的请求被标过。
- 返回数组名叫 `installed` 只说明 pack 函数把该项放进了成功数组。
- 三者都不能推出投影 `ready`、绑定 `synced`、可用性 `ready`。
- UI「安装成功 / 可以使用」的最低证据见 §4.2，不使用单独的 `installed`。

### 3.2 通道 A 的目录名不是通道 B

`skill-execution-binding`、`SkillExecutionBindingRecord`、`loadSkillExecutionBindingEntries` 服务于投影。`syncInstallToRuntime` 的 `synced: true` 服务于 runtime binding。投影 `materialised` 与绑定 `synced: true` 无互相蕴含。个人资产上常见的组合是：投影已物化，绑定 reason 为 `registry-entry-not-found`。

### 3.3 `BindingState.degraded` 不是可用性 `degraded`

agent runtime 的 `bindingState: "degraded"` 是治理限流，调用仍允许。D5 可用性 `degraded` 是「投影就绪、辅助同步失败」的验收结论。笔记里若两词同时出现，必须写出来源符号，禁止互相填空。

## 4. D9 决策清单

本节全部是**推荐默认**，标注 **待专家勾选**。未勾选的项保持阻塞。勾选表示接受该句作为将来实施的前提，不表示本轮可以改代码。

方案 #546 的 D9 表把 `installSkillToRobotAsset` / `robot-skills.install` 写成「绑定 `not_required`，除非同一次调用另外要求绑定」。代码事实是：该 RPC 在有 `userEmail` 时已经调用 `syncInstallToRuntime`，并且丢掉返回值。推荐默认把「这次调用实际发生」收成辅助，而不是必需。验收人可以改选。

### 4.1 哪些入口需要通道 B

- [ ] **待专家勾选。** 文件系统发现（bundled / managed / workspace / extra / plugin / 两级 `.agents/skills`）不建立员工安装关系，不走安装状态机。绑定 `not_required`。loader 自己发现目录。UI 不得把这类技能说成 `employee-install` 的安装结果。推荐：同意
- [ ] **待专家勾选。** `robot-skills.install` / `installSkillToRobotAsset` 在**没有**调用 `syncInstallToRuntime` 时（无 `userEmail`）：关系必需，成功后 `linked`；投影必需，成功后 `ready`；绑定 `not_required`。可用性只看投影资格、物化，以及下一轮 loader 与策略。推荐：同意
- [ ] **待专家勾选。** `robot-skills.install` 在**已经**调用 `syncInstallToRuntime` 时（有 `userEmail`）：关系必需，投影必需，通道 B 为**辅助**。投影 `ready` 且绑定 `failed` → 可用性 `degraded`。绑定失败不得抹掉投影，也不得只返回无原因的成功。推荐：同意辅助。改选为「必需」或「仍算 `not_required`」时，在行尾写明：____________
- [ ] **待专家勾选。** `installSkillKeysOntoRobot` 在提供了 `userEmail` 与 `cfg` 并调用了 `syncInstallToRuntime` 时：关系必需，投影必需，通道 B 为**辅助**。投影 `ready` 且绑定 `failed` → 可用性 `degraded`。推荐：同意
- [ ] **待专家勾选。** `installSkillKeysOntoRobot` 未调用绑定时：关系必需，投影必需，绑定 `not_required`。可用性只看投影。推荐：同意
- [ ] **待专家勾选。** `employee-install.confirm` / `employee-install.apply-configuration`：这是安装请求记录，不把它写成技能投影关系。本入口今天不物化 `SKILL.md`；未另做投影时，投影不标 `ready`。通道 B 为**必需**。绑定未 `synced` 时，该入口可用性为 `failed`。不得用该入口的成功推断下一轮 prompt 里有技能。推荐：同意
- [ ] **待专家勾选。** 缺口 draft、未 `finalizeDraftSkill` 的资产：可以挂关系；投影必须保持非 `ready`；绑定 `not_required`；执行可用性为 `failed`。推荐：同意

没有「看情况再定」的入口。上表未覆盖的入口不得在实施时临时归类。

### 4.2 UI「安装成功」的最低证据

- [ ] **待专家勾选。** 「可以使用 / 安装成功」只允许出现在可用性 `ready`，并且下一轮真实执行路径已经能观察到（闸门 C 的证据，不是同一次 RPC 的回读）。推荐：同意
- [ ] **待专家勾选。** `degraded` 使用单独文案，写明投影已就绪、辅助同步失败及原因。不得叫安装成功。推荐：同意
- [ ] **待专家勾选。** 只看到关系 `linked`，或旧字段 / 请求状态 `installed` 时，文案停在「关系已建立」或「待核对投影」。`employee-install` 的请求状态保持「请求已标记 installed」，不升级成关系文案。推荐：同意
- [ ] **待专家勾选。** 员工 UI 今天是否已有分层展示位，仍是 **待核实**（本轮未打开 UI）。Phase 1 的完成条件包含最小展示；没有展示位则该阶段不算完成。本勾选只接受这条完成条件，不表示展示位已经存在。推荐：同意把「最小展示」留作实施验收，而不是本文件的通过条件

### 4.3 重试

- [ ] **待专家勾选。** `failed` 与 `degraded` 都可对同一关系重试。推荐：同意
- [ ] **待专家勾选。** 重试不得新建第二条关系，也不得留下第二份仍在授权的投影。推荐：同意
- [ ] **待专家勾选。** 部分成功（投影 `ready`、绑定 `failed`）的重试只补绑定，不回滚投影。推荐：同意
- [ ] **待专家勾选。** 重复安装是幂等的：终态与第一次成功后的四层一致。现有 `installSkillToRobotAsset` 对同一 `(agentId, skillId)` 更新原行而不是再 push，这条关系幂等已经存在；投影与绑定的幂等仍要按返回值与下一轮 loader 核对。推荐：同意
- [ ] **待专家勾选。** 并发安装同一机器人、同一技能：最终只有一条关系，最多一份仍在授权的投影。锁的具体原语在实施时选定，验收看结果。推荐：同意。并发不在 #549 切片的必测项里；全量 Phase 1 才要求

### 4.4 升级、撤销、删除时的旧投影

- [ ] **待专家勾选。** 升级：新投影进入 `ready` 之前，旧投影继续代表旧版本，不得被半份新内容替换后仍当作新版本授权。新投影 `failed` 时，原先有效的旧投影保持可用，并标明仍是旧版本。推荐：同意。**现有实现与此不同：** `materializeSkillExecutionBinding` 对同一路径 `writeFileSync` 覆盖。同意本条意味着将来的实施要改变覆盖方式；本文不改
- [ ] **待专家勾选。** 撤销、卸载、删除：`removeRobotSkillAsset` 或 `deletePersonalSkillAsset` 解除关系后，旧投影不得继续授权。下一轮 `resolveEmbeddedRunSkillEntries` 加载不到该 `ob-asset-<skillId>`。`remove` RPC 的 `{ ok: true }` 单独不算这条通过。推荐：同意
- [ ] **待专家勾选。** 回滚范围服从 §1 第 7 条。绑定失败不得删除已经 `ready` 的投影。推荐：同意
- [ ] **待专家勾选。** `employee-install` 没有与 `removeRobotSkillAsset` 对等的撤销。对照入口不能用来完成撤销步。推荐：同意

## 5. 与垂直切片五步的对应

#549 的五步是观测规程。它用三行笔记（关系、投影、绑定）记录，结论栏才写可用性。本文不要求产品开始写入四层字段。验收人填 #549 §4.2 的空表时，按下面的方式把三层记全。可用性永远在结论栏，不占用三行中的一行去「补满」。

| 切片步 | 安装关系怎么记 | 执行投影怎么记 | 运行时绑定怎么记 | 结论栏 |
| --- | --- | --- | --- | --- |
| 创建或选择 | 尚未安装则 `absent`（笔记用词，#549 允许；D5 关系枚举本身是 `requested` / `linked`）。不要因为资产已保存在 `skill-assets` 就记 `linked` | `draft` / `rejected` / `retired`，或 `isExecutableSkillProjectionEligible` 为 false：非 `ready`。正向路径要先 `finalizeDraftSkill` 到 `private` | `not_required`。本步不调用 `syncInstallToRuntime` | `draft` 不得写成可执行。没有 `skillId` 则停止 |
| 保存 | 仍不建立 `robotRelations`。再读位置必须是 `CONFIG_DIR/skill-assets/store.json` | 不写 `ob-asset-*`。记 `pending` 或「未物化」，不标 `ready` | `not_required` | 保存成功只证明资产可再读。失败文案来自 `SkillAssetStoreError` |
| 授权/安装（主切片 `robot-skills.install`） | `robotRelations` 中该对只有一条且 `enabled: true`：`linked`。`installedVersion` 等于资产版本 | 单独看 `syncSkillExecutionBinding` 的 `action`，或投影目录。`materialised` 且文件在 `ob-asset-<skillId>/SKILL.md`：`ready` 候选。返回值被忽略：`pending` 或 `failed`，写明「返回值未被安装 RPC 保留」 | 未调用通道 B：`not_required`。调用了但 RPC 未回传结果：`pending`，reason 写「`robot-skills.install` 未回传 `syncInstallToRuntime` 结果」。读到 `synced: false`：`failed` 加 reason。禁止记 `synced`，除非返回值就是 `synced: true` | 只有投影候选为 `ready` **并且**下一步看见该技能，才写可用性 `ready`。绑定失败而投影已物化：`degraded`（在 §4.1 把该次调用收成辅助的前提下）。不得写安装成功 |
| 授权/安装（对照 `employee-install`） | 只记录请求 id 与 `request.status`。文案停在「请求已标记 installed」。不抄进 `robotRelations` | 固定「本入口未物化」。不标 `ready` | 记录 `synced` 与 `reason`。响应里没有 reason、只有 `console.warn`：`failed` 或 `pending`，reason 写「仅有 console.warn，响应体无结构化原因」 | 本行失败或未同步时，不得勾主切片的运行通过 |
| 运行（下一次 loader） | 沿用安装步的关系行，不因 loader 看见就改写关系 | 沿用投影行。策略滤掉时不把投影改成 `failed` | 沿用绑定行。loader 看不见时，不得把绑定改成 `synced` 来解释 | 正向通过的唯一证据：安装返回**之后**的另一次 `resolveEmbeddedRunSkillEntries`，`skillEntries` 含 `ob-asset-<skillId>`，来源 `openbot-lifecycle-binding`，且未被策略滤掉。同一次 RPC 内的文件或 `{ skill }` 不算 |
| 撤销 | 该对从 `robotRelations` 消失。关系本来不存在：RPC `INVALID_REQUEST`，文案 `skill <id> is not installed on robot <agentId>`，停止 | 目录删除，或 sync `action=removed`：不再 `ready`。hook 异常被吞时，RPC `{ ok: true }` 不能代替目录或下一轮证据 | 若安装时曾 `synced`，撤销后另读一次 agent runtime binding。读不到则「未复核」，不得沿用安装时的 `synced` | 撤销 RPC 完成之后的**再下一次** loader 不含该名字，可用性记 `failed`（已不可用）。其他仍然有效的技能被一起弄掉：本步失败 |

幂等补行与 #549 相同：同一机器人、同一技能再执行一次 `robot-skills.install`，关系仍是一条，`ob-asset-<skillId>` 仍是一份，三行终态与第一次成功后的笔记一致。

三层记录的硬规则：

1. 一行的成功不能填进行。
2. `installed` 若出现，只允许作为关系行或对照行里的原样引用。
3. 可用性 `ready` / `degraded` / `failed` 只出现在结论栏。
4. 历史数据只有 `installed=true` 时：若它是机器人关系上的旧记录，关系按 `linked` 记，投影 `pending`，绑定未知则 `pending`，可用性不默认 `ready`。若它只是 `employee-install` 请求，停在对照行。

## 6. 冻结判定（独立验收勾选）

两组勾选分开。第 6.1 节是材料是否交齐。第 6.2 节才是 D5 / D9 能否冻结。交付时 6.2 全空。勾选 6.1 不会勾选 6.2。勾选 6.2 也不会批准实施。

### 6.1 材料已齐：起草人可以勾

- [x] 本文状态写明「闸门 B 草案 / 待独立验收勾选 / 未实施产品改动」
- [x] D5 四层（关系 `requested` / `linked`；投影 `pending` / `ready` / `failed`；绑定 `not_required` / `pending` / `synced` / `failed`；可用性 `ready` / `degraded` / `failed`）写成目标语义，并写明现有 store 没有这些字段
- [x] 映射表逐项给出路径与符号：`installSkillToRobotAsset` / `RobotSkillRelation`、`EXECUTABLE_LIFECYCLES` / `isExecutableSkillProjectionEligible`、`syncSkillExecutionBinding` / `materializeSkillExecutionBinding`、runtime skill policy 与 `ob_sk_*`、`syncInstallToRuntime`、employee-install 的 `installed` 对照
- [x] 写明 `installed` 不得映射为 `ready`，通道 A 不是通道 B，`BindingState.degraded` 不是可用性 `degraded`
- [x] D9 对通道 B、文件系统发现、UI 最低证据、重试、升级/撤销/删除给出了推荐默认，并标为待专家勾选
- [x] 写明本文件勾选不等于批准实施；闸门 A 未完全通过且闸门 B 未勾选前，禁止落地 PR
- [x] 写明与 #549 五步的对应：观测笔记按关系、投影、绑定三层记录，可用性在结论栏

上一组只表示：冻结所需的句子和映射已经写在本文件里。

### 6.2 D5 / D9 冻结：待专家勾选，交付时保持未勾

验收人只凭本文件勾。每一项都能在上文找到原文，不依赖未合入 PR 的正文。

- [ ] D5 目标语义可冻结：四层枚举、八条规则，以及「现有 store 没有这些字段」
- [ ] D5 映射可冻结：§2 的读模型与现有符号一致，且没有把投影模块当成通道 B
- [ ] §3 的三条排除可冻结：`installed` ≠ `ready`；通道 A ≠ 通道 B；`BindingState.degraded` ≠ 可用性 `degraded`
- [ ] D9 入口分类可冻结：§4.1 每一行都有绑定角色。若改选 `robot-skills.install`（有 `userEmail`）的角色，改选已写在该行行尾，不再留空
- [ ] D9 的 UI 最低证据、重试、旧投影处理可冻结（§4.2–§4.4）。同意升级条时，已知道当前实现是原地覆盖
- [ ] 观测笔记继续按 #549 三层记录，本冻结不要求先改 store schema

全部勾选的含义只有一句：**D5 / D9 的文案与映射可以冻结。** 它不表示：

- 闸门 A 已完全通过
- 闸门 C 已通过，或切片 §5.2 已跑
- 可以修改产品代码、测试、配置、提示词或对外工具文档
- 可以在实施 PR 里新增四层字段，除非该 PR 引用本冻结，并且字段只是这些符号的读模型，不另做平行总开关

### 6.3 不得从本文件得出的结论

| 有人可能想说的话 | 本文件的位置 |
| --- | --- |
| 闸门 A 已完全通过 | 否。#550 只记录技能路径无 diff。生产版本待核实 |
| 闸门 B 已通过 | 否。§6.2 交付时未勾。材料交齐不等于专家冻结 |
| 可以开 D5 / D9 落地 PR | 否。见 §7 |
| `request.status = "installed"` 已经等于可用性 `ready` | 否。§3.1 禁止 |
| 调查基线或 `8ce4b0fe…` 是生产版本 | 否 |

## 7. 实施禁令

在下面两句同时成立之前，禁止落地产品改动（含产品逻辑、测试、配置默认值、提示词、`docs/tools/`、`docs/cli/`、`docs/zh-CN/`）：

1. 闸门 A 完全通过：生产部署版本已核实，且与调查基线或当时 `main` 的差异已记录。仅有 #550 的技能路径无 diff，不够。
2. 闸门 B 已勾选：本文 §6.2 全部勾上。只勾 §4 的部分推荐、或只勾 §6.1，都不够。

即便两句都成立，落地也必须是**另开的独立实施 PR**。该 PR 不得把本文的勾选当作已经改完的行为。范围仍受 #546 的阶段划分和 #549 §7 约束：先切片的失败路径测试，再谈全部入口；不在未另批的 PR 里改对外文档、系统提示词、auto-evolution 默认值或 ClawHub。

本文件勾选 ≠ 批准实施。撤回 §6.2 的任一项，闸门 B 失效，分层状态的实施回到未批准。

`origin/main` 若前进到不再满足「技能路径相对 `93ce9df…` 无 diff」，本文行号作废，须先重做 #550 那种路径核对，再决定映射是否仍可冻结。

## 8. 本轮边界

- 本轮只新增本文件。没有修改产品逻辑、测试、配置、提示词或对外工具文档。
- 未跑 gateway，未打开员工 UI，未访问生产。§4.2 的展示位因此保持待核实。§6.2 保持未勾。
- 符号读取的 HEAD 是 `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`。推送前 `origin/main` 前进到 `156b03113c6cb45f2be56da57dccae65f4f8a5e3`（Control UI: fill fullscreen computer preview，#547）。该提交不修改 §2 的技能路径。基线 `93ce9df262b3666d83f64c559a5e7801e6bde089` 到这一新 HEAD 的技能路径 diff 仍为空，所以行号尚未作废。生产构建标识没有读取。
- #545、#546、#549、#550 在撰写时仍是 open draft。冻结判定所需的 D5 规则、D9 推荐和符号映射已经抄进本文。
