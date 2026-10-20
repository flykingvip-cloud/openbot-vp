# 员工技能生命周期：端到端垂直切片设计与验收勾选

> **文档状态：草案 / 待独立验收勾选 / 未实施**
>
> 日期：2026-10-10
> 系统边界：**D0=A 已冻结**（产品负责人，2026-10-10）。对象是私有仓 `https://github.com/upbeyond/openbot` 的 gateway：员工技能资产、`employee-install`、执行投影、runtime binding。
> 本文是独立验收对 #545 / #546 给出「有条件通过（文档阶段）」之后的下一步，并且只到这一步。
> **本切片不落地产品代码。** 不改 `src/`、`ui/`、`extensions/`、`skills/`，不改测试，不改配置默认值，不改提示词，不改 `docs/tools/`、`docs/cli/`、`docs/zh-CN/`。
> **与闸门的关系：** 勾选本文「设计可执行」不等于闸门 A、闸门 B 或闸门 C 通过。闸门 A 因生产部署版本仍待核实，现在尚未通过。闸门 B 未通过前，禁止开 D5/D9 落地实施 PR。闸门 C 从切片真实执行开始；本文没有跑过切片。

十五分钟阅读路径：文首、§2 主切片、§3 五步、§4 三层记录、§5.1 设计可执行性勾选。§5.2 在真正跑 gateway 之前保持全空。

## 0. 本文件自洽范围

独立验收只凭本文件判断「切片设计是否可执行」。下面这些事实写在本文里，避免验收时再去翻未合入分支。

| 项 | 本文采用的值 |
| --- | --- |
| D0 | **A，已冻结。** B/C/D 不适用。公开仓 `https://github.com/CopilotKit/OpenBot` 的 `save_skill` / `skills.yaml` / Intelligence Learning 不进入本切片 |
| 分析 | 本私有仓 PR #545，标题「Docs: 员工端技能进化通道现状分析」，draft，未合入。分支 `cursor/employee-skill-lifecycle-analysis-05dc`。文件 `docs/design/employee-skill-lifecycle-channel-2026-10-10.md` |
| 方案 | 本私有仓 PR #546，标题「Docs: 员工端技能生命周期方案（D0=A 已冻结，实施仍暂缓）」，draft，未合入。分支 `cursor/employee-skill-lifecycle-opt-plan-aa8c`。文件 `docs/design/employee-skill-lifecycle-channel-optimization-plan-2026-10-10.md` 与 `docs/design/target-codebase-evidence-2026-10-10.md` |
| 独立验收结论 | #545 / #546 **有条件通过（文档阶段）**。允许写本切片设计与验收勾选。禁止据此宣称闸门 A 已通过 |
| 调查基线 | `93ce9df262b3666d83f64c559a5e7801e6bde089`。它是 #545 与方案初稿相对当时 `main` 的 base。源码行为描述以该 SHA 为准 |
| 撰写时的 `origin/main` | `833fb81bbc6e0cf12b98249c988d2f89a3fe52ab`（#544，`UI: 连接成功后才进入模型池，并接通企业自建提供方`）。相对调查基线只多这一笔。撰写时对 §3 所列技能路径做 `git diff 93ce9df… 833fb81bb`，结果为空。因此这些路径上的符号，调查基线与撰写时主干一致 |
| 生产部署版本 | **待核实。** 不得把调查基线或撰写时的 `main` 写成生产版本 |
| 公开仓同号 #545 | 编号撞车，另一仓库、另一主题。公开仓对 `employee-install`、`skill-lifecycle-store`、`runtime-binding-sync`、`install-pack-to-robot` 为 0 命中，这是预期 |

行号只对「调查基线与撰写时 `main` 上无 diff」的那些文件有效。开工前若这些文件相对调查基线出现 diff，行号作废，以符号名为准，并先完成 §6 的差异清单。

## 1. 切片目标与非目标

### 1.1 目标

本切片只定义一条可照着做的观测与验收规程。验收人要能沿着「创建或选择 → 保存 → 授权/安装 → 运行 → 撤销」记下三层状态，并判断当前实现离「下一轮真实可执行」还有多远。

1. 主切片能选定一条员工技能资产，装到一台机器人，并在**下一次** `resolveEmbeddedRunSkillEntries` 里观察 `ob-asset-<skillId>` 是否出现。
2. 撤销该关系之后，再下一次同一入口里，该投影不再出现。
3. 安装关系、执行投影、运行时绑定分三行记录。任何一行的成功都不能填满另外两行。
4. 验收笔记能指出失败原因来自哪一个符号的返回值或错误文案。读不到原因时，对应执行勾选保持未勾。
5. 对照入口 `employee-install.confirm` 单独记录。它的请求状态 `installed` 不能当作主切片的运行证据。

