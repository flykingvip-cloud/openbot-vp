# Implementation Plan

> 特性：CLI 后端开箱闭环。需求 `requirements.md`,设计 `design.md`。
>
> 分阶段:Phase 1(目录桥,让 CLI 模型可被既有 entitlement 链授权)→ Phase 2(凭证桥,个人/企业 API key)→ Phase 3(平台 UI 一键授权 + 对话引导)。
>
> **跨流提示**:Task 2 改 `resolve-effective-model-set.ts`(ME landing stream),需与 ME owner 协调集成。其余多在 `src/agents/cli-backend*` / `src/gateway/server-methods/cli-backend.*` / 平台 UI(本会话已建)内。

## Overview

把"平台配置 CLI 后端"打通到"终端用户纯对话使用":Phase 1 让 CLI 暴露模型进入 entitlement 熵权上界并复用既有授权链;Phase 2 引入企业/个人 API key 的独立加密存储与注入;Phase 3 补平台一键授权 UI 与对话引导。

## Tasks

### Phase 1 — 目录桥(打通 entitlement 上界)

- [x] 1. `CliBackendConfig` 增结构化 `modelCatalog?: ModelCatalogEntry[]`（P0-1/P1-1）
  - 在 `src/config/types.agent-defaults.ts` 加 `modelCatalog?: ModelCatalogEntry[]`(`{ id; displayName?; visibility?; capabilities?{streaming,tools,vision} }`);在 `src/agents/cli-backend-admin.ts` 的 `CliBackendConfigSchema` 加对应结构化校验(id 为非空 slug)。
  - ✅ 已完成:`CliBackendModelCatalogEntry` 类型 + `CliBackendModelCatalogEntrySchema`(admin)+ `CliBackendSchema`(config 写入校验)均含 `modelCatalog`;预设(claude/codex/kiro)带结构化目录;`listCliBackendCatalogModelRefs` 提供 `<id>/<model>` 上界来源。— kiro-fabric
  - _Requirements: 1.1, 1.5_

- [x] 11. 能力发现 `cliBackend.capabilities`（P0-2）
  - 读方法:返回 `{ backendId, models, features:{tools,streaming,vision}, source:"probe"|"declared" }`;优先运行期探测,降级声明值并标注 source。
  - ✅ 已完成:`describeCliBackendCapabilities`(聚合声明目录,source="declared")+ gateway 读方法 `cliBackend.capabilities`(READ scope);运行期探测留后续 source="probe"。— kiro-fabric
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 2. 扩展熵权上界纳入 CLI 模型（ME 协调）
  - `listConfiguredModelIds(cfg)`(`src/gateway/model-entitlement/resolve-effective-model-set.ts`)在枚举 `models.providers.*` 后追加 `agents.defaults.cliBackends.<id>.modelCatalog[].id` → `"<id>/<model>"`,去重。
  - ✅ 已完成:**内联枚举**(零新依赖,不 import agents 层,避免给 ME 模块引入耦合);未声明 modelCatalog 的后端不产生条目(零回归)。新增 `list-configured-model-ids.test.ts`。model-entitlement 全套 85 测试通过。— kiro-fabric
  - 单测:含/不含 modelCatalog 的上界;空 cliBackends 不变。
  - _Requirements: 1.1, 1.2, 1.4, 5.2_

- [x] 3. `cliBackend.upsert/list/remove` 携带结构化 modelCatalog
  - upsert 接受 `modelCatalog` 写入;list/describe 回传;remove 同步清理(模型随后端移除而退出上界,R1.4)。
  - ✅ 已完成:`upsert` 经 `validateCliBackendConfig` 透传 `modelCatalog`;`list` 的 `describeCliBackends.effective` 含 `modelCatalog`;`remove` 删整个后端条目;平台面板列表新增"模型"列 + 编辑表单 modelCatalog 输入。— kiro-fabric
  - 单测:list 含 modelCatalog;remove 后上界不再含其模型。
  - _Requirements: 1.1, 1.4, 1.5_

- [x] 4. 验证运行路由不变 + 绑定放行
  - 断言:`models.providers` 未加 CLI 条目;`isCliProvider` 仍短路 `runCliAgent`;`platform-model-binding.set` 现接受 CLI 模型(因上界已含)。
  - ✅ 已闭环:CLI 模型仅经 `listConfiguredModelIds` 桥接进上界(不写 `models.providers`,运行路由不变,Property 1);`platform-model-binding.set` 的 `validateAllowedModelIdsAgainstCatalog` 用同一上界,自动接受已声明 CLI 模型;`applyEntitlementHardDeny` 在授权集合含 `<id>/<model>` 时放行(model-fallback 既有逻辑,CLI 候选与普通候选同构)。— kiro-fabric
  - _Requirements: 1.3, 2.1_

