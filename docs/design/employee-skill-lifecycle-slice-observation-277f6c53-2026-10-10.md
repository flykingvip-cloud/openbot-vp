---
date: 2026-10-10
control_environment_commit: 277f6c5304b00142a180effcf2c0062fa9b0d5e3
hk_live_commit: 65564d30b25a41f49866f96e0efed9caacd80a9b
hk_repo_digest: sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f
gate_a_full: true
gate_a_acceptance: "PR #550 independent acceptance, 2026-10-10"
this_file_is_hk_live_five_step: false
method: code-path and static observation of blobs at the control SHA; live five-step RPC was not run by the docs agent
related_prs:
  - 549
  - 550
  - 551
  - 546
d0: A
d0_frozen: true
gate_b_product_freeze_newly_passed: false
gate_b_freeze: "frozen on PR #551; this file does not newly freeze anything"
gate_c: false
product_implementation: "Gate B frozen on #551; this file is not product implementation and not Gate C"
---

# 员工技能生命周期：对照 SHA 277f6c53 的五步观察笔记

> **文档状态：只读观察 / 对照 277f6c53 / 闸门 A 已完全通过（见 #550）/ 闸门 B 已于 #551 冻结 / 非 HK LIVE 五步实测 / 不勾 #549 §5.2 / 不宣称闸门 C / 本文件不混实现**
>
> 日期：2026-10-10
> 对照环境 commit：`277f6c5304b00142a180effcf2c0062fa9b0d5e3`（本文的五步行为陈述只钉这一棵树）
> 提交页：https://github.com/upbeyond/openbot/commit/277f6c5304b00142a180effcf2c0062fa9b0d5e3
> 闸门 A 已完全通过（见 #550，独立验收，2026-10-10）。HK LIVE commit 为 `65564d30b25a41f49866f96e0efed9caacd80a9b`，RepoDigest 为 `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`。Mac 对照 SHA 与该 HK LIVE 不是同一个提交。
> 本文仍是对照 `277f6c53…` 的只读观测，不是 HK LIVE 上的五步实测，不勾 #549 §5.2，不宣称闸门 C。
> 方法：在对照 commit 的 blob 上做代码路径与静态观察（`git show` / `git grep` / `git diff`）。五步 RPC 未由撰写本文的文档代理执行。另有一节「对照环境现场」，转述 openbot 性能评测在约 13:50 Asia/Shanghai 的只读确认；那次确认不含五步 RPC。
> 相关：垂直切片 #549、闸门 A #550、闸门 B #551、方案 #546。D0=A 已冻结。
> 闸门 B 已于 #551 冻结；独立切片落地 PR 另开（测试先行、钉死对照 SHA）；本文件不混实现。本文不把闸门 B 的冻结写成由本文件新做的决定，也不宣称闸门 C。

本文填写 #549 §4.2 风格的三层记录，材料只来自对照 SHA 的源码形状，外加性能评测的身份级只读确认。需要真实 RPC 才能填写的格子一律写 `未实测（只读源码）`。

## 1. 观察到了什么，没有观察到什么

已观察：