### 1.2 非目标

下列事项不在本切片的设计范围，也不在本轮交付里实施：

- 完整 D5 状态机改造：不新增四层字段，不改 `skill-assets` 或 `employee-install.json` 的 schema，不把 `installed` 的写入时机改成产品行为。
- D9 入口分类的产品落地：本文只借用方案里修订后的 D5 原则来规定**观测与验收怎么记**。绑定角色（必需 / 辅助 / `not_required`）的实施冻结属于闸门 B。
- 文档与 CLI 对齐实施：不改 `docs/tools/skills.md`、`docs/cli/skills.md`，不补 `openbot skills install` / `update`。CLI 现状仍是 `registerSkillsCli` 仅 `list` / `info` / `check`。
- `OPENBOT_SKILL_AUTO_EVOLUTION`、自动批准、`incubation.decide` 接 `submit-to-platform`、缺口 `actSkill` 自动变成可执行技能。
- gateway 内 ClawHub 客户端，以及缺技能时自动 `clawhub search/install`。
- 公开仓模型：不用 `save_skill`、`skills.yaml`、Bot 授权或 Intelligence Learning 的验收矩阵代替本切片。
- 文件系统技能栈的静默失败（缺依赖、策略拒绝、畸形 frontmatter）不并进本切片的安装状态。
- 孵化分数、`saveEffectTracking` 生产写入、企业拒绝与 `skill.lifecycle=rejected` 对齐。
- 把本切片铺到全部安装入口，或在本文之外同时改 Phase 2A / 2B / 3。

## 2. 主切片与对照入口

一次验收只走**一条主切片**。对照入口必须另记，不能代替主切片的「运行」证据。

### 2.1 主切片（能产生下一轮 loader 证据）

| 项 | 取值 |
| --- | --- |
| 技能 | 一条员工技能资产。lifecycle 属于 `EXECUTABLE_LIFECYCLES`：`private` / `reviewing` / `approved` / `published`。`assetType` 属于 `EXECUTABLE_ASSET_TYPES`：`capability`、`workflow`、`prompt`、`template`、`agent`、`tool`、`mcp`。`knowledge` 排除 |
| 机器人 | 一个稳定的 `agentId`。五步都用这一个 id |
| 运行入口 | 带该 `agentId` 的下一次 `resolveEmbeddedRunSkillEntries`（`src/agents/pi-embedded-runner/skills-runtime.ts`）。它会合并 `loadSkillExecutionBindingEntries`，来源标记为 `openbot-lifecycle-binding` |
| 投影文件 | `CONFIG_DIR/skill-execution-bindings/<agentId>/ob-asset-<skillId>/SKILL.md`。前缀常量是 `SKILL_EXECUTION_BINDING_PREFIX`（`src/gateway/skill-execution-binding/types.ts`）。默认 `CONFIG_DIR` 为 `~/.openbot` |
| 撤销入口 | `robot-skills.remove` → `removeRobotSkillAsset` |

「创建」若得到 `draft` / `rejected` / `retired`，主切片的运行步期望是**下一轮看不见**。要走到正向运行，创建之后先用现有 RPC `personal-skills.finalize-draft`（`finalizeDraftSkill`）把 lifecycle 升到 `private`，再进入授权/安装。本切片不新增 finalize 规则，只把这次已有 RPC 记在创建步的记录里。

### 2.2 对照入口（必须另记，不能充当运行通过）

`employee-install.confirm` / `employee-install.apply-configuration`（`src/gateway/server-methods/employee-install.ts`）。

当前实现不调用 `materializeSkillExecutionBinding`。请求落在 `~/.config/openbot/stores/employee-install.json`（`INSTALL_STORE_FILE`）。文件头写明这是支撑 UI 闭环的 Phase 1 stub。对照入口的运行期望是：即使 `request.status` 为 `installed`，也不得宣称下一轮 prompt 已有该技能。

`installSkillKeysOntoRobot`（`src/gateway/capability-packs/install-pack-to-robot.ts`）不作为本切片的必经步。若验收时碰巧观察到它，只按 §4 把关系、投影、绑定分三行记下，不把它的返回值 `installed` 算作主切片通过。

### 2.3 明确不走的入口

