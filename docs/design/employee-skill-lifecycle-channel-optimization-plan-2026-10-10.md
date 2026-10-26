# 员工端技能生命周期通道：优化方案（专家验收）

> **修订说明：** 2026-10-10 第一轮重写了 D5，并增加 D9 与三道闸门。同日第二轮要求先确认系统边界。同日产品负责人确认 **D0=A**。
>
> **文档状态：D0=A 已冻结 / 完整实施仍暂缓 / 下一步仅允许端到端垂直切片设计与验收勾选 / 未实施产品改动**
>
> 日期：2026-10-10
> **D0=A 已由产品负责人确认（2026-10-10）。** 系统边界是私有仓 `https://github.com/upbeyond/openbot` 的 gateway：员工技能资产、`employee-install`、执行投影、runtime binding。B、C、D 不适用。公开仓附录保持「不适用 D0=A」。
> 完整实施仍暂缓。下一步工作包只写垂直切片的范围和验收勾选，不写实现代码。D5/D9 落地须闸门 B 通过后再开独立实施 PR。
> **本轮禁止产品改动**（含产品逻辑、测试落地、配置默认值、提示词与对外文档修改）。

十五分钟阅读路径：文首状态、§0、§5 下一步工作包、§7.1 的 D0 勾选。公开仓附录不要当作本仓验收。

## 系统边界 / 证据追溯

本轮已核实的身份与引用如下。生产运行版本未核实。Permalink 清单另见 `docs/design/target-codebase-evidence-2026-10-10.md`。

| 项                          | 结论                                                                                                                                                                                                                                      | 状态                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| D0                          | **A。** 产品负责人于 2026-10-10 确认。对象是本私有仓 gateway 的员工技能资产 / employee-install / 投影 / runtime binding                                                                                                                   | 已冻结                               |
| 目标仓库                    | 私有仓库 `https://github.com/upbeyond/openbot`（`visibility=private`）                                                                                                                                                                    | 已核实                               |
| 与公开仓的关系              | 不是公开的 CopilotKit/OpenBot。公开仓上编号同为 #545 的 PR 是另一仓库、另一主题。这是编号撞车，不是本文件写错了本仓库内的 PR 号                                                                                                           | 已核实                               |
| 本仓库 PR #545              | 标题「Docs: 员工端技能进化通道现状分析」。draft，未合入。分支 `cursor/employee-skill-lifecycle-analysis-05dc`。文件 `docs/design/employee-skill-lifecycle-channel-2026-10-10.md`                                                          | 已核实                               |
| 本仓库 PR #546              | 本优化方案。draft。分支 `cursor/employee-skill-lifecycle-opt-plan-aa8c`。文件即本文                                                                                                                                                       | 已核实                               |
| 调查基线                    | `93ce9df262b3666d83f64c559a5e7801e6bde089`。它是 #545 与本方案初稿开出时相对当时 `main` 的 base。§1.4 的源码复核发生在该 SHA。只称为**调查基线**                                                                                          | 已核实                               |
| 修订时的 `origin/main`      | `833fb81bbc6e0cf12b98249c988d2f89a3fe52ab`：`UI: 连接成功后才进入模型池，并接通企业自建提供方`（#544）。相对调查基线只多这一笔，且不修改本文、不修改 #545 的分析文件。调查基线因此不等于修订时的主干 HEAD                                 | 已核实（2026-10-10 fetch）           |
| 实施前的基线义务            | 开工前须再核对当时的 `main` HEAD，以及生产部署版本，是否仍等于调查基线。若不同，须列出差异后再决定是否沿用本文结论。不得把调查基线默认当成当时的主干或生产版本。上表这一笔差异只覆盖本次修订时的 fetch，不代替开工前的再核对              | 规则；主干差异已列一笔，生产尚未核对 |
| 生产运行版本、本机部署 HEAD | 本轮无生产访问                                                                                                                                                                                                                            | **待核实**                           |
| 调查基线上的四个源码文件    | 均存在且可读，见下方 permalink。`employee-install.ts` 文件头自称 Phase 1 stub；confirm 在 sync 失败时仍可把请求标成 `installed`（约第 391 行）。这与 §1.4 一致                                                                            | 已核实                               |
| 公开仓代码搜索              | 在 `https://github.com/CopilotKit/OpenBot` 搜索 `employee-install`、`skill-lifecycle-store`、`runtime-binding-sync`、`install-pack-to-robot` 为 **0 命中**。公开仓 PR #545 是另一主题。公开仓找不到这些路径是预期，不能据此否定私有仓分析 | 已核实                               |

源码结论（§1，尤其 §1.4）描述的是私有仓调查基线上的代码。闸门 A 未通过时，这些结论不能当成「当前生产已逐项复核」。它们也不是公开仓 CopilotKit/OpenBot 的架构说明。

### 与公开仓 CopilotKit/OpenBot 的差异

本方案的证据仓库是私有仓 `https://github.com/upbeyond/openbot`。它不是公开仓 `https://github.com/CopilotKit/OpenBot`。

公开仓的架构文档、skill-tools、tenant-package、`skills.yaml` 部署包，不能用来否定或替代下面四个私有仓文件。专家若在公开仓搜索不到这些路径，结论应是「看错了仓库」，而不是「私有仓分析无源码」。