- 对照 SHA `277f6c5304b00142a180effcf2c0062fa9b0d5e3` 上，#549 §3 五步用到的符号、返回形状、以及会吞掉原因的 `catch`。行号属于这一棵树。
- 七条技能路径相对调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089` 的 `git diff --stat` 为空。两边都没有修改这些路径的提交。共同祖先是 `b7b72e9cecc6727d4946188123ad909b35f42de8`。这与 #550 第 5.3 节一致，本文又在本地 git 对象上复核了一次。空 diff 只说明这些路径的 git 内容相同。
- 性能评测在约 13:50 Asia/Shanghai 对 Mac 私服做了只读身份确认：进程仍钉在同一 SHA，loopback `:18789/health` 返回 live，并点名若干可读路径。见第 4.1 节。

未观察：

- 创建、保存、主切片安装、`employee-install` 确认、下一次 `resolveEmbeddedRunSkillEntries`、撤销，以及撤销后再一次 loader。这些都是 `未实测（只读源码）`。
- HK LIVE 上的五步 RPC。闸门 A 的身份来自 #550 的独立验收，本文没有在 HK LIVE 上重跑创建、保存、安装、loader 或撤销。
- 任何产品行为变更。本文没有改 `src/`、`ui/`、`extensions/`、`skills/`、测试、配置、提示词，也没有改 `docs/tools/`、`docs/cli/`、`docs/zh-CN/`。

因此：闸门 A 已完全通过（见 #550）。本文仍是对照 `277f6c53…` 的只读观测，不是 HK LIVE 五步实测，不勾 #549 §5.2，不宣称闸门 C。

## 2. 环境身份

| 身份                    | commit                                     | 本文如何知道                                                                                                                                                  | 与 HK LIVE 的关系                              |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Mac 私服对照 gateway    | `277f6c5304b00142a180effcf2c0062fa9b0d5e3` | #550 第 5.6 节记录 pin 与进程 cwd。约 13:50 Asia/Shanghai 性能评测再次读到 pin、cwd HEAD、pid `66973`、loopback `18789`。本文作者用 git 读了该 commit 的 blob | Mac。不是 HK LIVE。本文五步只钉这一 SHA        |
| HK LIVE                 | `65564d30b25a41f49866f96e0efed9caacd80a9b` | #550 独立验收，2026-10-10。RepoDigest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`。闸门 A 已完全通过                            | 这是 HK LIVE。本文没有在该 commit 上做五步实测 |
| 调查基线                | `93ce9df262b3666d83f64c559a5e7801e6bde089` | #549 / #550。本文 `git diff` 复核技能路径为空                                                                                                                 | 调查基线。不是本文的五步现场                   |
| 本文撰写时检出的 `main` | 不作为对照行为的依据                       | 行为陈述不从 `main` 另读实现                                                                                                                                  | 不是 HK LIVE，也不是 Mac 对照                  |

技能路径（与 #550 第 3 节相同的七条）在 `93ce9df262b3666d83f64c559a5e7801e6bde089` 与 `277f6c5304b00142a180effcf2c0062fa9b0d5e3` 之间 diff 为空：

- `src/gateway/server-methods/employee-install.ts`
- `src/gateway/skill-lifecycle-store.ts`
- `src/gateway/runtime-binding-sync.ts`
- `src/gateway/capability-packs/install-pack-to-robot.ts`
- `src/gateway/skill-execution-binding/`
- `src/gateway/server-methods/skill-lifecycle.ts`
- `src/agents/pi-embedded-runner/skills-runtime.ts`

## 3. 五步三层记录（源码形状）

格子分两截：源码在对照 SHA 上写明的形状，以及现场值。现场值全部是 `未实测（只读源码）`。源码形状不是一次 RPC 的实测结果。

`CONFIG_DIR` 来自 `resolveConfigDir`（`src/utils.ts`）。未设置 `OPENBOT_STATE_DIR` / `OPENCLAW_STATE_DIR` / `CLAWDBOT_STATE_DIR` 时，已存在的 `~/.openbot` 优先，否则回落 `~/.openclaw`，再否则新建 `~/.openbot`。本文没有读取 Mac 进程的环境变量，所以不把某一次绝对路径写成实测。

投影目录名经过 `skillExecutionSkillDirName` / `skillExecutionSkillName`（`src/gateway/skill-execution-binding/paths.ts`）：前缀 `SKILL_EXECUTION_BINDING_PREFIX` 为 `ob-asset-`（`types.ts`），其后是小写并替换非 `[a-z0-9._-]` 的片段。笔记里的 `ob-asset-<skillId>` 在源码里是这个净化名，不是未处理的原始 id。

### 3.1 创建或选择

符号（`277f6c5304b00142a180effcf2c0062fa9b0d5e3`）：

