# Requirements Document

> 特性：**CLI 后端开箱闭环（CLI Backend Onboarding Closure）**
>
> 目标：平台管理员**配置一次** CLI 后端(如 `kiro-cli`)及其暴露的模型,终端用户即可从**手机 App / 办公电脑(app/web)** 聊天客户端**纯对话使用**——无需个人配置、无需逐次审核;如需配置也只是配置**个人或企业共有的 API key**。
>
> 关联子系统(已在仓库内,经 context-gather 核实):
>
> - CLI 后端执行:`src/agents/cli-backends.ts`、`src/agents/cli-runner.ts`(在**网关主机**上 spawn,非用户终端)
> - CLI 后端管理:`src/gateway/server-methods/cli-backend.ts`、`src/agents/cli-backend-admin.ts`、平台 UI `ui/src/ui/ports/platform/advanced/cli-backend-panel.ts`
> - 模型 entitlement 链:`src/gateway/model-entitlement/*`(`resolve-effective-model-set.ts` 的 `listConfiguredModelIds`、`enterprise-model-entitlement-store.ts`、`seat-model-grant-store.ts`、`plan-version-model-binding-store.ts`、`employee-model-gate.ts`、`entitlement-config.ts`)
> - 运行接入:`src/agents/model-selection.ts`(`isCliProvider`)、`src/agents/model-fallback.ts`(`applyEntitlementHardDeny`)
> - 凭证解析:`src/agents/model-auth.ts`(`resolveApiKeyForProvider`)、CLI 经 `CliBackendConfig.env`/`clearEnv` 注入

## Introduction

本特性把"平台配置 CLI 后端"与"终端用户纯对话使用"打通成一条闭环:平台管理员配置一次 CLI 后端及其暴露模型(并按企业/个人配置 API key),该模型即通过既有 model-entitlement 链被授权,终端用户从手机/电脑聊天客户端无需任何个人配置、无需逐次审核即可对话使用。本文档界定该闭环的需求边界与验收标准。

## Glossary

- **CLI 后端(CLI backend)**:把编程 agent 的命令行(claude/codex/kiro 等)作为机器人模型后端,在网关主机 spawn 执行。
- **暴露模型(exposed model)**:某 CLI 后端声明可对外提供的**结构化** model 目录项(`{ id, displayName?, capabilities? }`),运行时引用为 `<backendId>/<model>`。
- **能力发现(Capability Discovery)**:运行期探测某 CLI 后端实际支持的模型与特性(tools/streaming/vision),供管理员"所见即所得"地授权。
- **SecretRef**:凭证的**引用**而非明文——可指向 `encrypted-local` / `vault` / `aws-secrets` / `azure-keyvault` / `gcp-secret`;存储层只存引用,运行期按引用解析真实密钥。
- **CredentialBinding**:凭证使用治理——约束某凭证"允许哪些后端 / 哪些模型 / 哪些角色"消费,防止个人/企业 key 被任意后端串用。
- **使用归因(Usage Attribution)**:每次执行记录 `{ tenantId, userId, backendId, credentialId, model, executionId }`,作为 chargeback / 成本中心 / 团队计费基础。
- **熵权上界(catalog upper bound)**:`listConfiguredModelIds(cfg)` 计算出的"平台目录(active)"模型全集,是 EffectiveModelSet 三交集之一。
- **EffectiveModelSet**:企业 entitlement ∩ 席位/员工 grant ∩ 熵权上界,运行期模型授权结果。
- **enforce 模式**:`gateway.platform.models.entitlement.enforce` ∈ `off | missing-allow(默认) | strict`。
- **终端用户**:从手机 App / 办公电脑(app/web)聊天客户端与机器人对话的使用者(执行发生在平台侧,非其本机)。
- **Fabric 对齐**:把 Claude Code / Codex / Cursor / Kiro / Windsurf 等统一为"Governed AI Capability",经 Capability Discovery → Model Catalog → Entitlement → Credential Binding → Execution → Audit → Billing 同一治理管线。

## 背景与已核实的关键事实

- **熵权上界 = `listConfiguredModelIds(cfg)` = `cfg.models.providers.<provider>.models[].id`**。CLI 后端配置在 `agents.defaults.cliBackends`,因此 `kiro-cli/<model>` **默认不在熵权上界内**。
- 后果:在 `gateway.platform.models.entitlement.enforce` 为 `strict`(或 `missing-allow` 且租户已有 entitlement 记录)时,`kiro-cli/<model>` 候选会被 `applyEntitlementHardDeny` 硬过滤掉(零出网);且 `platform-model-binding.set` 因 `validateAllowedModelIdsAgainstCatalog` 拒绝绑定。
- 在默认 `missing-allow` 且租户**无** entitlement 记录时,gate 放行(`allowlist=undefined`),CLI 模型当前已可直接运行。
- `ModelProviderSchema` 为 `.strict()` 且**必填 `baseUrl`**,因此不能简单地把 CLI 模型塞进 `models.providers`(需伪造 baseUrl,语义错误)。
- **当前不存在按企业/按席位的 provider 凭证存储**;entitlement 层只承载 modelId 引用,不含凭证。CLI 凭证今天只能经 `CliBackendConfig.env` 注入(平台/主机级共享)。
- CLI 后端在**网关主机**执行,不在用户终端;用户(手机/电脑客户端)只发消息。

