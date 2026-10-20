# Design Document

> 特性：CLI 后端开箱闭环。需求见 `.kiro/specs/cli-backend-onboarding/requirements.md`。
>
> 一句话：给 CLI 后端**声明它暴露的模型**,把这些模型**桥接进 entitlement 熵权上界**,从而复用既有「套餐绑定 / 企业 entitlement / 席位授权 / 选路」全链路与 UI;凭证按"个人/企业"维度独立存储并在 spawn 时注入。**不重建** entitlement 链,**不**把 CLI 模型伪装成 HTTP provider。

## Overview

平台已具备:CLI 后端管理(panel + `cliBackend.*`)、entitlement 链(绑定/授权/gate/选路)、凭证 env 注入点。缺的只是三段"桥":

1. **目录桥**:让 CLI 后端声明的模型出现在熵权上界 `listConfiguredModelIds` 的等价集合中。
2. **凭证桥**:按企业/个人维度存储 API key,在 CLI spawn 时按优先级注入。
3. **引导桥**(可选增强):机器人对话内引导一次性前置(授权/登录)。

## Architecture

平台已具备:CLI 后端管理(panel + `cliBackend.*`)、entitlement 链(绑定/授权/gate/选路)、凭证 env 注入点。缺的只是三段"桥":

1. **目录桥**:让 CLI 后端声明的模型出现在熵权上界 `listConfiguredModelIds` 的等价集合中。
2. **凭证桥**:按企业/个人维度存储 API key,在 CLI spawn 时按优先级注入。
3. **引导桥**(可选增强):机器人对话内引导一次性前置(授权/登录)。

### 决策

### D1：CLI 后端声明结构化模型目录(P0-1 / P1-1)

- 在 `CliBackendConfig`(`src/config/types.agent-defaults.ts`)新增可选 `modelCatalog?: ModelCatalogEntry[]`(结构化:`id` + `displayName?` + `capabilities?{streaming,tools,vision}` + `visibility?`),**不**用裸字符串(避免"授权成功→运行失败")。
- `cliBackend.upsert` 接受 `modelCatalog`,写入该字段;`describeCliBackends` / `cliBackend.list` 回传。
- 不复用 `models.providers`(其 `ModelProviderSchema` `.strict()` 必填 `baseUrl`,塞 CLI 模型需伪造 baseUrl,语义错误且污染 HTTP provider 解析)。

### D1b：能力发现(Capability Discovery，P0-2)

- 新增 `cliBackend.capabilities`(读):返回 `{ backendId, models: ModelCatalogEntry[], features:{tools,streaming,vision}, source: "probe"|"declared" }`。
- 优先运行期探测(如 `command --help`/版本/能力探针),不可探测时降级为后端声明值并标注 `source`。

### D2：目录桥——扩展熵权上界(单点、最小侵入)

- 扩展 `listConfiguredModelIds(cfg)`(`src/gateway/model-entitlement/resolve-effective-model-set.ts`),在枚举 `cfg.models.providers.*` 之外,**追加** `agents.defaults.cliBackends.<id>.modelCatalog[].id` → `"<id>/<model>"`。
- 同步:`platform-model-binding.set` 的 `validateAllowedModelIdsAgainstCatalog` 自动放行(因其用同一上界);`computeEffectiveModelSet` 的目录交集自动纳入。
- **不变量**:该扩展只影响"上界/可授权集合",不改变运行路由——`isCliProvider` 在 `model-fallback` 的 run 回调内仍短路到 `runCliAgent`(已核实:无 auth profile 的 CLI provider 跳过冷却/鉴权分支)。
- **跨流注意**:`resolve-effective-model-set.ts` 属 ME(Model Entitlement Chain)landing stream;改动需与 ME owner 协调或经其集成,避免冲突。

### D3：凭证桥——SecretRef-First + 使用治理 + 归因(P0-3 / P0-4 / P1-2)