- `skillLifecycleHandlers` 内的 `personal-skills.list`、`personal-skills.detail`、`skill-lifecycle.save`、`personal-skills.finalize-draft`（`src/gateway/server-methods/skill-lifecycle.ts`）。
- `saveSkillAsset` 返回 `{ skillId, detail }`，`version` 字面量为 `"1.0.0"`（`src/gateway/skill-lifecycle-store.ts`）。
- `resolveInitialLifecycle`：显式 lifecycle 经 `normalizeLifecycle` 后采用；否则 `enterprise` → `reviewing`，`group` → `published`，其余 → `draft`。
- `EXECUTABLE_LIFECYCLES`：`private` / `reviewing` / `approved` / `published`。`NON_EXECUTABLE_LIFECYCLES`：`draft` / `rejected` / `retired`。`EXECUTABLE_ASSET_TYPES` 不含 `knowledge`（`src/gateway/skill-execution-binding/types.ts`）。`isExecutableSkillProjectionEligible` 要求 `enabled`，且 lifecycle 在允许集、类型在允许集（`materialize.ts`）。
- `saveSkillAsset` 附近注释写 execution binding 会跳过 draft/reviewing。该注释与 `types.ts` 里「reviewing 仍可执行」的注释不一致。以集合与 `isExecutableSkillProjectionEligible` 为准：`reviewing` 可投影。`mayAutoInstall` 另有一道门，只包含 `draft` / `private` / `approved` / `published`，不含 `reviewing`。
- 缺 name 或 summary：抛 `SkillAssetStoreError`，文案 `skill name and summary are required`。指定已存在的 `skillId`：`skill <id> already exists`。`skill-lifecycle.save` 经 `respondSkillError` 变成 `INVALID_REQUEST`，正文是 `error.message`。其他错误走 `UNAVAILABLE`。
- `finalizeDraftSkill`：非 draft 抛 `skill <id> is not in draft state`；成功把 lifecycle 写成 `private`，并对已启用的关系 `emitSkillRelationMutation({ op: "install" })`，返回 `EmployeeSkillDetail`。RPC 包一层 `{ skill }`。

| 层           | 源码形状                                                                                                                                                                                                                 | 现场               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 安装关系     | 选择（list/detail）不写关系。新建时，仅当 `sourceAgentId` 非空且 `autoInstallEnabled !== false` 且 lifecycle 落在 `mayAutoInstall` 时，向 `robotRelations` push 一条 `enabled: true`。`reviewing` 不走这条自动关系       | 未实测（只读源码） |
| 执行投影     | 自动关系会 `emitSkillRelationMutation({ op: "save" })`。hook 调用 `syncSkillExecutionBinding` 并丢弃返回值。draft 会走到 `materializeSkillExecutionBinding` 的 `action: "removed"`，`reason: "non-executable-lifecycle"` | 未实测（只读源码） |
| 运行时绑定   | 本步不调用 `syncInstallToRuntime`                                                                                                                                                                                        | 未实测（只读源码） |
| 结论栏       | 成功形状是 `{ skillId, detail }` 或 list/detail 的 respond 成功体。draft 在源码上不可投影。没有一次真实 `skillId`                                                                                                        | 未实测（只读源码） |
| 失败原因原文 | 源码字符串见上。没有一次真实 RPC 正文                                                                                                                                                                                    | 未实测（只读源码） |

### 3.2 保存

符号：

- 持久化：`STORE_DIR = path.join(CONFIG_DIR, "skill-assets")`，`STORE_FILE = path.join(STORE_DIR, "store.json")`。
- 成功返回 `{ skillId, detail }`，`version` 为 `"1.0.0"`。
- 再读入口是 `personal-skills.detail` → `loadOwnedPersonalSkill`。本文没有展开所有权失败的文案，不把未读到的句子写成实测。
- `~/.config/openbot/stores/employee-install.json`（`INSTALL_STORE_FILE`）属于对照入口，不是本步的 skill-assets。