- `actSkill` / `draftProfileForGap` 写出的缺口草稿（`lifecycle=draft`，`autoInstallEnabled=false`）。
- 学习策展 `curateLearningSkillDrafts`、模式检测 `publish-draft-skill`。
- 环境变量 `OPENBOT_SKILL_AUTO_EVOLUTION`。默认关闭，且不自动批准。
- ClawHub CLI 写入 workspace `skills/` 的目录。那是文件系统栈的下一次发现，不是员工资产投影。
- 公开文档中的 `openbot skills install` / `update`。`src/cli/skills-cli.ts` 没有这两个子命令。

## 3. 五步范围

每一步都给出入口、调查基线上的已知行为、期望观测、失败时应见什么。已知行为来自 #545 分析、#546 方案 §1.4，以及调查基线上与撰写时 `main` 无 diff 的源码符号。

### 3.1 创建或选择

**入口**

- 选择已有资产：`personal-skills.detail` / `personal-skills.list`（`src/gateway/server-methods/skill-lifecycle.ts` 的 `skillLifecycleHandlers`）。
- 新建资产：`skill-lifecycle.save` → `saveSkillAsset`（`src/gateway/skill-lifecycle-store.ts`）。
- 仅当新建结果是 `draft`、又要继续走正向运行时：`personal-skills.finalize-draft` → `finalizeDraftSkill`。

**当前已知行为**

- `resolveInitialLifecycle`：调用方显式传入 lifecycle 时用该值；否则 `visibility=enterprise` → `reviewing`，`visibility=group` → `published`，其余（含 private）→ `draft`。
- `NON_EXECUTABLE_LIFECYCLES` 为 `draft` / `rejected` / `retired`。`EXECUTABLE_LIFECYCLES` 为 `private` / `reviewing` / `approved` / `published`。`isExecutableSkillProjectionEligible` 同时要求 `enabled` 且类型在 `EXECUTABLE_ASSET_TYPES`。`reviewing` 可投影是 `types.ts` 的显式规则；`saveSkillAsset` 附近相反注释不以注释为准。
- 缺 name 或 summary 时 `saveSkillAsset` 抛 `SkillAssetStoreError`（`skill name and summary are required`）。指定了已存在的 `skillId` 时抛 `skill <id> already exists`。RPC 经 `respondSkillError` 变成 `INVALID_REQUEST`，文案为 `error.message`。

**期望观测**

- 记录 `skillId`、`lifecycle`、`assetType`、`version`（新建时为 `1.0.0`）。
- 选择分支：lifecycle 已在 `EXECUTABLE_LIFECYCLES`，类型可执行。
- 创建分支停在 `draft`：记录「尚未可执行」，不进入 §3.4 的正向通过。
- 创建分支已 `finalizeDraftSkill`：lifecycle 变为 `private` 之后，才允许进入安装。

**失败时应见什么**

- RPC `ok=false`，`INVALID_REQUEST`，正文含 store 错误句（缺名称/摘要，或 id 冲突）。
- 没有 `skillId` 时停止，不安装、不投影。
- 不得把缺口草稿、自动进化日志或 ClawHub 目录当成这里的成功。

### 3.2 保存

**入口**

- 写入：`saveSkillAsset`，持久化在 `CONFIG_DIR/skill-assets/store.json`。
- 再读：`personal-skills.detail`（或 store 中同一 `skillId` 的记录）。

**当前已知行为**

- 成功返回 `{ skillId, detail }`，`version` 为 `1.0.0`，lifecycle 由 §3.1 的规则决定。
- 本步只确认资产落在 skill-assets。它不建立机器人关系，不写 `ob-asset-*`，不调用 `syncInstallToRuntime`。
- 员工安装请求存在另一文件 `~/.config/openbot/stores/employee-install.json`。那是对照入口的请求记录，不是本步的资产保存。

**期望观测**

- 用同一次保存返回的 `skillId` 再次读到同一 `lifecycle`、`version`、名称与摘要。
- 验收笔记写明读到的 store 路径是 skill-assets，而不是 employee-install.json。

**失败时应见什么**

- 再次读取缺失，或 lifecycle / 名称与保存返回值不一致：本步失败，原因写「保存后不可再读」或字段差异。
- store 抛错被上层吃掉、RPC 仍显示成功：记为失败原因不可读，§5.2 的「失败原因可读」不勾。
- 本步失败时不进入安装。

### 3.3 授权/安装

主切片与对照入口分开记。两套记录都使用 §4 的三列表，不能合成一个 `installed`。

#### 3.3.1 主切片：`robot-skills.install`

**入口**