- **SecretRef-First(P0-3)**:存储层只存**引用** `SecretRef = { type, ref }`,`type ∈ encrypted-local(默认) | vault | aws-secrets | azure-keyvault | gcp-secret`。运行期由**可插拔解析器**(`SecretRefResolver`)按 type 解析真实密钥;`encrypted-local` 走本地加密项,其余对接外部 KMS。未来对接企业 KMS **无需重构**存储与注入路径。
- `CliBackendCredentialStore`(tenant/seat 维度 JSON,落 `CONFIG_DIR`)只持有 `Record<envVar, SecretRef>`,**不落明文**。
- **凭证使用治理(P0-4)**:`CredentialBinding { credentialId, allowedBackends?, allowedModels?, allowedRoles? }`。解析某次运行凭证时,仅当 binding 允许 `(backendId, model, role)` 才注入;否则回退下一优先级或拒绝(fail-safe)。默认绑定 = 仅限声明该凭证的后端(最小可用)。
- 解析优先级(R4.4):个人/席位 → 企业共有 → 平台/主机默认(`CliBackendConfig.env`)。
- 注入点:`cli-runner` 组装子进程 env 处(`{ ...process.env, ...backend.env, ...resolvedCredEnv }` 再 `clearEnv`)。把运行的 tenant/seat/role 上下文传入(复用 `resolve-agent-run-scope.ts`)。
- **使用归因(P1-2)**:执行完成写 `UsageAttribution { tenantId, userId, backendId, credentialId, model, executionId }`,接入既有 Fabric 审计 / usage-ingest(不新建计费引擎)。
- **一键校验(P1-3)**:`cliBackend.verifyCredential` 对 (后端+凭证) 做最小校验,返回 `{ valid, models?, error? }`,有界超时、脱敏、写审计。
- **安全评审项(交付前置,R5.3)**:本地加密落盘、文件权限、SecretRef 解析隔离、读取审计、绝不日志明文。

### D4：平台一次配置 → 授权(复用既有,不新建 UI 存储)

- CLI 后端 panel 增"结构化模型目录(modelCatalog)"输入 + "一键纳入默认套餐/授权"快捷入口(调既有 `platform-model-binding.set` / `enterprise-model-grant.grant`)+ 凭证「校验」按钮(`verifyCredential`)。
- "对全部租户默认可用":沿用默认 `enforce=missing-allow` 且不写 entitlement 记录即放行的语义(界面明示);需精确授权时走绑定/grant。

### D5：终端用户体验(零配置)

- 不在企业/员工端暴露 CLI 后端配置(维持现状)。
- 机器人对话引导一次性前置(如企业 API key 未配置时,提示企业管理员去平台/企业端配置;个人 key 经员工端最小入口或对话内安全收集——**不**要求用户本机命令行操作)。

### D6：Fabric 长期对齐(统一为 Governed AI Capability)

把 Claude Code / Codex / Cursor / Kiro / Windsurf 等统一为"Governed AI Capability",经同一治理管线:

```
CLI Backend → Capability Discovery → Model Catalog → Entitlement
            → Credential Binding → Execution → Audit → Billing
```

不再区分"模型 / CLI / Agent",企业客户以统一形态采购与治理。本 spec 的 D1–D5 即该管线在 CLI 后端方向的落地,与 OpenBot Fabric(执行治理/审计)天然衔接。

## Components and Interfaces

- **CliBackend 管理**(`src/gateway/server-methods/cli-backend.ts` + `src/agents/cli-backend-admin.ts`):`cliBackend.list/upsert/remove/test`,新增 `cliBackend.capabilities`(发现)、`cliBackend.verifyCredential`(校验)、`cliBackend.credential.set/remove/list`(凭证)。
- **熵权上界**(`src/gateway/model-entitlement/resolve-effective-model-set.ts` 的 `listConfiguredModelIds`):Phase 1 追加 CLI `modelCatalog` 模型。
- **绑定/授权**(既有,复用):`platform-model-binding.set/get/list`、`enterprise-model-grant.grant/revoke/list`。
- **凭证**(Phase 2 新增):`CliBackendCredentialStore` + `SecretRefResolver`(可插拔:encrypted-local/vault/aws/azure/gcp)+ `CredentialBinding` 治理;解析器在 `cli-runner` env 组装处注入;执行写 `UsageAttribution`。
- **平台 UI**:`ui/src/ui/ports/platform/advanced/cli-backend-panel.ts`(已建,扩展:结构化模型目录 + 能力发现展示 + 凭证校验 + 一键授权)。