### Phase 2 — 凭证桥(SecretRef-First + 治理 + 归因)

- [x] 5. SecretRef-First 凭证存储 + 可插拔解析器（P0-3）
  - `CliBackendCredentialStore`(tenant/seat 维度 JSON,只存 `Record<envVar, SecretRef>`,**不落明文**);`SecretRefResolver` 按 `type` 解析(`encrypted-local` 默认走本地加密;预留 `vault`/`aws-secrets`/`azure-keyvault`/`gcp-secret` 适配位)。
  - ✅ 已完成,**复用既有 SecretRef**(`{source: env|file|exec, provider, id}`):**exec source 已覆盖 Vault/AWS/Azure/GCP**(经 exec 命令取密),故无需自造 `{type:...}`;存引用、不存明文 → 无落盘加密需求(更强姿态)。`cli-backend-credential-store.ts`(upsert/remove/list/bind + `selectCredentialForRun` 优先级)+ `cli-backend-credential-resolve.ts`(`resolveSecretRefString` 解析,fail-safe 全有或全无)。14 测试。— kiro-fabric
  - _Requirements: 4.1, 4.2, 4.3, 4.6, 5.3_

- [x] 12. 凭证使用治理 `CredentialBinding`（P0-4）
  - `{ credentialId, allowedBackends?, allowedModels?, allowedRoles? }` + 校验器;默认绑定 = 仅限声明该凭证的后端。
  - ✅ 已完成:`bindingAllows(ctx)` + `selectCredentialForRun` 集成 binding 过滤;允许/拒绝矩阵单测(backend×model×role)。— kiro-fabric
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 6. 凭证解析 + 注入 cli-runner（含 binding 校验 + 归因）
  - 解析优先级 个人/席位 → 企业共有 → 主机默认(`CliBackendConfig.env`);经 `CredentialBinding` 校验后,把 tenant/seat/role 上下文传入 `cli-runner`(复用 `resolve-agent-run-scope.ts`),在子进程 env 组装处注入,再 `clearEnv`。
  - ✅ 已完成:`resolveCliBackendCredentialEnv`(优先级解析 + binding via `selectCredentialForRun`,fail-safe)+ `cli-runner` 增 `credentialEnv` 注入口(在 `clearEnv` 之后注入,凭证恒胜;值不记日志;单测验证)。
  - ✅ 调用点接线已落地:reply 路径 `agent-runner-execution.ts` 的 CLI 分支内,`resolveAgentRunEntitlementScope`(按 bot 归属席位解析 tenant/subject)→ `resolveCredentialForRun`(选取+解析凭证,返回 `{env, credentialId}`)→ `runCliAgent({credentialEnv})`;try/catch fail-safe(任一环节失败 → undefined → 回退主机默认 env,未配置凭证零回归)。新增 `cli-backend-credential-resolve.test.ts`(10 测试)。`cli-runner.*` 已注册进 cli-backend 隔离流。— kiro-fabric
  - ✅ 三处调用点全部接线:reply(`agent-runner-execution.ts`,ME 流)、cron 隔离运行(`src/cron/isolated-agent/run.ts`,ME 流)、本地 CLI 命令(`src/commands/agent.ts`,H1D 流,CLI 分支包 async IIFE)。
  - ✅ UsageAttribution(R9.1/9.2)已落地:`cli-backend-usage-attribution.ts` —— append-only JSONL 记录 `{tenantId,userId,backendId,credentialId,model,executionId,occurredAt}`,**审计归因非计费引擎**(R9.2,token/credit 计量仍走既有 `record-credit-usage`/`usage-ingest`),凭证仅以 id 记录(无明文),best-effort(绝不抛错/阻塞运行)。三处调用点在运行成功后 `void recordCliBackendUsage(...)`。新增 `cli-backend-usage-attribution.test.ts`(3 测试)。— kiro-fabric
  - _Requirements: 4.4, 8.2, 9.1, 9.2_

- [x] 7. 凭证管理 gateway 方法（管理员/企业管理员作用域 + 审计）
  - `cliBackend.credential.set/remove/list`(企业共有:企业管理员;个人:本人/席位),写 SecretRef(非明文);`cliBackend.verifyCredential`(P1-3)做最小校验返回 `{valid,models?,error?}`。写控制面审计,值脱敏。
  - ✅ 已完成:`cliBackend.credential.list`(READ)+ `set/remove/bind`(ADMIN,审计,拒绝明文)+ `cliBackend.verifyCredential`(ADMIN,经 `verifyCliBackendCredential` 解析 SecretRef,只回 valid/resolvedKeys/failedKeys,无值)。9 handler 测试。— kiro-fabric
  - _Requirements: 4.1, 4.2, 5.1, 6.1, 6.2_