- RPC `robot-skills.install`（`skill-lifecycle.ts`）。
- 顺序：若 registry 有条目且本地还没有该资产，会先 `saveSkillAsset`（显式 `lifecycle: "published"`）；然后 `assertRobotSkillInstallAllowed`；然后 `installSkillToRobotAsset`。
- 关系写入在 `installSkillToRobotAsset`：已有 `(agentId, skillId)` 则更新 `enabled=true` 与 `installedVersion`，否则 push 一条关系。随后 `emitSkillRelationMutation({ op: "install" })`。
- 投影 hook：`ensureSkillExecutionBindingHooksRegistered`（`src/gateway/skill-execution-binding/register-hooks.ts`，gateway 启动时注册）调用 `syncSkillExecutionBinding`，**不读取** `SyncSkillExecutionBindingResult`。
- `emitSkillRelationMutation` 对 hook 异常空 `catch`，注释为 hooks must not break asset mutations。
- 当连接上带有 `userEmail` 时，同一 RPC 还会 `await syncInstallToRuntime({ cfg, userEmail, capabilityId: skillId })`，不传 `targetRobotId`，也不读取 `synced` / `reason`。无抛错时 RPC `respond(true, { skill })`。

**当前已知行为**

- 关系已写入，或 RPC 返回 `{ skill }`，都不证明 `ob-asset-<skillId>/SKILL.md` 已物化，也不证明绑定 `synced`。
- `syncSkillExecutionBinding` 的结果是 `materialised` / `removed` / `skipped`。`skipped` 的 reason 含 `missing-ids`。不可执行时 `materializeSkillExecutionBinding` 删除目录并返回 `removed`，reason 为 `disabled`、`non-executable-lifecycle` 或 `non-executable-asset-type`。
- `syncInstallToRuntime`（`src/gateway/runtime-binding-sync.ts`）在失败时返回 `synced: false` 与 reason，而不是抛错。reason 包括 `missing-user`、`platform-auth-disabled`、`user-not-found`、`membership-not-found`、`registry-entry-not-found`、`target-runtime-agent-not-found`、`runtime-agent-not-found`。主切片 RPC 今天会丢掉这个返回值。个人资产往往没有 registry 条目，因此常见结果是 `registry-entry-not-found`，同时投影仍可能已经物化。

**期望观测**

- 关系行：`skill-assets` 的 `robotRelations` 里，该 `(agentId, skillId)` **只有一条**，`enabled=true`，`installedVersion` 等于资产版本。记为关系 `linked`。这是验收笔记用词，不是新 schema。
- 投影行：单独查看 `syncSkillExecutionBinding` 的 `action`，或查看投影目录是否出现 `SKILL.md`。`action=materialised` 且文件在 `ob-asset-<skillId>/` 下，记为投影 `ready`。hook 把异常吃掉或返回值被忽略时，投影记为 `pending` 或 `failed`，并写明「返回值未被安装 RPC 保留」。
- 绑定行：若本次 RPC 带了 `userEmail`，绑定不是 `not_required`。必须单独记下 `synced` 与 `reason`。读不到返回值时记为 `pending`，reason 写「`robot-skills.install` 未回传 `syncInstallToRuntime` 结果」。未带 `userEmail` 时，绑定记为本次调用未执行，reason 写 `missing-user`（函数在空邮箱上的返回值），不得记成 `synced`。
- 可用性：只有投影 `ready`，且下一轮 §3.4 看见该技能时，验收笔记才写可用性 `ready`。绑定失败而投影已物化时，笔记写 `degraded` 或「绑定未同步、投影另计」，不得写安装成功。

**失败时应见什么**

- `assertRobotSkillInstallAllowed` 或 store 拒绝：RPC `INVALID_REQUEST`（`SkillAssetStoreError`）或 `UNAVAILABLE`（其他错误），正文是错误文案。关系条数不变。
- 关系写入成功、投影 `removed`/`skipped`：三行分开。失败原因使用 `SyncSkillExecutionBindingResult.reason`。读不到 reason 时，执行勾选「失败原因可读」不通过。
- 绑定 `synced: false`：原因使用上列 reason 之一。不得因为 RPC `{ skill }` 或 UI 已安装而把绑定改成 `synced`。
- 投影失败时，不得删除该机器人上更早已经有效的其他技能关系。本切片若只安装这一条新关系，允许在笔记里记录「这条新关系是否仍在」；本文不要求产品自动回滚。

#### 3.3.2 对照：`employee-install.confirm`

**入口**

- `employee-install.create-request` → `employee-install.confirm` → 需要配置时再 `employee-install.apply-configuration`。
- 确认函数是 `executeInstallConfirmation`。无 `requiredConfiguration` 时，在调用 `syncInstallToRuntime` **之前**把 `request.status` 写成 `installed`。`userEmail` 为空则整段同步跳过，状态仍是 `installed`。`synced: false` 或抛错只 `console.warn`。
- `apply-configuration` 同样先写 `installed`，再尝试把 binding 重新激活；失败只 warn，RPC 仍成功。