## Requirements

### Requirement 1: CLI 后端模型纳入熵权上界(打通 entitlement 链)

**User Story:** 作为平台管理员,我希望我配置的 CLI 后端所暴露的模型能被既有的套餐绑定 / 企业 entitlement / 席位授权链识别与管理,以便在任意 enforce 模式下都能授权给终端用户,而不是只在"未强制"时偶然可用。

#### Acceptance Criteria

1. WHEN 一个 CLI 后端声明了其暴露的模型 id 列表 THEN 系统 SHALL 使这些 `provider/model` 进入熵权上界(被 `listConfiguredModelIds` 或其等价上界枚举识别),无需为其在 `models.providers` 伪造 `baseUrl`。
2. WHEN 计算 `EffectiveModelSet` 时 THEN CLI 后端模型 SHALL 与既有模型一视同仁地参与"企业 entitlement ∩ 席位 grant ∩ 目录(active)"交集。
3. 该桥接 SHALL NOT 改变 CLI 后端的运行路由:`isCliProvider` 命中的 provider 仍 SHALL 经 `runCliAgent` 执行,SHALL NOT 被当作 HTTP provider 解析 baseUrl/apiKey。
4. WHEN CLI 后端被删除或其暴露模型被移除 THEN 对应模型 SHALL 同步退出熵权上界。
5. 暴露模型 SHALL 为**结构化目录项** `{ id, displayName?, capabilities?: { streaming?, tools?, vision? } }`,SHALL NOT 为自由字符串(避免"授权成功→运行失败",P0-1);该集合 SHALL 命名为 `modelCatalog` 并为 `visibility`(`enterprise`/`platform`)预留(P1-1)。

### Requirement 7: 能力发现(Capability Discovery，P0-2)

**User Story:** 作为平台管理员,我希望发现某 CLI 后端**实际**支持哪些模型与特性(tools/streaming/vision),以便所见即所得地授权,而非凭猜测填写后等用户报错。

#### Acceptance Criteria

1. 系统 SHALL 提供 `cliBackend.capabilities`(读),返回 `{ backendId, models: ModelCatalogEntry[], features: { tools?, streaming?, vision? } }`。
2. 能力发现 SHALL 标注来源(运行期探测 vs 管理员声明);不可探测时 SHALL 安全降级为声明值。
3. WHEN 不同后端(Claude Code / Codex / Kiro)能力差异较大 THEN 该接口 SHALL 各自如实反映,SHALL NOT 假设统一能力集合。

### Requirement 2: 平台一次配置 → 可绑定套餐 / 授权席位

**User Story:** 作为平台管理员,我希望在配置 CLI 后端后,用既有的「套餐⇄模型」绑定与「企业/席位授权」界面把该模型授权下去,以便一次配置后对目标租户/席位长期生效。

#### Acceptance Criteria

1. WHEN CLI 后端模型已进入熵权上界 THEN `platform-model-binding.set` SHALL 接受将其绑定到套餐版本(不再因目录校验拒绝)。
2. 系统 SHALL 复用既有 `enterprise-model-grant.*` / `platform-model-binding.*` 方法与 UI 完成企业 entitlement 与席位 grant,SHALL NOT 新建并行授权存储。
3. WHEN 平台希望"对全部租户默认可用" THEN 系统 SHALL 提供一种明确方式(例如默认 `missing-allow` 下不写 entitlement 记录即放行,或提供一键纳入默认套餐),并在文档/界面说明该语义。

### Requirement 3: 终端用户纯对话使用(零个人配置 / 零逐次审核)

**User Story:** 作为终端用户(手机 App / 办公电脑 app/web),我希望直接和机器人对话即可使用平台已打通的第三方工具能力,无需在我侧做任何配置,也无需为每次使用申请审核。

#### Acceptance Criteria