| 层           | 源码形状                                                                                                                                                                                                                                                    | 现场               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 安装关系     | 保存本身不保证关系。自动关系条件同 §3.1。无 `sourceAgentId` 时本步不 push `robotRelations`                                                                                                                                                                  | 未实测（只读源码） |
| 执行投影     | 无自动关系时不调用物化。有自动关系时投影结果被 hook 丢弃                                                                                                                                                                                                    | 未实测（只读源码） |
| 运行时绑定   | 不调用 `syncInstallToRuntime`                                                                                                                                                                                                                               | 未实测（只读源码） |
| 结论栏       | 源码承诺落在 `skill-assets/store.json`。同 `skillId` 再读是否一致，要另一次 RPC                                                                                                                                                                             | 未实测（只读源码） |
| 失败原因原文 | store 抛错时 `skill-lifecycle.save` 走 `respondSkillError`。若抛错发生在已注册 hook 内部，`emitSkillRelationMutation` 空 `catch`（注释 `hooks must not break asset mutations`），保存返回值仍可能是 `{ skillId, detail }`。那种「原因被吃掉」没有在现场复现 | 未实测（只读源码） |

### 3.3 授权/安装

#### 3.3.1 主切片 `robot-skills.install`

符号（`src/gateway/server-methods/skill-lifecycle.ts` 的 `robot-skills.install`）：

1. 若 registry 有条目且 `getPersonalSkillAssetDetail` 抛错，先 `saveSkillAsset`，显式 `lifecycle: "published"`。
2. `assertRobotSkillInstallAllowed`。`installAllowed` 为假时抛 `SkillAssetStoreError(assessment.nextStep)`。
3. `installSkillToRobotAsset`：已有 `(agentId, skillId)` 则把 `enabled` 设为 `true` 并刷新 `installedVersion`；否则 push 一条。然后 `emitSkillRelationMutation({ op: "install" })`，返回 `projectRobotSkill` 的 `RobotSkillEntry`。
4. 模块加载时已调用 `ensureSkillExecutionBindingHooksRegistered`。hook（`register-hooks.ts`）调用 `syncSkillExecutionBinding` 与 `syncExecutableAssetBinding`，两个返回值都不保存。
5. `emitSkillRelationMutation` 对 hook 异常是空 `catch`。
6. `recordRobotGrowthMilestone(...).catch(() => {})` 与 `syncRobotPendingTaskGapStatuses(...).catch(() => {})` 也丢弃失败。
7. `client` 上能取出非空 `userEmail` 时，`await syncInstallToRuntime({ cfg, userEmail, capabilityId: skillId })`。不传 `targetRobotId`。不读 `synced` / `reason`。
8. 无抛错时 `respond(true, { skill }, undefined)`。

`syncSkillExecutionBinding`（`sync.ts`）返回 `SyncSkillExecutionBindingResult`：`action` 为 `materialised` | `removed` | `skipped`。空 id 时 `{ action: "skipped", reason: "missing-ids" }`。关系不在时走 `removeSkillExecutionBindingFiles`，`reason` 为 `explicit-remove`。`getSkillRuntimeDefinitionForBinding` 抛错时同样走 `removeSkillExecutionBindingFiles`，原来的异常被丢掉，reason 仍是 `explicit-remove`。不可执行时 `materializeSkillExecutionBinding` 删目录并返回 `removed`，reason 为 `disabled`、`non-executable-lifecycle` 或 `non-executable-asset-type`。成功为 `{ action: "materialised", skillName, materialisedPath }`。

`syncInstallToRuntime`（`runtime-binding-sync.ts`）失败时返回 `{ synced: false, reason }`，不抛这些业务原因。reason 字面量：`missing-user`、`platform-auth-disabled`、`user-not-found`、`membership-not-found`、`registry-entry-not-found`、`target-runtime-agent-not-found`、`runtime-agent-not-found`。主切片 RPC 不把该对象放进 `respond`。

`employee-install.ts` 不引用 `materializeSkillExecutionBinding` 或 `syncSkillExecutionBinding`。主切片的投影只可能来自关系 hook，不来自对照入口。