**当前已知行为**

- 该状态表示安装请求记录，不表示 `ob-asset-<skillId>/SKILL.md` 已物化，也不表示 `syncInstallToRuntime` 返回了 `synced: true`。
- 持久化与 skill-assets 分裂。排障时「装过」可能只存在于 `employee-install.json`。

**期望观测**

- 关系行：只记录请求 id 与 `request.status`。文案停在「请求已标记 installed」。不把它抄进技能投影关系。
- 投影行：固定记「本入口未物化」。不标投影 `ready`。
- 绑定行：记录 `synced` 与 `reason`。今天 reason 只出现在 warn 日志里；验收人若只能看到 `installed`、看不到 reason，绑定记 `failed` 或 `pending`，reason 写「仅有 console.warn，响应体无结构化原因」。

**失败时应见什么**

- `external-local` 且扫描未通过：`executeInstallConfirmation` 抛「扫描结果无效或未通过，无法确认安装」。这是该入口上能直接读到的失败文案。
- 运行时同步失败：响应仍可能是成功加 `installed`。验收把这种现象记成对照入口失败，而不是主切片运行通过。
- 不得用该入口推断下一轮 prompt 含有技能。

### 3.4 运行

**入口**

- 安装 RPC **返回之后**，另一次调用 `resolveEmbeddedRunSkillEntries`，参数里的 `agentId` 与安装时相同。
- 该函数在有 `agentId` 时走 live binding：`loadSkillExecutionBindingEntries` → `mergeSkillEntriesWithBindings`。技能名形如 `ob-asset-<skillId>`（`skillExecutionSkillName`）。

**当前已知行为**

- 同一次 `robot-skills.install` 或 `employee-install.confirm` 响应里带回的对象，只说明这次 RPC 写了什么。它不是下一轮加载。
- 直接检查投影目录里文件存在，同样只是实现笔记，不能勾选本步。
- 工具策略仍可能在 loader 之后滤掉技能（`resolveRuntimeSkillPolicy`，`src/auto-reply/reply/runtime-skill-policy.ts`）。本切片把「loader 条目里看得见」和「策略是否留下」分成两行笔记。策略滤掉时，投影观测保持原记录，可用性不写 `ready`，原因写策略过滤。本文不要求改变策略。

**期望观测**

- 正向通过的唯一证据：下一次 `resolveEmbeddedRunSkillEntries` 的 `skillEntries` 含该 `ob-asset-<skillId>`，且来源链路是 `openbot-lifecycle-binding`。
- `draft` / 被 `isExecutableSkillProjectionEligible` 拒绝的资产：下一次条目里没有该名字。这是创建步停在 draft 时的正确结果。
- 对照入口即使 `installed`，本步仍以主切片的 loader 为准。对照入口单独不能勾运行通过。

**失败时应见什么**

- 下一次条目没有该名字：运行失败。原因优先抄投影行的 `reason`；投影行仍是 `pending` 且没有 reason 时，写「下一轮未见，且安装路径未保留投影结果」。
- loader 可见但策略滤掉：运行可用性失败，原因写策略过滤，投影行不改成 `failed`。
- 只在安装请求内部读到刚写的 `SKILL.md`：本步不通过。

### 3.5 撤销

**入口**

- 主切片：`robot-skills.remove` → `removeRobotSkillAsset`。
- 函数从 `robotRelations` 去掉该 `(agentId, skillId)`，再 `emitSkillRelationMutation({ op: "remove" })`。
- hook 再次调用 `syncSkillExecutionBinding`。关系已不在时，该函数走 `removeSkillExecutionBindingFiles`。

**当前已知行为**

- 关系本来就不存在时抛 `SkillAssetStoreError`：`skill <id> is not installed on robot <agentId>`，RPC 为 `INVALID_REQUEST`。
- hook 异常仍被 `emitSkillRelationMutation` 吃掉。因此「remove RPC 返回 `{ ok: true }`」不等于投影目录已经删除，也不等于下一轮 loader 已经看不见。
- `employee-install` 的请求状态没有与 `removeRobotSkillAsset` 对等的撤销。对照入口不能用来完成本步。

**期望观测**