调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089` 上的 permalink：

1. [`src/gateway/server-methods/employee-install.ts`](https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/server-methods/employee-install.ts)
2. [`src/gateway/runtime-binding-sync.ts`](https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/runtime-binding-sync.ts)
3. [`src/gateway/capability-packs/install-pack-to-robot.ts`](https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/capability-packs/install-pack-to-robot.ts)
4. [`src/gateway/skill-lifecycle-store.ts`](https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/skill-lifecycle-store.ts)

`employee-install.ts` 文件头写明：当前为 stub，用来支撑 UI 闭环验证；后端持久化与运行时同步在后续阶段完善。confirm 路径在 `syncInstallToRuntime` 失败或未执行时仍可把 `request.status` 写成 `installed`。

### 三套「技能」不得混谈

同名「技能」在三个系统里不是同一件事。后文的投影、`installed`、runtime binding，只描述表中第三行。

| 概念                               | 所在系统                           | 已核实或专家指出的机制                                                                                                                                            | 本文件何时适用                           |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 应用内技能                         | 公开仓 CopilotKit/OpenBot          | 指令不等于能力授权。`save_skill` 须人工确认。保存后不自动分配 Bot。部署包使用 `skills.yaml`，不是本仓的 `SKILL.md` 投影加 runtime binding                         | 仅当 D0=B。验收见文末附录，不得套到 D0=A |
| Intelligence Learning 技能         | 公开仓 CopilotKit/OpenBot          | 与应用内技能是另一套 Learning 运行时。本文件不描述其内部状态机                                                                                                    | 仅当 D0=C。选 C 表示本方案不是实施合同   |
| 员工技能资产 + 文件系统 `SKILL.md` | 私有仓 upbeyond/openbot 的 gateway | 资产在 `skill-assets`；投影为 `ob-asset-<skillId>/SKILL.md`；安装向导在 `employee-install.ts`；绑定在 `runtime-binding-sync.ts`。文件系统技能由 loader 从目录发现 | **D0=A，已确认。** 本方案只操作这一行    |

## 0. 执行摘要

1. D0=A 已由产品负责人确认并冻结（2026-10-10）。完整实施仍暂缓。产品代码仍未改。
2. 下一步只允许写垂直切片的设计与验收勾选：创建或选择 → 保存 → 授权/安装 → 运行 → 撤销。验收要看到真实执行上下文，以及撤销后下一轮不可用。
3. D5/D9 仍是设计原则。落地分层状态机须闸门 B 通过后另开实施 PR，不放进切片设计这一步。
4. 公开仓 CopilotKit/OpenBot 搜不到上述四个路径，这是预期。文末附录不适用 D0=A。
5. 调查基线仍是 `93ce9df…`。生产部署版本 **待核实**。自动进化默认关闭，不自动批准，不补 `openbot skills install`。

## 1. 现状盘点

以下为私有仓 #545 分析文档的压缩复述，加上调查基线上的源码复核。它只在 D0=A 时成立。细节以该分析 §1–§4 为准。若 D0=A，目标语义以 D5/D9 为准，不再以「单一 installed 谓词」为目标。D0 未勾选时，本节是证据，不是开工许可。

### 1.1 两条栈

| 栈           | 发现物                                            | 持久化                                                                 | 进入同一次 turn                                                                             |
| ------------ | ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 文件系统技能 | `SKILL.md`                                        | bundled / managed / workspace / extra / plugin / 两级 `.agents/skills` | `loadWorkspaceSkillEntries` → `resolveEmbeddedRunSkillEntries` → 系统提示词与普通工具       |
| 员工技能资产 | `EmployeeSkillProfile` + `SkillRuntimeDefinition` | `CONFIG_DIR/skill-assets/store.json`                                   | 机器人关系变更 → `syncSkillExecutionBinding` → `ob-asset-<skillId>/SKILL.md` → 同上一次加载 |

员工资产在物化之前不是 Pi loader 的技能目录。`draft` / `rejected` / `retired` 不进执行投影（`NON_EXECUTABLE_LIFECYCLES`）。`private` / `reviewing` / `approved` / `published` 可进投影（`EXECUTABLE_LIFECYCLES`）。`reviewing` 可执行是 `types.ts` 的显式注释：所有者在企业审核期间可以把完整资产装到自己的机器人。`saveSkillAsset` 附近仍有「跳过 draft/reviewing」的相反注释，以 `isExecutableSkillProjectionEligible` 为准。

ClawHub 不在 gateway TypeScript 客户端里。外部 CLI 若把目录写入 workspace `skills/`，下一次会话才作为 workspace 技能被发现。

### 1.2 缺技能决策

未找到单一函数在「检索外部源」与「自己创建技能」之间做优先级选择。实际路径按请求顺序并列存在：

| 层                  | 入口                                               | 实际行为                                                                                                                     |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 成长门控            | `shouldBlockGrowthTaskSend`                        | 仅首条 mission，且用户未点 proceed。候选来自模板 + `listSkillRecommendations`。禁止发明目录外 key。后续任务直接放行          |
| 执行预检            | `resolvePrimary`                                   | 无 skill contract 时 `decisionCode = "no_skill_contract"`，不安装、不检索                                                    |
| 系统提示词          | `buildUserVisibleReplySection`                     | 能力不够时打一次 `[[capability_gap:...]]`。`buildDocsSection` 要求不要把用户导向第三方 registry                              |
| 缺口摄入            | `recordHonestCapabilityGap`                        | 记事件。store 抛错被吃掉，不让回复失败                                                                                       |
| 缺口消费            | `actSkill` / `actTool`                             | scheduler 上，离开本 turn。skill 类写 `lifecycle=draft` 且 `autoInstallEnabled=false`；tool 类交 governance proposal，不安装 |
| 诊断                | `install_existing_skill`                           | 只提议安装已有 skillId。live auto-submit 未接线。`capability.skill-spec` 的 recheck 为 `unsupported_surface`                 |
| 学习策展 / 模式检测 | `curateLearningSkillDrafts`、`publish-draft-skill` | 产出 draft。发布与批准走人工 RPC                                                                                             |

`surfaceForCategory`（`capability-gap-ingest.ts`）把 skill 标成 `capability.skill-spec`，把 tool 标成 `capability.skill-installation`。消费端是 skill 写 draft、tool 交治理提案，名字与动作相反。

`actSkill` 的正文是占位摘要，不是可运行的 `SKILL.md` 目录树，也没有评测。`draftProfileForGap` 把 `assetType` 写成 `"skill"`，`normalizeAssetType` 不认识该值，默认落成 `"capability"`。当前 draft 仍不可执行。

### 1.3 孵化状态机

没有一条 `candidate → published` 总状态机。下面几套同时存在。

| 状态机                     | 枚举（压缩）                                                                                       | 谁推进                                                               | 与「员工可用」的关系                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 资产 `SkillLifecycleState` | `draft → private → reviewing → published`，另有 `approved` / `deprecated` / `rejected` / `retired` | 人工 RPC：`finalizeDraftSkill`、分享、提交企业、`publishSkillReview` | 只有可执行 lifecycle 且类型在 `EXECUTABLE_ASSET_TYPES` 才投影。`knowledge` 排除 |
| 企业 proposal              | `proposed / under_review / approved / rejected / withdrawn`                                        | `enterprise-capability.review`                                       | 拒绝主要落在 proposal。未找到把 `skill.lifecycle` 写成 `rejected` 的 store 函数 |
| Registry                   | `draft / review / approved / active / deprecated / retired`                                        | 审核通过后 `approveAndRegister`                                      | 员工安装与装包读的是这份目录                                                    |
| 平台 submission            | `pending-review / reviewing / published / rejected / ...`                                          | 脱敏后 `submit-to-platform`，平台 RPC 发布                           | 员工 RPC 到不了平台发布                                                         |
| 孵化中心                   | 候选池 + `incubation.decide` 日志                                                                  | 人写 reason                                                          | `decide` 不调用 `submit-to-platform`                                            |
| auto-evolution             | 默认关                                                                                             | 仅当环境变量为 on 且 governance mode 为 auto                         | 永不自动 approve，只推进带 `autoInstallIntent` 的 job                           |

孵化候选门槛（分析 §3.3）：成熟度 ≥ 企业认证，`calls30d >= 100`（由 `calls7d * 4` 估算），`departmentCount >= 2`（值是 unique robots），`successRate >= 0.8`。`employeeSatisfaction` 恒为 null。观测值、估算值与治理决策必须分开写；这组数字不能当发布依据。

人工门已经存在：finalize、分享前 `evaluateAssetContentReadiness`、企业审核、registry 对齐发布、平台脱敏、孵化决策日志、模式先 approve 再发布草稿。缺口草稿没有与分享路径同级的内容就绪门槛。

### 1.4 失败语义（调查基线上的源码复核）

上一稿把通道 A（投影）和通道 B（运行时绑定）拆开，但 D5 仍把它们压成一个成功谓词。本节只记录调查基线上已经发生的事。修订后的记录方式见 D5/D9。

**投影路径**

- `installSkillToRobotAsset` 先把机器人关系写入 store，再 `emitSkillRelationMutation`。
- `emitSkillRelationMutation` 对 hook 异常空 `catch`，注释为 hooks must not break asset mutations（`skill-lifecycle-store.ts`）。
- hook 本体（`skill-execution-binding/register-hooks.ts`）调用 `syncSkillExecutionBinding` 后不看返回值。
- 因此：关系已写入，或函数已返回，都不证明 `ob-asset-<id>/SKILL.md` 已物化，也不证明下一轮 `resolveEmbeddedRunSkillEntries` 能看见。

**运行时绑定路径（`syncInstallToRuntime`）**

- 实现在 `runtime-binding-sync.ts`。它写的是 agent runtime binding。失败原因包括 `missing-user`、`platform-auth-disabled`、`user-not-found`、`membership-not-found`、`registry-entry-not-found`、`runtime-agent-not-found`。
- `executeInstallConfirmation`（`employee-install.ts`）在调用同步之前就把无配置请求标成 `installed`。`synced: false` 只 `console.warn`。同步抛错同样只 warn。`userEmail` 为空时整段同步被跳过，状态仍是 `installed`。
- `employee-install.apply-configuration` 先写 `installed`，binding 重新激活失败只 warn，RPC 仍按成功返回。
- 持久化文件是 `~/.config/openbot/stores/employee-install.json`。文件头自称为 Phase 1 stub。技能资产在 `CONFIG_DIR/skill-assets`。
- 该 confirm 路径不调用 `materializeSkillExecutionBinding`。绑定失败不能单独推出「下一轮 prompt 一定没有这份技能」。员工 UI 读的是请求状态还是投影目录，**待核实**。

**能力包**

- `installRegistrySkillOntoRobot` 在 registry 安装函数返回 ok 时把结果当成成功，内部会 `installSkillToRobotAsset`。
- `installSkillKeysOntoRobot` 把该 ok 放进返回值 `installed`，然后再 best-effort 调用 `syncInstallToRuntime`；异常被空 `catch`。缺少 `userEmail` 或 `cfg` 时同步被跳过，该项仍留在 `installed`。

**文件系统栈（本方案不改行为）**

策略拒绝、缺依赖、畸形 frontmatter、路径问题会使技能从 prompt 消失，没有与资产 RPC 同级的用户可见错误。归因 handler 异常被吞。证据见分析 §7 P1-2。本轮未重读过滤实现；若将来扩大范围，标为 **待核实**。

### 1.5 关键路径索引

| 主题                   | 符号                                                                                            | 路径                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 资产生命周期与安装关系 | `saveSkillAsset`、`finalizeDraftSkill`、`installSkillToRobotAsset`、`emitSkillRelationMutation` | `src/gateway/skill-lifecycle-store.ts`                                                                 |
| 投影资格与物化         | `EXECUTABLE_LIFECYCLES`、`syncSkillExecutionBinding`、`isExecutableSkillProjectionEligible`     | `src/gateway/skill-execution-binding/`                                                                 |
| 关系 hook              | `ensureSkillExecutionBindingHooksRegistered`                                                    | `src/gateway/skill-execution-binding/register-hooks.ts`（gateway 启动见 `src/gateway/server.impl.ts`） |
| Turn 加载              | `loadWorkspaceSkillEntries`、`resolveEmbeddedRunSkillEntries`                                   | `src/agents/skills/workspace.ts`、`src/agents/pi-embedded-runner/skills-runtime.ts`                    |
| 安装向导               | `executeInstallConfirmation`、`employee-install.apply-configuration`                            | `src/gateway/server-methods/employee-install.ts`                                                       |
| 运行时绑定             | `syncInstallToRuntime`                                                                          | `src/gateway/runtime-binding-sync.ts`                                                                  |
| 创建机器人装包         | `installRegistrySkillOntoRobot`、`installSkillKeysOntoRobot`                                    | `src/gateway/capability-packs/install-pack-to-robot.ts`                                                |
| 缺口                   | `surfaceForCategory`、`actSkill`、`actTool`                                                     | `src/gateway/evolution-control/capability-gap-ingest.ts`、`capability-gap-consumer.ts`                 |
| CLI                    | `registerSkillsCli`                                                                             | `src/cli/skills-cli.ts`                                                                                |
| 自动进化开关           | `isSkillAutoEvolutionEnabled`                                                                   | `src/gateway/evolution-governance/skill-auto-evolution.ts`                                             |
| 孵化效果               | `saveEffectTracking`                                                                            | 定义于 `src/gateway/incubation-store.ts`；调用仅见 `src/gateway/__tests__/incubation-store.test.ts`    |
| 提示词与缺口标记       | `buildUserVisibleReplySection`、`buildDocsSection`                                              | `src/agents/system-prompt.ts`                                                                          |

### 1.6 上一稿阶段编号对照

| 上一稿                           | 本修订                                  |
| -------------------------------- | --------------------------------------- |
| Phase 0 决策契约                 | Phase 0：基线确认 + D1–D9               |
| Phase 1 单一安装成功谓词         | Phase 1：分层状态与投影可靠性，先测后改 |
| Phase 2 文档 / CLI / 提示词      | Phase 2A                                |
| Phase 3 缺口 surface 与 finalize | Phase 2B                                |
| Phase 4 孵化标注                 | Phase 3                                 |

## 2. 问题与风险对照表

「是否阻塞优化」指：不先处理或不定案，后续阶段会把错误语义写进实现或文档。

| ID   | 级  | 现象                                                                                                        | 证据                                                                                                    | 影响                                                                | 是否阻塞优化                                                                              |
| ---- | --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P0-1 | P0  | 缺技能没有决策点。检索 registry、ClawHub、生成技能、继续普通工具由不同层各自发生                            | 分析 §2；未找到单一优先级函数                                                                           | 后续任务缺技能只进 evolution 日志或占位 draft                       | **是。** 阻塞任何「缺技能时做什么」的行为改动，直到 D1–D3 勾选                            |
| P0-2 | P0  | 「创建技能」停在占位 draft。自动进化默认关且永不自动批准                                                    | 分析 §2.3、§3.4；`skill-auto-evolution.ts` 文件头                                                       | 不能把 draft 或进化日志说成已可用技能                               | **是，作为非目标锁定。** 阻塞打开自动进化或自动批准                                       |
| P0-3 | P0  | 关系写入、投影、绑定可以被同一个 `installed` 同时代表                                                       | 调查基线 §1.4                                                                                           | 员工看到已安装，下一轮仍可能不可执行                                | **是。** 阻塞 Phase 1 代码，直到 D5 新文案与 D9 冻结（闸门 B）                            |
| P0-4 | P0  | 公开文档把不存在的 `openbot skills install/update` 和 ClawHub 写成主通道；系统提示词禁止导向第三方 registry | 分析 §6。本调查只复核了 CLI：`skills-cli.ts` 仅 `list` / `info` / `check`。文档句段待 Phase 2A 逐页核对 | 员工、文档、模型会走向不同安装动作                                  | **有条件。** 阻塞 Phase 2A 的完成声明。文档须在 D5/D9 冻结之后再写「可用」                |
| P1-1 | P1  | surface 名与动作相反；诊断不消费 skill-spec；live auto-submit 未接线                                        | `surfaceForCategory`；诊断行为见分析 §2.1                                                               | 运营把 capability-gap draft 当成已进化或已可用                      | **有条件。** 阻塞 Phase 2B。surface 改名须保留向后兼容                                    |
| P1-2 | P1  | 资产 RPC 有明确错误；文件系统缺依赖、策略拒绝、frontmatter 失败则技能从列表消失                             | 分析 §7 P1-2。过滤实现本轮未重读                                                                        | 两条栈排障方式不同                                                  | **否**（非目标）。不并进 Phase 1                                                          |
| P1-3 | P1  | 孵化分把估算写成 30 日调用，部门数等于机器人数，满意度恒 null；效果跟踪无生产写入                           | 分析 §3.3；`saveEffectTracking` 仅测试调用                                                              | 用分数做发布或上传建议会误导                                        | **是，阻塞「把孵化分当发布依据」。** Phase 3 只做未采集标注，并区分观测 / 估算 / 治理决策 |
| P1-4 | P1  | store 分裂：技能资产、安装请求、registry 不在同一目录                                                       | `~/.config/openbot/stores/employee-install.json` 与 `CONFIG_DIR/skill-assets`                           | 排障时「装过」可能只在其中一个文件。生产数据是否必须迁移 **待核实** | **有条件。** 阻塞物理迁移，直到 D6。不阻塞 D5 分层本身                                    |
| P1-5 | P1  | 资产态 `approved` / `rejected` 与企业审核态、UI 分段不是同一套词                                            | 分析 §3.1、§3.4                                                                                         | 审核拒绝与资产 lifecycle 可能对不上                                 | **否。** 非目标                                                                           |
| P1-6 | P1  | `reviewing` 可投影与 `saveSkillAsset` 附近注释矛盾                                                          | `skill-execution-binding/types.ts`；相反注释见分析 §3.1                                                 | 后续修改会按错误注释收紧或放开                                      | **有条件。** 阻塞 Phase 2A 的注释收口。运行时是否收紧由 D4 决定                           |
| P2-1 | P2  | 有 24h 健康度与 patch 版本，没有「评测通过才可 published」                                                  | 分析 §3.1、§7 P2-1                                                                                      | 健康度不是发布门                                                    | **否。** 不新建评测门                                                                     |
| P2-2 | P2  | 学习策展的「三次」与 `skill-authoring` 的「同一错误三次」不是同一条规则                                     | 分析 §7 P2-2                                                                                            | 可能各存一份 draft 与目录技能                                       | **否。** Phase 0 写明二者不可互换                                                         |
| P2-3 | P2  | `runtime-appliance` 名称未落地                                                                              | 分析 §0、§9                                                                                             | 用该词会检索不到代码                                                | **否。** 契约使用 §1.5 的模块名                                                           |
| P2-4 | P2  | ClawHub 可以出现在治理提案类型里，没有安装执行器                                                            | 分析 §7 P2-4。提案类型定义本轮未重读；若要改枚举则 **待核实**                                           | UI 容易写成已接通的市场                                             | **是，阻塞 D1。** 推荐维持无执行器、不自动安装                                            |
| P2-5 | P2  | `docs/zh-CN/**` 会复制英文文档中的错误                                                                      | 仓库 i18n 约定；分析 §6                                                                                 | 只改英文会留下中文对外文档漂移                                      | **有条件。** 阻塞「中文对外文档已对齐」。禁止手改 `docs/zh-CN/**`                         |

## 3. 优化目标与非目标

### 3.1 目标

1. 缺技能时的允许源、创作边界、draft 推进者写成可勾选契约。
2. 安装关系、执行投影、运行时绑定、最终可用性分层记录。UI 与 RPC 用可用性表达「下一轮能否执行」。`installed` 若保留，只表示关系已建立（或旧 API 兼容）。
3. 每个安装入口在 D9 中写明：绑定是必需、辅助，还是 `not_required`；文件系统发现不进入这套安装状态机。
4. 文档、CLI 与系统提示词描述同一套真实入口，并把创建、部署、发现分开写。
5. 缺口 surface 与消费动作一致，且旧 surface 字符串在一个兼容期内仍可读取。draft 在人工 finalize 且扩展内容检查通过之前不可执行。
6. 孵化指标标明未采集，并把观测、估算、治理决策分开。失真分数不进入发布判断。

### 3.2 非目标

- 不做自动批准。不把 `incubation.decide` 接到 `submit-to-platform`。
- 默认不打开 `OPENBOT_SKILL_AUTO_EVOLUTION`。未设置、非法值、`off` 均为关闭；永不自动 approve；不扫描没有 `autoInstallIntent` 的历史 draft。
- 不在 gateway 增加 ClawHub HTTP 客户端，不在缺技能时自动 `clawhub search/install`。
- 不补 `openbot skills install` / `update`（D8 默认拒绝）。
- 不在 turn 内生成可执行技能目录，不自动评测，不自动安装缺口草稿。
- 不新建 `runtime-appliance` 包或目录。不重构整个技能体系。
- 不把 24h 健康度升级为 published 门。
- 不统一文件系统技能的静默失败（P1-2），除非另批新阶段。
- 不对齐企业拒绝与 `skill.lifecycle=rejected`（P1-5）。
- 不手改 `docs/zh-CN/**`。
- 不迁移历史安装 JSON（除非 D6 改选）。历史 `installed=true` 按 D5/D9 解释，不靠迁移才变得可读。
- 本修订不改任何产品实现。D0 未勾选、闸门与清单未勾选前不得开工写代码。
- 不把公开仓的所有权、工具交集或 `skills.yaml` 重载验收，不加标注地当作本仓标准。

### 3.3 专家必须拍板的决定

推荐列是本修订的默认合同。未勾选的项保持阻塞。

| ID  | 决定                                     | 方案推荐                                                                                                                                                                                                                                                 | 专家结论                                                         |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D0  | 系统边界：本方案操作哪一个系统           | **A。** 私有仓 upbeyond/openbot 的 gateway：员工技能资产、`employee-install`、执行投影、runtime binding                                                                                                                                                  | **已确认：A**（产品负责人，2026-10-10）。B/C/D 关闭              |
| D1  | 缺技能时允许的源                         | 不新增 turn 内自动安装。显式安装只用已有源：企业 registry、`listSkillRecommendations`（published / 小组共享）、先 `scan-external` 再确认的 external-local。禁止发明 skillKey。workspace 与 `.agents/skills` 由文件系统栈被动发现。ClawHub 不进入 gateway | ☐ 同意推荐 ☐ 改选：                                              |
| D2  | 创作边界                                 | `actSkill`、学习策展、模式检测、quick-save 档案增强只停在 `draft`，且 `autoInstallEnabled=false`。不自动安装，不自动 published。缺口草稿的 `assetType` 必须是 `EXECUTABLE_ASSET_TYPES` 中的显式值（落地在 Phase 2B）                                     | ☐ 同意推荐 ☐ 改选：                                              |
| D3  | 谁把 draft 推进到可执行                  | 没有自动推进者。唯一人工入口是 `finalizeDraftSkill` / `personal-skills.finalize-draft`。finalize 前通过扩展后的内容检查（Phase 2B）。通过之后才允许进入安装与投影                                                                                        | ☐ 同意推荐 ☐ 改选：                                              |
| D4  | `reviewing` 是否维持可投影               | 维持 `reviewing` ∈ `EXECUTABLE_LIFECYCLES`。Phase 2A 只修正相反注释。本方案不收紧投影                                                                                                                                                                    | ☐ 同意推荐 ☐ 改选为收紧（须另写影响说明；现网自用面 **待核实**） |
| D5  | 安装状态分层                             | 见下方「D5 正文」。取代上一稿「installed = 投影且绑定都成功」                                                                                                                                                                                            | ☐ 同意本修订正文 ☐ 改选：                                        |
| D6  | 安装请求 store 是否迁入 `CONFIG_DIR`     | 不迁移。Phase 2A 把 stub 路径写成临时事实。生产文件是否必须迁移 **待核实**                                                                                                                                                                               | ☐ 同意不迁移 ☐ 要求迁移（另页验收，阻塞 Phase 1 完成声明）       |
| D7  | 孵化效果                                 | Phase 3 标明效果对比未采集；区分观测、估算、治理决策。不用乘 4 的 `calls30d`、部门=机器人、满意度 null 做发布或上传判断。不接 `saveEffectTracking` 生产写入。不改 auto-evolution，不代发平台                                                             | ☐ 同意只标注 ☐ 要求接生产写入（另页定义数据来源）                |
| D8  | 是否实现 `openbot skills install/update` | 不实现。Phase 2A 改写文档，使文档服从 CLI                                                                                                                                                                                                                | ☐ 同意不实现 ☐ 要求实现 CLI（新阶段，不进入本方案）              |
| D9  | 安装状态与可用性语义                     | 见下方「D9 正文」。仅在 D0=A 之后冻结。**未冻结不得开始分层状态的产品改动**                                                                                                                                                                              | ☐ 同意本修订正文 ☐ 改选：                                        |

#### D0=A 已冻结之后怎么走

产品负责人已确认 A。B、C、D 不再作为本方案的可选实施路径。下文 D1–D9、§4、§6 是这个边界上的设计原则，完整实施仍暂缓。

下一步工作包见 §5。在该工作包里仍然不写实现代码。分层状态机的落地另说：闸门 B（D5/D9 冻结，并写明与现有授权、工具筛选的映射）通过之后，才能开独立实施 PR。该 PR 不得提前夹进切片设计文档。

#### D5 正文（取代上一稿的单一谓词；仅 D0=A）

安装生命周期分四层记录。层与层独立更新。任何一层的成功都不能填满其他层。

| 层         | 状态                                             | 含义                                                                                                                                                                     |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 安装关系   | `requested` / `linked`                           | 技能与机器人的关系是否已经建立。`requested` 表示本次操作已受理但关系尚未提交；`linked` 表示关系已在 store 中建立                                                         |
| 执行投影   | `pending` / `ready` / `failed`                   | `ob-asset-<skillId>/SKILL.md` 是否已按可执行 lifecycle 物化。`pending` 表示尚未核对或正在物化；`ready` 表示物化结果可被后续加载使用；`failed` 表示本次物化失败并带有原因 |
| 运行时绑定 | `not_required` / `pending` / `synced` / `failed` | 仅当 D9 规定该入口需要 `syncInstallToRuntime` 时，才使用 `pending` / `synced` / `failed`。不需要绑定的入口保持 `not_required`                                            |
| 最终可用性 | `ready` / `degraded` / `failed`                  | 按该入口的必需条件计算。`ready`：必需条件全部满足。`degraded`：投影 `ready`，但该入口的辅助同步失败。`failed`：必需条件未满足                                            |

规则：

1. 若保留字段或文案 `installed`，它只表示关系为 `linked`（含旧 API 里已经写成 true 的历史记录的兼容读法）。它单独存在时，不得推断投影 `ready`，不得推断绑定 `synced`，不得推断可用性 `ready`。
2. 通道 B（运行时绑定）只有在 D9 把该入口标成「需要绑定」时才进入成功门槛。标成 `not_required` 的入口，绑定失败不是这个入口的失败。
3. 可用性 `ready` 还要求：该入口所声称的执行路径，能在**下一轮真实 loader 或真实执行上下文**中观察到，而不是在同一次请求里读回刚写的文件。
4. 失败必须带结构化原因，并且允许对同一关系重试。
5. 失败不得破坏该机器人上原先已经有效的关系与投影。
6. 回滚只允许发生在「本次操作创建、且仍然由本次操作拥有」的关系上。本次物化失败时，可以撤掉这条新关系。不得撤掉更早存在的有效关系，也不得因为绑定失败删掉已经 `ready` 的投影。
7. 历史数据只有 `installed=true`、没有四层字段时：关系按 `linked` 解释；投影保持 `pending`，直到一次核对把它写成 `ready` 或 `failed`；绑定按 D9 对该入口的分类解释，未知时用 `pending`，不得直接写成 `synced`；可用性不得默认 `ready`。

#### D9 正文（仅 D0=A；分层状态的开工条件）

D0 未选 A，或 D9 未冻结时，不得按本节改产品代码。测试可以在 D0=A 且闸门 B 通过后、改实现之前按本节来写。垂直切片优先于把本节铺到所有入口。

**入口分类（推荐）**

| 入口                                                                                       | 关系                                 | 投影                                                        | 绑定                                             | 绑定在该入口中的角色                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 文件系统发现（bundled / managed / workspace / extra / plugin / `.agents/skills`）          | 不建立员工安装关系                   | 目录本身由 loader 发现                                      | `not_required`                                   | 不走安装状态机。UI 不得把这类技能说成 employee-install 的安装结果                                                       |
| `installSkillToRobotAsset` / `robot-skills.install`                                        | 必需，成功后 `linked`                | 必需，成功后 `ready`                                        | `not_required`，除非同一次调用按下行另外要求绑定 | 只安装关系时，绑定不是门槛                                                                                              |
| `installSkillKeysOntoRobot`（提供了 `userEmail` 与 `cfg` 并调用了 `syncInstallToRuntime`） | 必需                                 | 必需                                                        | 需要                                             | **辅助。** 投影 `ready` 且绑定 `failed` → 可用性 `degraded`。绑定失败不得抹掉投影，也不得只返回一个无原因的 `installed` |
| `installSkillKeysOntoRobot`（未调用绑定）                                                  | 必需                                 | 必需                                                        | `not_required`                                   | 可用性只看投影                                                                                                          |
| `employee-install.confirm` / `apply-configuration`                                         | 安装请求记录；不把它写成技能投影关系 | 本入口今天不物化 `SKILL.md`。未另做投影时，投影不标 `ready` | 需要                                             | **必需。** 绑定未 `synced` 时，该入口可用性为 `failed`。不得用该入口的成功推断下一轮 prompt 里有技能                    |
| 缺口 draft、未 finalize 的资产                                                             | 可以挂关系                           | 必须保持非 `ready`                                          | `not_required`                                   | draft 的执行可用性为 `failed`                                                                                           |

**UI「安装成功」的最低证据**

- 「可以使用 / 安装成功」只允许出现在可用性 `ready`，并且闸门 C 要求的真实执行路径已经能观察到。
- `degraded` 使用单独文案，写明投影已就绪、辅助同步失败及原因。不得叫安装成功。
- 只看到关系 `linked` 或旧字段 `installed` 时，文案停在「关系已建立」或「待核对投影」。
- 员工 UI 今天是否已有分层展示位，**待核实**。Phase 1 验收包含最小展示：没有展示位则该阶段不算完成。

**重试**

- `failed` 与 `degraded` 都可对同一关系重试。
- 重试不得新建第二条关系，也不得留下第二份仍在授权的投影。
- 部分成功（投影 `ready`、绑定 `failed`）的重试只补绑定，不回滚投影。
- 重复安装是幂等的：终态与第一次成功后的四层一致。
- 并发安装同一机器人、同一技能：最终只有一条关系，最多一份仍在授权的投影。锁的具体原语在实施时选定，验收看结果。

**升级、撤销、删除时的旧投影**

- 升级：新投影进入 `ready` 之前，旧投影继续代表旧版本，不得被半份新内容替换后仍当作新版本授权。新投影 `failed` 时，原先有效的旧投影保持可用，并标明仍是旧版本。当前实现是否先覆盖文件，**待核实**；Phase 1 的集成测试必须把这个结果钉住。
- 撤销、卸载、删除：关系解除后，旧投影不得继续授权。下一轮真实执行上下文加载不到该投影。
- 回滚范围服从 D5 第 6 条。

### 3.4 三道闸门

闸门是阶段开工条件。阶段里的单元测试通过，不等于闸门通过。

| 闸门                   | 内容                                                      | 通过条件                                                                                                                                                                                        | 未通过时                                                                                              |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A 基线确认             | D0、四文件 permalink、调查基线、实施当时的主干与生产版本  | D0 已勾选。私有仓 URL、四个 permalink、#545、#546、调查基线 SHA 已核对。实施当时重新读取 `main` HEAD 与生产部署版本。与调查基线不同则列出差异。生产版本本轮 **待核实**，因此闸门 A 现在尚未通过 | 禁止把调查基线写成当前生产事实。禁止开始 Phase 1 及以后的代码。D0 不是 A 时，禁止沿用 §4 的投影改动面 |
| B 状态机与失败语义冻结 | 仅 D0=A：D5 正文 + D9 正文，且已有授权/工具筛选的映射说明 | §7 中 D5 与 D9 已勾选，并写明四层如何映射到现有关系、投影资格和绑定，而不是平行总开关                                                                                                           | 禁止开始分层状态的产品改动。允许继续修订本文。垂直切片可以在映射说明写清后、全量 Phase 1 之前做       |
| C 端到端集成验收       | 先是垂直切片，再是 §6 矩阵                                | 切片五步进入真实执行上下文。矩阵每一行同样不得只在同一次请求内读回刚写的文件。撤销后旧投影不再授权                                                                                              | 切片未通过时，不得扩文档与指标，也不得宣称员工端安装已经验收完成                                      |

**D0=A 已冻结，但闸门 A 仍未通过**（生产版本待核实）。分层状态的产品改动还要闸门 B，并且必须是闸门 B 之后的独立实施 PR。闸门 C 从垂直切片的真实执行开始；切片设计勾选完成，不等于切片已经跑过。

## 4. 优化方案（分阶段）

未批准的阶段保持未实施。下表「关键改动面」是批准之后才允许动的路径。本 PR 不修改它们。

### Phase 0：系统边界与决策契约（D0–D9）

**目标。** D0=A 已经冻结。本阶段其余决定（D1–D9）仍待勾选。本阶段不写产品函数。完整实施继续暂缓。

**范围。**

- 证据追溯表保持为仓库身份的记录。生产版本的空位留到闸门 A 的实施前核对。
- D1–D3：允许的源、创作停在 draft、只有人工 finalize 进入可执行。失败时继续普通工具面（`no_skill_contract` 不安装）。
- D5/D9：四层状态、入口分类、UI 最低证据、重试、旧投影。
- 成长门控、提示词标记、缺口消费、诊断在后续实施时调用同一份源契约。本阶段只规定调用关系。
- 写明学习策展阈值与 `skill-authoring` 的「三次」不是同一条规则。

**关键改动面（批准后）。** 无产品代码。契约落点将来集中在 gateway 一个模块，由 `src/gateway/agent-growth/`、`src/gateway/evolution-control/capability-gap-consumer.ts`、`src/diagnosis/skill-installation-candidate.ts` 调用。文件名在实施 PR 再定。

**验收标准。**

- D0=A 已由产品负责人确认（2026-10-10）。
- D1、D2、D3、D5、D9 若要进入实施，须另勾，且与 §3.2 无冲突。D5/D9 还要附上与现有授权/工具筛选的映射说明，并等闸门 B。
- 契约能回答：后续任务缺技能时允许提示已有 registry 技能、记 draft、继续普通工具；禁止 ClawHub 自动安装、自动 finalize、自动 published。
- D9 对每个安装入口给出了绑定角色。没有「看情况再定」的入口。

**风险与回滚。** 无运行时行为。撤回勾选即回滚。改选 D1 或 D9 后，Phase 1 及以后全部重新批准。

**依赖。** #545 的分析仍指向同一调查基线。生产差异未列出之前，闸门 A 不通过。

### Phase 1：安装状态与投影可靠性（先切片，再测后改）

**前提。** D0=A，且垂直切片已按 §5 通过。在此之前，本节的改动面全部冻结。

**目标。** 让安装入口按 D5/D9 写出四层状态，并映射到已有授权/工具筛选，不另造平行总开关。投影是否 `ready` 以真实 loader 的下一轮结果为准。绑定只在 D9 要求时成为门槛。`employee-install` 与 pack 不得再用单独的 `installed` 表示可执行。

**范围。**

- 先写失败路径与集成测试，再改实现。测试先红，再改到绿。
- `executeInstallConfirmation` 与 `apply-configuration`：绑定是必需条件。未 `synced` 时可用性 `failed`，响应含结构化原因。缺少 `userEmail`、`platform-auth-disabled` 以及其他 `synced: false` 都走这条失败。不得在同步前把结果写成可执行成功。
- `installSkillToRobotAsset`：读取 `syncSkillExecutionBinding` 的结果。hook 的空 `catch` 不再充当投影 `ready`。关系可以是 `linked`，同时投影是 `failed`。
- pack：调用了绑定时，绑定失败记为辅助失败，可用性 `degraded`，原因可见；未调用绑定时，绑定为 `not_required`。
- 幂等、部分成功重试、并发、撤销后投影不再授权，都在本阶段的测试里。
- 升级失败不得毁掉仍有效的旧投影（D9）。
- draft / rejected / retired 维持不可进入投影 `ready`。
- 不迁移 `employee-install.json`（除非 D6 改选）。
- `skill-lifecycle-store.ts` 的安装与投影信号由 Phase 1 单独修改。

**测试（先于实现）。**

- 幂等：同一机器人、同一技能安装两次，关系仍是一条，授权投影仍是一份，四层终态与第一次成功相同。
- 部分成功重试：投影 `ready`、绑定 `failed` 之后重试，投影仍在，绑定变为 `synced`，可用性从 `degraded` 变为 `ready`。重试失败时投影仍 `ready`。
- 并发：两次重叠安装结束后只有一条关系、一份授权投影。
- 撤销、卸载或删除之后，下一轮真实执行上下文不得再授权该投影。
- 新建关系且投影 `failed`：若该关系仍由本次拥有，允许回滚这条新关系。已存在的有效关系在失败后仍然 `linked`，其原投影若原本 `ready` 则保持 `ready`。
- 验证必须走 `resolveEmbeddedRunSkillEntries` 或同等集成入口的**下一次**加载。同一次请求内断言文件存在，不能当作「下一轮可见」。

**关键改动面（闸门 A/B 通过后）。**

- `src/gateway/server-methods/employee-install.ts`
- `src/gateway/runtime-binding-sync.ts`（消费既有 reason，不改成物化 `SKILL.md` 的实现）
- `src/gateway/capability-packs/install-pack-to-robot.ts`
- `src/gateway/skill-lifecycle-store.ts`
- `src/gateway/skill-execution-binding/sync.ts`、`register-hooks.ts`
- `src/agents/pi-embedded-runner/skills-runtime.ts` 的集成调用（测试使用它，不借机改发现顺序）
- 员工 UI 的最小状态展示（展示位 **待核实**）
- 对应 `*.test.ts`

**验收标准。**

- 四层状态在 RPC 或持久化结果中可分别读到。`installed` 为 true 时，只与关系 `linked` 同时出现。
- D9 表中绑定为必需的入口，绑定 `failed` 时可用性 `failed`。绑定为辅助的入口，投影 `ready` 且绑定 `failed` 时可用性 `degraded`。
- 上列测试通过，且 loader 证据来自下一轮加载。
- 闸门 C 的矩阵在本阶段收口；未跑完矩阵则不得宣称 Phase 1 验收完成。

**风险与回滚。**

- platform auth 关闭或用户缺失时，向导从「看起来已安装」变成绑定 `failed`、可用性 `failed`。这是 D9 的预期。
- 旧客户端若只读 `installed`，会把「关系已建立」继续显示成成功。Phase 1 的 UI 最小展示要避免这个误读；旧 API 字段本身按 D5 保留兼容。
- 回滚实现是恢复调查基线上的写入方式，仅当专家撤回 D5/D9 时允许。回滚数据时仍遵守「只动本次拥有的新关系」。

**依赖。** 闸门 A、闸门 B。D6 维持不迁移。不得在本阶段改缺口 surface 或孵化公式。

### Phase 2A：文档、CLI 与系统提示词

**目标。** 对外说明与 `registerSkillsCli`、系统提示词、真实发现顺序、D5/D9 的用词一致。不新增 CLI 子命令（D8）。创建、部署、发现分成三节写，避免合成一条「安装通道」。

**范围。**

- `docs/tools/skills.md`：去掉不存在的 `openbot skills install/update`。配置路径改为 `~/.openbot`（或代码中的 `CONFIG_DIR`）。
- `docs/cli/skills.md`：保持 `list` / `info` / `check`。
- ClawHub 与技能 CLI 页：写成非员工通道、非 gateway。与 `buildDocsSection` 一致。`skills/skill-authoring/SKILL.md` 里的 `clawhub publish` 改成同一态度，或标明「仅本机另有 CLI，且不属于员工安装通道」。
- 发现顺序补全：extra、plugin、两级 `.agents/skills`、`openbot-lifecycle-binding`。
- 注释对齐：`reviewing` 可投影（D4 维持推荐时）；governance store 文件头若仍写 `~/.openclaw/governance/`，改为跟随 `CONFIG_DIR`。
- `employee-install` 的 stub 路径写成临时 store。
- 英文对外文档之后走 `scripts/docs-i18n`。不手改 `docs/zh-CN/**`。
- 「可用 / 安装成功」的句子使用 D5 的可用性 `ready`，不使用单独的 `installed`。

**关键改动面（批准后）。**

- `docs/tools/skills.md`、`docs/tools/skills-config.md`、`docs/cli/skills.md`、`docs/tools/skills-cli.md`（实施时逐页打开，分析 §6 的句段在此之前仍是 **待核实**）
- `src/agents/system-prompt.ts` 的 docs 段
- `skills/skill-authoring/SKILL.md`
- 只改注释的 gateway 文件
- i18n 词汇表与 `docs/.i18n/README.md` 规定的生成流程

**验收标准（三分）。**

- 英文文档：不存在的子命令已改写；创建、部署、发现分开；ClawHub 不是员工 gateway 通道。
- 中文对外文档：只通过 i18n 管道更新。未跑管道则不得勾「zh-CN 已对齐」。
- 系统提示词：与上述态度一致，且不把 `installed` 说成下一轮可执行。
- 发现顺序与 `loadWorkspaceSkillEntries` 一致。`reviewing` 注释与 `EXECUTABLE_LIFECYCLES` 一致（D4 维持推荐时）。

**风险与回滚。** 还原对应 markdown 与提示词段落。禁止用「把 CLI 做出来」修复文档，除非 D8 改选并另批阶段。

**依赖。** D1、D4、D5、D8、D9 已勾选。语义冻结后，纯文档起草可以与 Phase 1 的测试编写并行。含「可用」的句子在 D5/D9 改口时暂停合入。

### Phase 2B：缺口 draft 与 finalize

**目标。** surface 与 `actSkill` / `actTool` 的真实动作一致，旧字符串在兼容期内仍可读取。draft 在扩展内容检查通过并人工 finalize 之前不可执行，也不可被展示成已进化技能。

**范围。**

- 推荐改名而不是突然改动作：skill 类表示「写入 draft」，tool 类表示「治理提案」。诊断在 live auto-submit 接线之前继续只允许 `install_existing_skill`。本阶段不把 auto-submit 接上。
- 向后兼容：实施 PR 列出旧字符串与新字符串。读取端在一个兼容期内同时认识旧值 `capability.skill-spec` 与 `capability.skill-installation`。新写入使用新字符串。兼容期长度在实施 PR 写明；未写明则不得删除旧值的读取。
- finalize 在现有 `evaluateAssetContentReadiness` 之外，拒绝下列草稿：frontmatter 不可解析或缺少执行所需字段；声明了危险能力却没有与现有工具策略一致的授权；依赖未声明或声明了无法解析的依赖；调用者没有将该资产 finalize 到可执行态的授权权；技能 ID 或版本与已有资产冲突。缺任何一项则 RPC 拒绝，lifecycle 保持 draft，并返回结构化原因。
- `assetType: "skill"` 改为显式合法类型（D2）。
- UI「我的积累」若把这类 draft 显示成已贡献或已进化，改为 draft 文案。组件位置分析指向 `ui/src/ui/controllers/my-accumulation.ts`，本轮未跑 UI，**待核实**。

**关键改动面（批准后）。**

- `src/gateway/evolution-control/capability-gap-ingest.ts`
- `src/gateway/evolution-control/capability-gap-consumer.ts`
- `src/diagnosis/skill-installation-candidate.ts`
- `src/gateway/skill-lifecycle-store.ts` 的 finalize / 内容检查（排在 Phase 1 对该文件的改动合入之后）
- `ui/src/ui/controllers/my-accumulation.ts` 及直接展示 draft 的视图
- 对应测试

**验收标准。**

- 新写入的 surface 与「写 draft、不安装」或「治理提案、不安装」一致。旧字符串仍能被读路径识别。
- 未通过扩展检查时 finalize 失败，状态保持 draft，投影不是 `ready`。
- 通过检查并 finalize 后 lifecycle 为 `private`，此后才允许进入 Phase 1 的投影。
- 默认配置下没有路径把该 draft 推进到 published。
- §6 矩阵中「内容检查拒绝」「draft 不可执行」两行有测试证据。

**风险与回滚。** 只改写入、不保留读取兼容，会打断已有日志与 UI。该情况视为未按本节实施，应撤回改名。内容门槛变严后，历史缺口 draft 不能一键 finalize；UI 须给出未就绪原因。

**依赖。** D2、D3、D5。store 编辑等待 Phase 1 合入。不依赖 Phase 3。

### Phase 3：孵化指标标注

**目标。** 孵化中心把「未采集」写明，并把观测、估算、治理决策分开。不把失真指标当成发布或上传依据。

**范围。**

- 观测：真实写入的调用样本与成功率窗口。没有生产写入的效果对比，标为未采集。
- 估算：`calls30d = calls7d * 4`、`departmentCount` 实为机器人数、`employeeSatisfaction === null`。这些是估算或缺省，不得写成已测量事实。
- 治理决策：`incubation.decide` 只写日志，不调用 `submit-to-platform`。决策文案不得引用上述估算作为发布依据。
- 不修改 `OPENBOT_SKILL_AUTO_EVOLUTION` 的默认值。不新建评测门。
- 不接 `saveEffectTracking` 的生产写入，除非 D7 另页批准。

**关键改动面（批准后）。**

- `src/gateway/server-methods/incubation.ts`（说明与守卫；不改候选数学，除非另批）
- 孵化 UI 中展示分数的视图（组件 **待核实**）
- D7 若改选为接生产写入：`src/gateway/incubation-store.ts` 与真实调用点。未另页批准则禁止

**验收标准。**

- 界面或接口说明含「未采集」，并标出哪些数字是估算。
- `decide` 不调用平台提交。
- 生产代码没有新增 `saveEffectTracking` 调用。
- 自动进化默认值仍为关闭，「永不自动批准」仍在文件头。
- 本阶段 PR 不修改 auto-evolution 默认值，也不修改平台发布路径。

**风险与回滚。** 只改说明时，还原文案即可。改了候选公式或接上平台提交，视为超范围，整段撤回。

**依赖。** D7 已勾选。无 Phase 1 代码依赖。与 Phase 1、Phase 2A 可以并行，前提是不碰 `skill-lifecycle-store.ts` 与 auto-evolution。

## 5. 建议实施顺序与并行边界

### 下一步工作包（现在允许的全部）

只做垂直切片的**设计与验收勾选**。不写实现代码，不改产品。

| 步         | 范围                                                                                                     | 验收时必须看到                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 创建或选择 | 在私有仓 gateway 上选定一条已有员工技能，或保存一条新的员工资产。不自动 published，不打开 auto-evolution | 记录技能标识与 lifecycle。draft 不得被当成已可执行 |
| 保存       | 资产写入 `skill-assets` 一类的既有存储。本工作包只规定要观察的字段，不新写存储                           | 保存结果可再次读到；失败有原因                     |
| 授权/安装  | 装到一台机器人，或走 `employee-install` 确认。关系、投影、runtime binding 分开记录                       | 不得只用 `installed` 宣布下一轮可执行              |
| 运行       | 下一轮真实 loader 或该入口声明的执行上下文                                                               | 同一次请求里读回刚写的文件不算通过                 |
| 撤销       | 解除该机器人上的这次授权或安装                                                                           | 撤销之后的下一轮执行上下文里，该投影不再可用       |

切片设计写完并勾选之前：不扩 Phase 2A 的对外文档，不做 Phase 3 的指标标注，不铺开 Phase 1 的全部入口。

**D5/D9 不在这个工作包里落地。** 动分层状态机之前，须闸门 B 通过（D5/D9 已勾选，并写明如何映射到现有关系、`EXECUTABLE_LIFECYCLES`、工具策略和 runtime binding，避免平行总开关）。通过之后另开独立实施 PR。该 PR 与切片设计文档分开。

### 其后的顺序（仍未批准）

1. **D0=A。** 已完成。公开仓附录不适用。
2. **垂直切片设计与验收勾选。** 即上一小节。勾选通过之后，才谈切片的实现 PR；实现 PR 不是本文件授权的当前动作。
3. **Phase 1：** 切片的真实执行通过，且闸门 B 通过后，先补失败路径测试，再改安装/投影。`skill-lifecycle-store.ts` 由这一段独占到合入。须是独立实施 PR。
4. **Phase 2A：** 放在切片之后。D5/D9 冻结后可以起草。合入「可用」句段时，D5/D9 须仍与冻结文本一致。
5. **Phase 2B：** gap ingest/consumer 与诊断文件可以在不改 store 的前提下与 Phase 1 并行，但仍在 D0=A 且切片通过之后。finalize 的 store 改动等待 Phase 1 合入。
6. **Phase 3：** 孵化标注放在切片之后，独立批准。禁止与 auto-evolution 默认值或平台发布放在同一 PR。

| 可以并行                                                                   | 必须串行或禁止                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Phase 2A 起草与 Phase 1 的测试编写（切片已通过，D5/D9 已冻结）             | 当前任何产品代码；闸门 B 未通过时修改分层状态                         |
| Phase 2B 的 ingest/consumer 与 Phase 1 的 `employee-install.ts`、pack 文件 | 两阶段同时改 `skill-lifecycle-store.ts`                               |
| Phase 3 文案与 Phase 2A 的 ClawHub/CLI 段落                                | Phase 3 与任何修改 `OPENBOT_SKILL_AUTO_EVOLUTION` 默认值的改动        |
| 各阶段各自的测试                                                           | 一个 PR 跨阶段且改共享热文件；用文档提前宣称「安装成功」而闸门 C 未跑 |

建议 PR 切分：Phase 1 先测试、后实现，可以是同一 PR 的两个提交，或「测试 PR 合入失败用例」再跟修复 PR。Phase 2A、Phase 2B、Phase 3 各自独立。不要合成一个「进化闭环」大 PR。

未批准的阶段保持现状，包括调查基线上的 `installed` 写法。不批准不等于授权用别的补丁绕过。

## 6. 端到端验收矩阵（仅 D0=A）

本表不是公开仓的所有权或工具筛选矩阵。闸门 C 在垂直切片通过之后使用本表。每一行的「必须观察到的结果」都要来自下一轮真实 loader 或该行声明的执行上下文。同一次 RPC 内读回刚写入的文件，只可以作为实现笔记，不能勾选本表。

垂直切片是本表的前置最小集，五步都要有记录：创建或选择、保存、授权或安装、运行、撤销。

| 场景                                     | 关系                                    | 投影                | 绑定                                  | 可用性           | 必须观察到的结果                                                                                                                                   |
| ---------------------------------------- | --------------------------------------- | ------------------- | ------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装正常                                 | `linked`                                | `ready`             | `synced` 或 `not_required`（按 D9）   | `ready`          | 下一轮 `resolveEmbeddedRunSkillEntries`（或该入口声明的执行路径）能看见该技能。UI「安装成功」只在这一行出现                                        |
| 投影失败                                 | 新关系可回滚；原有有效关系保持 `linked` | `failed`            | 不得标成 `synced`                     | `failed`         | 结构化原因；可重试；原有有效投影仍在下一轮授权中，失败的新投影不在                                                                                 |
| 绑定失败且绑定为辅助                     | `linked`                                | `ready`             | `failed`                              | `degraded`       | 下一轮 loader 仍能看见投影。UI 使用 degraded 文案与原因，不写「安装成功」                                                                          |
| 绑定失败且绑定为必需（employee-install） | 不把请求写成投影 `ready`                | 不标 `ready`        | `failed`                              | `failed`         | 响应含 `syncInstallToRuntime` 的 reason。不得推断下一轮 prompt 已有该技能                                                                          |
| 重复安装                                 | 仍是一条 `linked`                       | 仍是一份 `ready`    | 与首次成功相同                        | 与首次成功相同   | 没有第二份仍在授权的投影                                                                                                                           |
| 并发安装                                 | 最终一条关系                            | 最终一份授权投影    | 无两份互相覆盖后都仍授权              | 单一终态         | 重叠请求结束后状态机只有一套记录                                                                                                                   |
| draft 不可执行                           | 可以存在                                | 非 `ready`          | `not_required`                        | `failed`         | 下一轮 loader 不把该 draft 当作可执行技能                                                                                                          |
| 内容检查拒绝                             | 不变                                    | 非 `ready`          | `not_required`                        | `failed`         | finalize RPC 失败；lifecycle 仍为 draft；原因覆盖 frontmatter、危险能力、依赖声明、授权权、ID/版本冲突中的被测项                                   |
| 撤销授权                                 | 关系解除                                | 旧投影不再 `ready`  | 失效                                  | `failed`         | 撤销之后的下一轮执行上下文不再授权该投影                                                                                                           |
| 历史兼容                                 | 旧 `installed=true` 读成 `linked`       | `pending`，直到核对 | 未知则为 `pending`，不得默认 `synced` | 不得默认 `ready` | 旧客户端仍能读到关系已建立；新客户端不把该记录显示成可以使用                                                                                       |
| 文档与 UI 一致                           | —                                       | —                   | —                                     | —                | 英文文档、i18n 生成的中文文档、系统提示词、UI「安装成功」使用同一最低证据：可用性 `ready`。创建、部署、发现分节。CLI 不出现不存在的 install/update |

## 7. 专家验收清单

勾选表示专家接受该句作为实施前提。必选项未勾选时，**禁止实施代码**。

### 7.1 证据追溯（先勾这三项）

- [x] D0=A 已由产品负责人确认（2026-10-10）。边界为私有仓 `https://github.com/upbeyond/openbot` 的 gateway 员工技能资产 / employee-install / 投影 / runtime binding。B/C/D 不适用。此项不表示 Phase 1 或 D5/D9 已批准实施
- [ ] 四个 permalink 已在私有仓调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089` 上打开：`employee-install.ts`、`runtime-binding-sync.ts`、`install-pack-to-robot.ts`、`skill-lifecycle-store.ts`
- [ ] 生产部署版本仍为 **待核实**；未核对前不得把闸门 A 勾成通过
- [ ] 已确认目标仓库是私有仓 `https://github.com/upbeyond/openbot`，不是公开的 `https://github.com/CopilotKit/OpenBot`
- [ ] 已确认本仓库 #545 为「Docs: 员工端技能进化通道现状分析」，draft 未合入，分支 `cursor/employee-skill-lifecycle-analysis-05dc`
- [ ] 已确认本仓库 #546 为本方案，draft，分支 `cursor/employee-skill-lifecycle-opt-plan-aa8c`
- [ ] 已确认 `93ce9df262b3666d83f64c559a5e7801e6bde089` 只是调查基线（#545 与本方案初稿相对当时 main 的 base），不是修订时的 `origin/main`（`833fb81bbc6e0cf12b98249c988d2f89a3fe52ab`，#544）
- [ ] 已理解：公开仓同号 #545 是编号撞车
- [ ] 已确认公开仓对这四个符号 0 命中，不能用来否定本仓分析

### 7.2 决定

- [x] D0=A 与 §3.3 表格一致（产品负责人，2026-10-10）。后续章节按 A 阅读。公开仓附录不适用
- [ ] D1 源策略（仅当准备走 D0=A）
- [ ] D2 创作只停在 draft
- [ ] D3 仅人工 finalize 可进入可执行
- [ ] D4 reviewing 维持可投影，或已另附收紧说明
- [ ] D5 新文案（四层状态；`installed` 只表示关系已建立）已勾选
- [ ] D6 不迁移 store，或已把迁移改为另页验收
- [ ] D7 只标明未采集，并区分观测 / 估算 / 治理决策
- [ ] D8 不实现 `openbot skills install/update`
- [ ] D9 已勾选（入口分类、UI 最低证据、重试、旧投影）。未勾选则不得开始 Phase 1

### 7.3 闸门与阶段

- [ ] 闸门 A 通过（含 D0、四文件 permalink、实施当时的 main HEAD 与生产版本核对；有差异则已列差异）
- [ ] 闸门 B 通过（仅 D0=A：D5/D9 已冻结，且写了与现有授权/工具筛选的映射）
- [ ] 确认：D0=A，并且垂直切片通过之后，才允许把 Phase 1 铺到全部安装入口
- [ ] 批准 Phase 0（此时仍然可以只停留在文档）
- [ ] 批准下一步仅做垂直切片的设计与验收勾选（创建或选择 → 保存 → 授权/安装 → 运行 → 撤销）。不批准在本步写产品代码
- [ ] 确认：D5/D9 落地须闸门 B 通过后另开独立实施 PR
- [ ] 批准 Phase 1（切片之后、先测后改；完成时须通过闸门 C）
- [ ] 批准 Phase 2A
- [ ] 批准 Phase 2B
- [ ] 批准 Phase 3 的「未采集」标注
- [ ] 明确不批准的阶段：\***\*\_\_\_\_\*\***
- [ ] 闸门 C 的 §6 矩阵将作为 Phase 1 完成条件，而不是开工条件

部分批准有效。只勾 Phase 0 时仍然禁止写代码。只勾 Phase 1 时，不得夹带 Phase 2B 的 surface 改名或 Phase 3 的公式修改。

### 7.4 阻塞项

- [ ] P0-1：D1–D3 已关闭开放设计
- [ ] P0-2：自动批准与默认打开 auto-evolution 被拒绝
- [ ] P0-3：D5/D9 已冻结，文档不会把单独的 `installed` 写成可执行
- [ ] P0-4：若批准 Phase 2A，实施前逐页核对分析 §6（未核对前保持 **待核实**）
- [ ] P2-4：ClawHub 不在 D1 的自动源里
- [ ] 下列阻塞若仍开放，则对应阶段不得开始：**\*\***\_\_\_\_**\*\***

### 7.5 实施禁令

- [ ] 在 D0、四个 permalink、以及（若 D0=A）D5/D9 与闸门 A/B 勾选之前，禁止修改产品实现、测试、默认配置、系统提示词与对外文档
- [x] 公开仓验收矩阵不适用于已冻结的 D0=A（见文末附录）
- [ ] 本 PR 只修订设计 Markdown，不含产品逻辑
- [ ] 实施 PR 必须引用阶段编号、已勾选的 D 编号，以及闸门 A/B 的核对记录。超范围改动视为未验收
- [ ] 阶段测试通过不得代替闸门 C

## 8. 验收通过前禁止实施代码

D0=A 已冻结。完整实施仍然暂缓，产品改动仍然禁止：

- 禁止修改 `src/`、`ui/`、`extensions/`、`skills/` 的产品行为或提示词。
- 禁止修改 `docs/tools/`、`docs/cli/`、`docs/zh-CN/`。
- 禁止把 `OPENBOT_SKILL_AUTO_EVOLUTION` 默认打开，禁止新增自动批准。
- 禁止把本修订中的推荐决定当成已经上线的产品语义。
- 禁止在闸门 A 未完成生产核对时，把调查基线 SHA 写成生产版本。
- 禁止在垂直切片设计与验收勾选完成之前实施 Phase 1、2A、2B、3。
- 禁止把 D5/D9 的状态机落地放进切片设计。落地须闸门 B 之后的独立实施 PR。

专家可以退回 D0=A。退回后，后续阶段全部回到未批准。退回 D5 或 D9 后，闸门 B 失效，分层状态的实施回到未批准。

## 9. 本轮边界

- 本轮只记录 D0=A 已由产品负责人确认，并收紧下一步工作包。改动限于本文件与 `docs/design/target-codebase-evidence-2026-10-10.md`。没有改产品逻辑、测试、配置或提示词。
- §1.4 的源码复核发生在调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089`。它不自动覆盖后来的 `main` 或生产部署。
- 未跑 gateway，未打开员工 UI，未访问生产。这些句子保持「待核实」。
- 公开仓内部机制（`save_skill`、`skills.yaml`、Learning）来自第二轮专家核验，本轮未在公开仓逐行复读。它们只用于划清边界。
- #545 未合入 `main` 时，分析全文只在该 PR 的分支上。审本文时请同时打开本仓库的 #545 与 #546，并打开四个 permalink。

## 附录：公开仓路径（不适用 D0=A）

D0 已冻结为 A。本附录只保留对照，**不适用于**私有仓 `https://github.com/upbeyond/openbot` 的验收。下列四行全部不适用。

| 要验证的事 | 公开仓侧的预期（专家第二轮）                | 不得误接到私有仓的方式                                              |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------- |
| 保存后分配 | `save_skill` 人工确认之后，不自动分配给 Bot | 不要用 `installSkillToRobotAsset` 的关系写入来代替这段验收          |
| 所有权     | 技能所有权与 Bot 授权分开                   | 不要把私有仓的 `linked` 直接叫成公开仓所有权                        |
| 工具交集   | 指令不等于能力授权；可用工具是授权交集      | 不要用「投影里出现了 SKILL.md」代替工具交集                         |
| 部署包重载 | `skills.yaml` 重载可以覆盖已保存技能        | 这不是 `ob-asset-<id>/SKILL.md` 投影，也不是 `syncInstallToRuntime` |

D0=A 时与上表相近、但必须改写后才能用的私有仓等价物是：关系是否授予这台机器人、投影资格（`EXECUTABLE_LIFECYCLES`）是否允许进入 loader、工具策略是否仍可能把技能滤掉、runtime binding 是否另有一套门。垂直切片要观察的是这四件事在下一轮执行里的合取结果，而不是把公开仓矩阵抄进测试名。