| 层           | 源码形状                                                                                                                                                                                             | 现场               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 安装关系     | `installSkillToRobotAsset` 写入或更新一条 `robotRelations`。RPC 成功体是 `{ skill }`。源码的更新分支不会为同一对 id 再 push 第二条；这不是现场幂等实验                                               | 未实测（只读源码） |
| 执行投影     | hook 可能物化 `CONFIG_DIR/skill-execution-bindings/<agent>/ob-asset-…/SKILL.md`，但 `SyncSkillExecutionBindingResult` 被丢掉。异常被空 `catch` 吃掉。读不到 `action`/`reason` 时，笔记不能填 `ready` | 未实测（只读源码） |
| 运行时绑定   | 无 `userEmail` 时函数不被调用；`syncInstallToRuntime` 对空邮箱的返回是 `{ synced: false, reason: "missing-user" }`，但调用方根本没调用。有邮箱时结果被丢弃。成功响应里没有 `synced`                  | 未实测（只读源码） |
| 结论栏       | `{ skill }` 只说明关系函数返回了。它不证明投影 `ready`，也不证明绑定 `synced`，更不是下一次 loader                                                                                                   | 未实测（只读源码） |
| 失败原因原文 | store / `assertRobotSkillInstallAllowed` 的 `SkillAssetStoreError` 能进 `INVALID_REQUEST`。投影 reason 与绑定 reason 不在该响应里                                                                    | 未实测（只读源码） |

#### 3.3.2 对照 `employee-install.confirm`

符号（`src/gateway/server-methods/employee-install.ts`）：

- 文件头写明当前是支撑 UI 闭环的 Phase 1 stub。
- `INSTALL_STORE_FILE` 为 `~/.config/openbot/stores/employee-install.json`。
- `executeInstallConfirmation`：`external-local` 且扫描未通过时抛 `扫描结果无效或未通过，无法确认安装`。无 `requiredConfiguration` 时，在 `syncInstallToRuntime` **之前**把 `request.status` 写成 `installed` 并设置 `completedAt`。有配置项时写成 `pending-configuration`。
- `userEmail` 取 `client.user` 的字符串，空值则整段同步跳过，状态仍保持上面已经写好的值。
- 同步返回 `synced: false` 时 `console.warn`，带 `syncResult.reason`。抛错时另一条 `console.warn`。两条都不进入 `respond`。
- `employee-install.confirm` 成功体只有 `{ requestId, status, completedAt, nextStep }`。`executeInstallConfirmation` 返回值里的 `bindingId` 没有放进这个成功体。
- `employee-install.apply-configuration` 先把 `status` 写成 `installed`，再尝试 `updateBindingState(..., "active")`。失败只 `console.warn("[employee-install.apply-configuration] re-enable binding failed:", bindErr)`，随后仍 `respond(true, { requestId, status, configurationState: "complete", ... })`。

| 层           | 源码形状                                                                                                 | 现场               |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------ |
| 安装关系     | 只存在安装请求记录。无配置项时确认函数先写 `installed`。这不是 `robotRelations`，也不是投影关系          | 未实测（只读源码） |
| 执行投影     | 本文件不调用物化。固定 `not_materialized`。不能标投影 `ready`                                            | 未实测（只读源码） |
| 运行时绑定   | `synced` 与 `reason` 只出现在 `console.warn`，或在 `userEmail` 为空时根本不调用。响应体没有结构化 reason | 未实测（只读源码） |
| 结论栏       | 响应可以在绑定未同步时仍为成功加 `installed`。不能当成主切片运行通过，也不能当成可用性 `ready`           | 未实测（只读源码） |
| 失败原因原文 | 扫描失败能进 `INVALID_REQUEST` 的 `error.message`。运行时同步失败的 reason 不在响应体                    | 未实测（只读源码） |

### 3.4 运行（下一次 loader）

符号：`resolveEmbeddedRunSkillEntries`（`src/agents/pi-embedded-runner/skills-runtime.ts`）返回 `{ shouldLoadSkillEntries, skillEntries, preferLiveEntries }`。`agentId` 非空时 `preferLiveEntries` 为真，经 `loadSkillExecutionBindingEntries`（`respectRuntimeBindingPause: true`）再 `mergeSkillEntriesWithBindings`。目录加载使用 `source: "openbot-lifecycle-binding"`（`sync.ts` 的 `loadSkillsFromDir`）。返回前调用 `applySkillPolicyToEntries`。因此这个函数交出去的 `skillEntries` 已经过策略过滤；「loader 看见名字」和「策略留下名字」在这一个返回值里没有分成两个数组。