- 关系行：该 `(agentId, skillId)` 已从 `robotRelations` 消失。
- 投影行：记为不再 `ready`（目录删除，或 sync 结果为 `removed`）。
- 绑定行：若安装时曾 `synced`，撤销后的绑定状态单独再读一次 agent runtime binding；读不到则记「未复核」，不得沿用安装时的 `synced`。
- 运行复核：撤销 RPC 完成之后，**再下一次** `resolveEmbeddedRunSkillEntries` 的条目里没有 `ob-asset-<skillId>`。

**失败时应见什么**

- 关系未安装：RPC 错误文案如上，停止，不把空撤销当成通过。
- RPC 成功但下一次 loader 仍包含该名字：撤销失败。原因写「关系已解除，投影仍被下一轮加载」或 hook 异常被吞。
- 撤销弄掉了同一机器人上其他仍然有效的技能：超出本切片，记为失败，不继续宣称通过。

## 4. 状态记录要求

对齐 #546 修订后的 D5 原则：**安装关系、执行投影、运行时绑定分开记录。** 任何一层成功都不能填满其他层。`installed` 若出现，只允许抄进关系行，作为旧字段或请求状态的原样引用。

本文件只定义观测与验收。**不要求改 store schema，不要求产品开始写入四层字段。** 验收人把下表填在本切片的笔记里。历史数据只有 `installed=true` 时：关系按 `linked` 记；投影保持 `pending`，直到本表的投影行被一次核对写成 `ready` 或 `failed`；绑定未知时记 `pending`，不得直接写成 `synced`；可用性不得默认 `ready`。

### 4.1 三行的含义（验收笔记用词）

| 层 | 笔记允许的值 | 从哪里读（现有数据，不新写字段） | 禁止的推断 |
| --- | --- | --- | --- |
| 安装关系 | `requested` / `linked` / `absent` | 主切片：`robotRelations` 中该 `(agentId, skillId)`。对照入口：`employee-install.json` 的 `request.status`，原样另记，不升级成技能关系 | 关系 `linked` 或请求 `installed` 推出投影 `ready`、绑定 `synced`、可用性 `ready` |
| 执行投影 | `pending` / `ready` / `failed` / `not_materialized` | `SyncSkillExecutionBindingResult.action` 与 `reason`；投影路径 `CONFIG_DIR/skill-execution-bindings/<agentId>/ob-asset-<skillId>/SKILL.md`。对照入口固定 `not_materialized` | 同一次 RPC 里文件刚写好，就记成下一轮 `ready` |
| 运行时绑定 | `not_required` / `pending` / `synced` / `failed` | `syncInstallToRuntime` 的 `synced` 与 `reason`。主切片在未调用该函数时记 `not_required` 或 `pending`（见 §3.3.1），不记 `synced` | 用投影目录存在推出绑定已同步；用 warn 日志的缺失推出成功 |

可用性 `ready` / `degraded` / `failed` 只出现在验收笔记的结论栏，不要求写回 gateway。`ready` 还要 §3.4 的下一次 loader 证据。投影 `ready` 且绑定失败时，笔记用 `degraded`，文案写明原因，不写「安装成功」。

### 4.2 空白记录表（执行时填写，本轮留空）

| 步 | 安装关系 | 执行投影 | 运行时绑定 | 结论栏（仅笔记） | 失败原因原文 |
| --- | --- | --- | --- | --- | --- |
| 创建或选择 |  |  |  |  |  |
| 保存 |  |  |  |  |  |
| 授权/安装（主切片） |  |  |  |  |  |
| 授权/安装（对照 employee-install） |  |  |  |  |  |
| 运行（下一次 loader） |  |  |  |  |  |
| 撤销 |  |  |  |  |  |
| 撤销后的下一次 loader |  |  |  |  |  |

幂等补行：对同一机器人、同一技能再执行一次 `robot-skills.install` 后，关系仍是一条，`ob-asset-<skillId>` 目录仍是一份。终态三行与第一次成功后的笔记一致。出现第二条 `robotRelations` 或第二份仍被 loader 加载的投影，幂等失败。

并发不在本切片必测。全量 Phase 1 才要求重叠安装最终只有一条关系。本切片不把「未测并发」写成已通过。

## 5. 验收勾选清单

两组勾选分开。

- **§5.1** 判断这份设计能不能被照着做。独立验收只读本文件即可勾。每一项的依据都在本文对应小节，不依赖未合入的 #545 / #546 正文。
- **§5.2** 判断切片有没有在真实 gateway 上跑过。本文交付时全部保持未勾。勾选 §5.1 不会使 §5.2 成立。

当前实现预期会让 §5.2 里若干项保持未勾，尤其是「不得把 `installed` 当成 ready」和「绑定失败原因出现在响应里」。那是调查基线上已经写明的行为。§5.2 未勾不否定 §5.1。用 §5.2 的未勾反过来宣称闸门 C 已通过，同样不成立。