1. WHEN 某机器人的模型解析为已授权的 CLI 后端模型 THEN 终端用户 SHALL 仅通过对话即可触发其执行,SHALL NOT 需要在用户侧安装/配置任何东西。
2. 终端用户 SHALL NOT 看到或需要操作 CLI 后端的任何配置(沿用现状:无企业端/员工端 CLI 后端配置界面)。
3. 运行期危险动作(CLI 内部的 bash/git 等)SHALL 仍走既有 exec-approval / sandbox / Fabric 治理;"零逐次审核"指**模型可用性**层面,SHALL NOT 解除工具执行层既有安全门(危险命令仍可触发审批)。
4. 机器人 SHALL 能在对话中引导用户完成必要的一次性前置(如登录/授权 API key),且该引导 SHALL NOT 要求用户在本机命令行操作。

### Requirement 4: 个人 / 企业共有 API key（SecretRef-First，P0-3）

**User Story:** 作为企业管理员或个人用户,我希望按企业或个人维度配置第三方工具的 API key,凭证以**引用(SecretRef)**形式存储、由平台按归属注入到执行,以便未来对接 Vault / AWS / Azure / GCP 等密钥管理而无需重构。

#### Acceptance Criteria

1. 系统 SHALL 支持为 CLI 后端配置**企业共有** API key(企业内全体共享)。
2. 系统 SHOULD 支持**个人/席位级** API key(覆盖企业共有),作为可选增强。
3. 凭证存储 SHALL 为 **SecretRef-First**:存储层只保存**引用**而非明文,引用类型 SHALL 可扩展为 `encrypted-local`(默认)/ `vault` / `aws-secrets` / `azure-keyvault` / `gcp-secret`;运行期按引用解析真实密钥(P0-3)。
4. WHEN 执行某 CLI 后端运行时 THEN 系统 SHALL 按"个人 → 企业共有 → 平台/主机默认"的优先级解析 SecretRef,并以 env 注入到该 CLI 子进程(复用 `CliBackendConfig.env`/`clearEnv` 注入点)。
5. 凭证 SHALL NOT 出现在审计/日志明文中(复用既有脱敏:仅按 key 名/引用引用)。
6. 凭证存储 SHALL 与 entitlement 层解耦(entitlement 只承载 modelId,凭证走独立存储)。

### Requirement 8: 凭证使用治理（Credential Scope Governance，P0-4）

**User Story:** 作为企业安全负责人,我希望约束"哪个凭证允许被哪些后端 / 哪些模型 / 哪些角色消费",以防个人或企业 key 被任意后端串用而无法审计。

#### Acceptance Criteria

1. 系统 SHALL 提供 `CredentialBinding`:`{ credentialId, allowedBackends?: string[], allowedModels?: string[], allowedRoles?: string[] }`。
2. WHEN 解析某次运行的凭证 THEN 系统 SHALL 仅在 binding 允许该 `(backendId, model, role)` 组合时注入该凭证;不满足 SHALL 回退下一优先级或拒绝(fail-safe)。
3. 默认绑定(未显式约束)SHALL 采取最小可用语义并在文档明示(例如默认仅限声明该凭证的后端)。

### Requirement 9: 使用归因（Usage Attribution，P1-2）

**User Story:** 作为企业管理员,我希望每次 CLI 后端执行都记录"谁用哪个凭证花了多少",以支撑 chargeback / 成本中心 / 团队计费。

#### Acceptance Criteria

1. WHEN 一次 CLI 后端执行完成 THEN 系统 SHALL 记录归因 `{ tenantId, userId, backendId, credentialId, model, executionId }`(凭证以 id/引用记录,绝不含明文)。
2. 该归因 SHALL 接入既有计费/审计口径(复用 Fabric 审计 / usage-ingest),SHALL NOT 新建并行计费引擎。

### Requirement 5: 安全与零回归

**User Story:** 作为平台负责人,我希望该闭环不放宽既有安全姿态,且写操作受控可审计。

#### Acceptance Criteria

1. CLI 后端的增删改、模型暴露、凭证写入 SHALL 限平台/企业管理员作用域(对应 ADMIN/企业管理员),并写控制面审计。
2. WHEN 该特性未启用或未配置 THEN 既有模型选择 / entitlement / 运行路径 SHALL 逐字节不变(零回归)。
3. 引入的凭证存储 SHALL 经过安全评审项标注(密钥落盘加密/权限/脱敏/SecretRef 解析隔离),作为交付前置。

### Requirement 6: 凭证一键校验（One-Click Verification，P1-3）

**User Story:** 作为平台/企业管理员,我希望配置完 API key 后点一下"校验"就能确认凭证有效、可用模型有哪些,而不是等用户报错。

#### Acceptance Criteria

1. 系统 SHALL 提供 `cliBackend.verifyCredential`(管理员作用域),对给定后端 + 凭证执行一次最小校验,返回 `{ valid: boolean, models?: ModelCatalogEntry[], error? }`。
2. 校验 SHALL 在有界超时内完成,SHALL NOT 泄露明文凭证,结果与动作 SHALL 写审计。