`loadSkillExecutionBindingEntries` 在读目录失败时 `catch` 后返回 `[]`。磁盘错误与「没有投影」在这个返回值上同形。

`resolveRuntimeSkillPolicy` 仍在 `src/auto-reply/reply/runtime-skill-policy.ts`。本文没有追踪它的调用现场。

| 层           | 源码形状                                                                                                                                                 | 现场               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 安装关系     | 本函数不写 `robotRelations`                                                                                                                              | 未实测（只读源码） |
| 执行投影     | 只读取已物化目录。名字来自 `skillExecutionSkillName`。读失败变成空数组                                                                                   | 未实测（只读源码） |
| 运行时绑定   | `respectRuntimeBindingPause: true` 时会滤掉暂停名。这不是 `syncInstallToRuntime` 的 `synced` 字段                                                        | 未实测（只读源码） |
| 结论栏       | 正向证据必须是安装返回之后的另一次调用，且条目里有该净化名、来源链路为 `openbot-lifecycle-binding`。同一次安装响应、以及目录里刚写的文件，都不是这次调用 | 未实测（只读源码） |
| 失败原因原文 | 函数不返回投影 `reason`。未见名字时，原因要回到投影行；投影行的 reason 又被安装 RPC 丢掉                                                                 | 未实测（只读源码） |

### 3.5 撤销

符号：

- `robot-skills.remove` 调用 `removeRobotSkillAsset`，成功体就是 `{ ok: true }`。
- 函数从 `robotRelations` 去掉该 `(agentId, skillId)`。长度不变则抛 `SkillAssetStoreError`：`skill <id> is not installed on robot <agentId>`，RPC 为 `INVALID_REQUEST`。
- 写入成功后 `emitSkillRelationMutation({ op: "remove" })`。hook 再调 `syncSkillExecutionBinding`。关系已不在时该函数调用 `removeSkillExecutionBindingFiles`（`reason: "explicit-remove"`）。返回值仍被 hook 丢弃。hook 抛错仍被空 `catch` 吃掉，`removeRobotSkillAsset` 仍返回 `{ ok: true }`。
- `employee-install` 没有与 `removeRobotSkillAsset` 对等的请求撤销。对照入口完不成本步。

| 层           | 源码形状                                                                                              | 现场               |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------ |
| 安装关系     | 成功则该对 id 从 `robotRelations` 消失。响应是 `{ ok: true }`                                         | 未实测（只读源码） |
| 执行投影     | hook 可能删目录，结果不回传。`{ ok: true }` 不等于目录已删除                                          | 未实测（只读源码） |
| 运行时绑定   | 本函数不读、不改 `syncInstallToRuntime` 的绑定。安装时的 `synced` 不能沿用                            | 未实测（只读源码） |
| 结论栏       | 撤销通过还要看 RPC 完成之后的下一次 `resolveEmbeddedRunSkillEntries` 不再包含该名字。这次调用没有发生 | 未实测（只读源码） |
| 失败原因原文 | 未安装时的 store 文案能进 RPC。投影仍在时的原因不在 `{ ok: true }` 里                                 | 未实测（只读源码） |

撤销后的下一次 loader：整行 `未实测（只读源码）`。

幂等补行（同一机器人、同一技能再 `robot-skills.install`）：源码走更新已有关系的分支，不 push 第二条。投影目录是否仍是一份、loader 是否只加载一份，均 `未实测（只读源码）`。并发未测。

## 4. 本文作者有没有连上 Mac gateway

没有。撰写本文的文档代理没有访问 `127.0.0.1:18789`，没有发 gateway RPC，没有读 Mac 家目录，没有改配置。第 3 节全部来自 commit `277f6c5304b00142a180effcf2c0062fa9b0d5e3` 的 blob。

### 4.1 对照环境现场