### 5.1 设计可执行性（独立验收勾选）

- [ ] 文首写明 D0=A 已冻结，并引用本私有仓 #545 与 #546，以及「有条件通过（文档阶段）」
- [ ] 写明本文件不落地产品代码，且勾选设计不等于闸门 A/B/C 通过
- [ ] 非目标写明：完整 D5 状态机改造、文档/CLI 对齐实施、auto-evolution、ClawHub、公开仓模型
- [ ] 主切片路径唯一：可执行 lifecycle 的资产，经 `robot-skills.install`，到下一次 `resolveEmbeddedRunSkillEntries`，再经 `robot-skills.remove`
- [ ] 五步各自写了入口模块路径、当前已知行为（含符号）、期望观测、失败时应见什么
- [ ] `employee-install.confirm` 被标成对照入口，其 `installed` 不能代替主切片的运行证据
- [ ] 安装关系、执行投影、运行时绑定要求分开记录，并写明本切片不改 store schema
- [ ] 写明同一次请求内读回刚写文件不算运行通过；撤销后要再看下一次 loader
- [ ] 写明重复安装的幂等观测（一条关系、一份投影），以及失败原因要能从错误文案或 `reason` 读到
- [ ] 写明实施前必须再核对当时的 `main` HEAD 与生产版本相对调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089` 的差异
- [ ] 后续实施 PR 只作为建议，且写明闸门 B 之前不开 D5/D9 落地 PR

§5.1 全部勾选的含义只有一句：切片设计可执行。它不表示切片已跑、生产已核对、或员工端安装已经可用。

### 5.2 切片执行验收（未实施；交付时保持未勾）

执行人按 §4.2 填表后再勾。缺一行记录就不得勾对应项。

- [ ] 创建或选择留下了 `skillId` 与 lifecycle；`draft` 没有被当成已可执行
- [ ] 保存结果能再次读到，读到的位置是 skill-assets；失败时能看到 `SkillAssetStoreError` 文案
- [ ] 主切片安装后，关系、投影、绑定三行都有独立取值，没有用一个 `installed` 填满三行
- [ ] 真实执行上下文可见：安装返回之后的下一次 `resolveEmbeddedRunSkillEntries` 看见 `ob-asset-<skillId>`，来源是 `openbot-lifecycle-binding`
- [ ] 同一次安装 RPC 内读回的文件或 `{ skill }` 响应，没有被用作上一条的证据
- [ ] 不得把 UI 的已安装、或 `employee-install` 的 `request.status=installed`，当成可用性 `ready`
- [ ] 对照入口在绑定未 `synced` 时，响应或笔记里能读到 `syncInstallToRuntime` 的 reason；只有 `console.warn` 时此项不勾
- [ ] 投影失败或绑定失败时，原因可读（`reason` 或 RPC 错误文案），并且该机器人上其他原本有效的投影仍在
- [ ] 幂等：同一机器人、同一技能再安装一次，关系仍是一条，授权投影仍是一份，三行终态与第一次成功相同
- [ ] 撤销后下一轮不可用：`robot-skills.remove` 之后的下一次 `resolveEmbeddedRunSkillEntries` 不再包含该 `ob-asset-<skillId>`
- [ ] 撤销 RPC 的 `{ ok: true }` 没有被单独当成上一条的证据

## 6. 闸门映射

| 闸门 | 本文所处位置 | 通过本文不能得出的结论 |
| --- | --- | --- |
| A 基线确认 | D0=A 已冻结。四个调查基线 permalink 见证据索引与 #546。撰写时主干比调查基线多 #544，且 §3 技能路径 diff 为空。生产版本 **待核实** | 闸门 A 已通过。调查基线是当前生产事实 |
| B 状态机与失败语义冻结 | 本文使用 D5 的分层记录方式做验收笔记。D5/D9 在 #546 §7 仍是未勾选的决定。本文不附上「四层字段如何映射进现有授权与工具筛选」的实施说明 | 闸门 B 已通过。可以改产品里的分层状态，或把 `installed` 的写入时机改掉 |
| C 端到端集成验收 | 本文给出切片五步与 §5.2。§5.2 未勾。#546 §6 矩阵是切片执行通过之后的全量矩阵，不是本文件的勾选对象 | 闸门 C 已通过。员工端安装已经验收完成。可以扩对外文档或孵化指标 |

### 6.1 实施前义务

任何后续实施 PR 开工前，执行人必须重新做下面的核对。本文撰写时的差异**不能**代替那一次核对。

1. `git fetch origin main`，记下当时的 `main` HEAD。
2. 与调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089` 比较。至少覆盖 `src/gateway/server-methods/employee-install.ts`、`src/gateway/runtime-binding-sync.ts`、`src/gateway/capability-packs/install-pack-to-robot.ts`、`src/gateway/skill-lifecycle-store.ts`、`src/gateway/skill-execution-binding/`、`src/gateway/server-methods/skill-lifecycle.ts`、`src/agents/pi-embedded-runner/skills-runtime.ts`。
3. 差异非空时，先列出差异，再决定本文的符号描述是否仍然可用。不得沿用失效行号。
4. 读取生产部署版本（运行中的构建标识，而不是本机分支名）。未读到之前，闸门 A 保持未通过。
5. 生产 SHA 与调查基线或当时 `main` 不同时，把差异写进实施 PR，再决定是否沿用本切片。