## Data Models

- `CliBackendConfig`(`src/config/types.agent-defaults.ts`)新增 `modelCatalog?: ModelCatalogEntry[]`(P0-1/P1-1,结构化,替代裸字符串):
  - `ModelCatalogEntry = { id; displayName?; visibility?: "enterprise" | "platform"; capabilities?: { streaming?; tools?; vision? } }`。
- `SecretRef`(P0-3):`{ type: "encrypted-local" | "vault" | "aws-secrets" | "azure-keyvault" | "gcp-secret"; ref: string }`。
- `CliBackendCredential`(Phase 2):`{ tenantId; scope: "enterprise" | "personal"; subjectId?; backendId; envVars: Record<string, SecretRef>; updatedAt }`,与 entitlement 解耦。
- `CredentialBinding`(P0-4):`{ credentialId; allowedBackends?; allowedModels?; allowedRoles? }`。
- `UsageAttribution`(P1-2):`{ tenantId; userId; backendId; credentialId; model; executionId; occurredAt }`(凭证以 id/引用记录,无明文)。
- 运行期模型引用:`"<backendId>/<model>"`(provider 段 = backendId)。

## 数据流

```
平台管理员: 配置 CLI 后端(command/args/exposedModels) + (企业/个人)API key
        │
        ▼  cliBackend.upsert → agents.defaults.cliBackends.<id> + exposedModels
        ▼  (D2) listConfiguredModelIds 纳入 <id>/<model>
        ▼  platform-model-binding.set / enterprise-model-grant.grant(既有)
        ▼  EffectiveModelSet = 企业 ∩ 席位 ∩ 目录(含 CLI 模型)
终端用户(手机/电脑客户端): 对话 → bot 模型解析为 <id>/<model>
        ▼  employee-model-gate 放行(在授权集合内)
        ▼  runWithModelFallback → isCliProvider 短路 → runCliAgent
        ▼  cli-runner spawn(注入 个人/企业/主机 凭证 env)→ 结果回对话
```

## Correctness Properties

### Property 1: 桥接不改运行路由

CLI 后端模型进入熵权上界后,运行仍经 `runCliAgent`,不被当作 HTTP provider。**Validates: Requirements 1.3**

### Property 2: 一视同仁的授权

CLI 模型与普通模型在 `computeEffectiveModelSet` 中等价参与交集;授权后终端用户纯对话可用。**Validates: Requirements 1.2, 2.1, 3.1**

### Property 3: 凭证隔离与优先级

凭证按个人→企业→主机解析、脱敏、与 entitlement 解耦。**Validates: Requirements 4.3, 4.4, 4.5**

### Property 4: 零回归

未声明 exposedModels / 未配置凭证时,熵权上界与运行路径逐字节不变。**Validates: Requirements 5.2**

### Property 5: 受控可审计

增删改/凭证写入限管理员 + 审计。**Validates: Requirements 5.1**

## Error Handling

- exposedModels 含非法 id → 拒绝写入(zod)。
- 凭证存储不可用/解密失败 → fail-safe:不注入该凭证,回退下一优先级;绝不明文兜底。
- 上界扩展遇空 cliBackends → 返回原集合(无副作用)。

## Testing Strategy

1. `listConfiguredModelIds` 单测:含/不含 exposedModels 的上界。
2. `computeEffectiveModelSet` 单测:CLI 模型经企业∩席位∩目录被授权/被拒。
3. 凭证存储单测:优先级、脱敏、加密往返、缺失回退。
4. 零回归:未声明时上界与既有断言不变;运行路由仍走 CLI。
5. 端到端(可行时):配置后端+exposedModels → 绑定/grant → 模拟 employee 会话 gate 放行 → cli-runner 注入凭证。