来源：openbot 性能评测，2026-10-10 约 13:50 Asia/Shanghai，只读。本文转述，不把这次探测算成文档代理自己跑的 RPC，也不把它填进第 3 节的五步格子。

| 项                                             | 转述                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gateway SHA                                    | 仍为 `277f6c5304b00142a180effcf2c0062fa9b0d5e3`                                                                                                                                                                                                                |
| 证据                                           | pin、cwd HEAD、pid `66973`，端口 `18789` loopback                                                                                                                                                                                                              |
| `GET http://127.0.0.1:18789/health`            | HTTP 200，正文 `{"ok":true,"status":"live"}`                                                                                                                                                                                                                   |
| 点名的可读路径                                 | `~/.openbot/skills`、`skill-assets`、`skill-invocation-events`、`skill-execution-bindings`、`plugins/installs.json`、`diagnosis-projections`、sandbox skills、collaboration projections、gateway logs，以及 `openbot-ui-accept-tmp` 下的 accept-tmp skill logs |
| 配置                                           | 这次只读没有改配置                                                                                                                                                                                                                                             |
| HTTP `/api/skills`                             | 404                                                                                                                                                                                                                                                            |
| HTTP `/v1/skills`、`/skills`、`/health/skills` | SPA HTML 回退，不是技能 API                                                                                                                                                                                                                                    |