撰写时已经知道、且只覆盖这次 fetch 的差异：

- `origin/main` = `833fb81bbc6e0cf12b98249c988d2f89a3fe52ab`（#544）。
- 相对调查基线，上列技能路径 diff 为空。
- 生产部署版本没有在本轮读取。

## 7. 建议的后续实施 PR 边界

以下只是建议。本轮不实现，不授权开工。

### 7.1 现在还不许开的 PR

- 闸门 B 通过之前，修改 D5 四层状态的产品写入、或按 D9 改变绑定门槛的实施 PR。
- 把本切片和 Phase 2A（对外文档、CLI、系统提示词）、Phase 2B（缺口 surface、finalize 门槛）、Phase 3（孵化标注、auto-evolution）合成一个 PR。
- 补 `openbot skills install` / `update`，或在 gateway 增加 ClawHub 客户端。
- 打开 `OPENBOT_SKILL_AUTO_EVOLUTION`，或让 `incubation.decide` 调用平台提交。
- 迁移 `employee-install.json`（方案 D6 的默认仍是不迁移）。
- 手改 `docs/zh-CN/**`。

### 7.2 建议的顺序（仍须另批）

1. **独立验收勾选本文 §5.1。** 这是设计关。通过之后才有资格谈实现。§5.2 仍空着。
2. **开工前重做 §6.1。** 生产仍待核实则闸门 A 仍未通过，产品 PR 继续停。
3. **闸门 B 之后的切片实施 PR（独立于本文）。** 范围只含主切片五步：
   - 先加失败路径测试，再改实现。测试要调用下一次 `resolveEmbeddedRunSkillEntries`，而不是在同一次请求里断言文件存在。
   - 允许触及的路径限于：`src/gateway/server-methods/skill-lifecycle.ts` 中 `robot-skills.install` / `robot-skills.remove` 的结果汇报、`src/gateway/skill-lifecycle-store.ts` 的安装/撤销信号、`src/gateway/skill-execution-binding/register-hooks.ts` 对 sync 返回值的处理、`src/gateway/server-methods/employee-install.ts` 在绑定未 `synced` 时不再把请求显示成可执行、以及对应测试。
   - `runtime-binding-sync.ts` 只消费既有 reason，不改成物化 `SKILL.md` 的实现。
   - 不在这个 PR 里给 store 增加四层 schema，除非闸门 B 的映射说明已经写明这些字段如何对应现有 `robotRelations`、`EXECUTABLE_LIFECYCLES` 和 runtime binding，避免第二套总开关。
   - 不改 `src/agents/system-prompt.ts`，不改 `docs/tools/` 与 `docs/cli/`。
4. **§5.2 被真实执行勾选之后**，才允许另开 PR 把 Phase 1 铺到 `installSkillKeysOntoRobot` 等其余入口，并开始 #546 §6 矩阵。
5. Phase 2A、2B、3 各自独立 PR，排在切片执行通过之后，互不夹带 `skill-lifecycle-store.ts` 的未合入改动。

### 7.3 切片实施 PR 的验收入口

实施 PR 的描述要引用：本文、已勾选的 §5.1、闸门 B 的映射说明、以及 §6.1 的 HEAD / 生产核对。缺少其中任何一项，就还停在本文的文档阶段。

## 8. 本轮边界

- 本轮只新增本文件。没有修改产品逻辑、测试、配置、提示词或对外工具文档。
- 未跑 gateway，未打开员工 UI，未访问生产。§5.2 因此保持未勾。
- #545 与 #546 在撰写时仍是 open draft。本文把验收所需事实抄进 §0 与 §3，避免设计可执行性依赖那两份未合入文件的正文。
- 调查基线上的 `installed` 写法保持原样。本文不批准用其他补丁绕过它。