### Phase 3 — 平台 UI 一键授权 + 对话引导

- [x] 8. CLI 后端 panel 增"暴露模型 + 能力发现 + 凭证校验"
  - panel 增结构化 modelCatalog 输入(id/显示名)+ 能力发现展示(`cliBackend.capabilities`)+ 凭证「校验」按钮(`verifyCredential`)。
  - ✅ 已完成:平台面板 `cli-backend-admin-section` 每行新增「能力」按钮 → `cliBackend.capabilities` 渲染声明特性(streaming/tools/vision)+ 模型目录表;新增租户维度凭证管理区(list/set/verify/remove)。「纳入默认套餐/授权席位」快捷入口跨入 `platform-model-binding` 独立能力,留独立 UI(既有 platform-model-binding section 已提供),不在本面板重复。3 browser 测试。— kiro-fabric
  - _Requirements: 2.1, 2.3, 3.2, 6.1_

- [x] 9. 凭证配置入口（平台代管企业共有 key）
  - 平台管理员在面板代企业租户配置企业共有 API key(SecretRef-First:`NAME = source:provider:id`,绝不明文;exec 覆盖 Vault/AWS/Azure/GCP)。沿用 CLI 后端对终端用户不可见的边界——仅"key 配置"暴露,后端 command/args 不暴露。
  - ✅ 已完成:凭证管理区支持 enterprise/personal 作用域、SecretRef 行解析、校验/删除;经 ADMIN 作用域 `cliBackend.credential.*`。员工端个人 key 独立入口(可选)未做——平台代管已满足闭环,且用户要求"平台端为主、不产品化"。— kiro-fabric
  - _Requirements: 4.1, 4.2, 3.2_

- [x] 10. 对话引导（一次性前置)
  - 当企业/个人 API key 未配置导致运行失败时,机器人对话内给出"去何处配置"的引导,不要求用户本机命令行操作。
  - ✅ 已完成:`cli-backend-credential-guidance.ts`(`isLikelyCredentialError` 识别 401/403/unauthorized/invalid api key/not logged in/`*_API_KEY` 等 + `buildCliBackendCredentialGuidance` 指向"高级治理 → 协作工具 → 凭证",明示无需本机命令);reply 路径 `agent-runner-execution.ts` 外层 catch 在 CLI 后端 + 凭证类错误时返回该引导。4 helper 测试。— kiro-fabric
  - _Requirements: 3.4_

## 验收门

- Phase 1 完成 = CLI 模型可经既有链路授权、终端用户在已授权下纯对话可用(凭证走主机 env)。
- Phase 2 完成 = 个人/企业 API key 隔离注入。
- Phase 3 完成 = 平台一键授权 + 对话引导,体验闭环。
- 全程零回归(Property 4)+ 写操作受控审计(Property 5)。

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "11"],
      "rationale": "结构化 modelCatalog schema + 能力发现,基础无依赖"
    },
    {
      "wave": 2,
      "tasks": ["2", "3", "5", "12"],
      "rationale": "上界扩展(ME协调)/upsert携带/SecretRef存储/凭证治理,依赖任务1或独立"
    },
    {
      "wave": 3,
      "tasks": ["4", "6", "7"],
      "rationale": "路由验证依赖2/3;凭证注入+归因依赖5/12;凭证+校验方法依赖5"
    },
    {
      "wave": 4,
      "tasks": ["8", "9"],
      "rationale": "平台一键授权+校验UI依赖2/3/4/7;凭证配置入口依赖7"
    },
    { "wave": 5, "tasks": ["10"], "rationale": "对话引导依赖9凭证入口就绪" }
  ]
}
```

- Phase 1(1→2/3→4)可独立交付。Phase 2(5→6/7)依赖 Phase 1 已让模型可授权。Phase 3(8/9/10)依赖前两阶段方法就绪。

## Notes

- 专家评审采纳(P0/P1):结构化 modelCatalog(P0-1)、能力发现(P0-2)、SecretRef-First 凭证(P0-3)、凭证使用治理 CredentialBinding(P0-4)、使用归因(P1-2)、一键校验(P1-3)、命名为 catalog 含 visibility(P1-1)。
- 安全前置(R5.3):Phase 2 凭证存储需通过本地加密 / 文件权限 / SecretRef 解析隔离 / 脱敏的安全评审后方可交付。
- 跨流:Task 2 触及 ME(Model Entitlement Chain)stream 的 `resolve-effective-model-set.ts`,落地需与该 stream owner 协调或经其集成。
- 不重建 entitlement 链、不把 CLI 模型伪装为 HTTP provider(`ModelProviderSchema` 必填 baseUrl)。
- Phase 3 完成 = 平台一键授权 + 对话引导,体验闭环。
- 全程零回归(Property 4)+ 写操作受控审计(Property 5)。