这些事实只说明 Mac 进程身份、健康端点、以及若干路径名当时可读。它们不包含技能资产内容、关系条数、投影文件、绑定 `synced`，也不包含五步 RPC。Mac 上 `/health` 的 `live` 是这台对照 gateway 的健康响应。HK LIVE 是另一条身份：commit `65564d30b25a41f49866f96e0efed9caacd80a9b`，RepoDigest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`（闸门 A 已完全通过，见 #550）。该健康响应也不是 #549 §5.2 的「真实执行上下文可见」。

点名路径与源码目录名的对应（仍是静态对照，不是目录清单）：

- `skill-assets` 对应 `STORE_DIR`（`skill-lifecycle-store.ts`）。
- `skill-execution-bindings` 对应 `resolveSkillExecutionBindingsRoot`（`paths.ts`）。
- `skill-invocation-events` 对应 `src/gateway/skill-invocation/event-store.ts` 的 `EVENTS_DIR_NAME`。调用事件不是本切片的安装关系。
- `employee-install.json` 不在这次点名列表里。不能据此推断对照请求存储空或非空。

## 5. 失败路径测试的意图（只列意图）

下面是以后写测试时可以瞄准的行为。本文不添加测试文件。

- `robot-skills.install` 在 hook 丢弃 `SyncSkillExecutionBindingResult` 时仍 `respond(true, { skill })`。断言要放在另一次 `resolveEmbeddedRunSkillEntries`，而不是同一次响应或同一次请求里刚写的文件。
- hook 抛错被 `emitSkillRelationMutation` 空 `catch` 吃掉后，安装仍返回 `{ skill }`，撤销仍返回 `{ ok: true }`。
- `getSkillRuntimeDefinitionForBinding` 抛错被收成 `reason: "explicit-remove"`，原始异常消失。
- `loadSkillExecutionBindingEntries` 读失败返回 `[]`，与目录不存在同形。
- 有 `userEmail` 时 `syncInstallToRuntime` 的 `{ synced: false, reason }` 不出现在 `robot-skills.install` 响应里；无邮箱时调用方不调用该函数。
- `executeInstallConfirmation` 在同步之前写 `installed`；`synced: false` 或抛错只有 `console.warn`；确认响应没有 `reason`。
- `apply-configuration` 先写 `installed`，重新激活失败仍成功响应。
- `external-local` 扫描失败抛出的句子应能出现在 `INVALID_REQUEST`。
- 带 `sourceAgentId` 的 draft 保存可能先写入关系，再由投影返回 `non-executable-lifecycle`，而该 reason 不在保存响应里。
- 同一 `(agentId, skillId)` 再次 `installSkillToRobotAsset` 更新原关系。第二条 `robotRelations` 才是幂等失败。并发不在本笔记的实测范围。

## 6. #549 §5.2 仍未勾选

执行勾选要求先有 §4.2 的现场行。本文第 3 节的现场列是 `未实测（只读源码）`，所以下列每一项都不勾。

- [ ] 创建或选择留下了 `skillId` 与 lifecycle；`draft` 没有被当成已可执行
  - 原因：没有创建或选择 RPC。源码只说明 draft 会得到 `removed` / `non-executable-lifecycle`，且该结果会被 hook 丢掉。
- [ ] 保存结果能再次读到，读到的位置是 skill-assets；失败时能看到 `SkillAssetStoreError` 文案
  - 原因：没有保存后再读。`skill-assets` 只被性能评测点名为可读路径，没有打开 `store.json`。
- [ ] 主切片安装后，关系、投影、绑定三行都有独立取值，没有用一个 `installed` 填满三行
  - 原因：没有 `robot-skills.install`。源码显示 `{ skill }` 填不满三行，但现场三行是空的。
- [ ] 真实执行上下文可见：安装返回之后的下一次 `resolveEmbeddedRunSkillEntries` 看见 `ob-asset-<skillId>`，来源是 `openbot-lifecycle-binding`
  - 原因：没有下一次 loader 调用。`/health` 200 不是这个证据。
- [ ] 同一次安装 RPC 内读回的文件或 `{ skill }` 响应，没有被用作上一条的证据
  - 原因：上一条本身未测，本条无从勾。
- [ ] 不得把 UI 的已安装、或 `employee-install` 的 `request.status=installed`，当成可用性 `ready`
  - 原因：源码支持这条禁令，但没有对照入口的现场请求。禁令未被一次执行证明，保持未勾。
- [ ] 对照入口在绑定未 `synced` 时，响应或笔记里能读到 `syncInstallToRuntime` 的 reason；只有 `console.warn` 时此项不勾
  - 原因：源码成功体没有 reason，只有 `console.warn`。按 #549 的句子，此项不勾。
- [ ] 投影失败或绑定失败时，原因可读（`reason` 或 RPC 错误文案），并且该机器人上其他原本有效的投影仍在
  - 原因：安装 RPC 不回传投影 reason 与绑定 reason。其他投影是否仍在，未看现场。
- [ ] 幂等：同一机器人、同一技能再安装一次，关系仍是一条，授权投影仍是一份，三行终态与第一次成功相同
  - 原因：只看到更新分支的源码，没有第二次安装。
- [ ] 撤销后下一轮不可用：`robot-skills.remove` 之后的下一次 `resolveEmbeddedRunSkillEntries` 不再包含该 `ob-asset-<skillId>`
  - 原因：没有 remove，也没有随后的 loader。
- [ ] 撤销 RPC 的 `{ ok: true }` 没有被单独当成上一条的证据
  - 原因：上一条未测。源码上 `{ ok: true }` 确实不能单独当投影已删的证据。

§5.1 的设计勾选仍属于 #549，不在本文件重勾。闸门 A 已完全通过（见 #550）。本文件不重勾那次验收，不勾 #549 §5.2，不宣称闸门 C。

## 7. 下一步

- 另写一份对照环境的 **live RPC** 笔记，才可能开始填第 3 节的现场列。那份笔记若仍钉 `277f6c5304b00142a180effcf2c0062fa9b0d5e3`，就是 Mac 对照实测，不是 HK LIVE 五步实测，也不能据此勾 #549 §5.2 里属于另一次执行的项，更不能宣称闸门 C。
- 闸门 A 已完全通过（见 #550）。HK LIVE commit 为 `65564d30b25a41f49866f96e0efed9caacd80a9b`，RepoDigest 为 `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`。Mac 对照 `277f6c53…` 与该 HK LIVE 不是同一个提交。
- 闸门 B 已于 #551 冻结；独立切片落地 PR 另开（测试先行、钉死对照 SHA）；本文件不混实现。本文不宣称闸门 C。
- `origin/main` 若再前进，技能路径 diff 要重做。本次空 diff 只覆盖第 2 节列出的七条路径，以及对照 SHA 与调查基线这一对 commit。
