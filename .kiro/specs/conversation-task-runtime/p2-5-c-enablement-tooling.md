# ConversationTask Runtime — C 启用运维工具 设计与准入(C-enablement ops tooling)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-5-production-readiness.md`(§8 放行 C 复验清单)、`./p2-5-ac-a1-privacy-signoff-request.md`(AC-cond-1..4)、`./p2-5-production-integration.md`(§0 边界)、`./execution-plan.md`(§14 五 flag / §16 门禁)
> 状态: **服务 + CLI 已落地；默认仍休眠**。`--json` 在子命令后也会生效。租户001 本地 shadow 金丝雀测试已覆盖（HMAC 仅测试内存、无明文落盘）。命令存在不等于放行 C。不改任何默认 flag。
> 基线: `origin/main` + 本切片 enablement tooling。

## 0. 目的与边界

放行 C(shadow 金丝雀)= 运维为**内部租户**打开 `detection`/`qualification` 并把该租户加入 allowlist。但当前**没有任何受支持的运维入口**去做这件事——`config-store` 的 `setFlag`/`setTenantAllow` 是持久化 SQLite admin API,却无 CLI/网关调用方(已 grep 核实)。运维今天只能**手改 SQLite 或临时脚本**:易错、无操作者归属、无审计、无干跑预览。

本工具补齐这一缺口:一条**安全、可审计、fail-closed** 的运维命令,让 C 从"手改 DB"变成"一条带 actor/reason 的命令"。

**明确边界(本工具能做 / 不能做):**

| 能                                                     | 不能                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 读取 `status`(哪些相位开、allowlist 计数)              | 开启 `activation` / `projection` / `authorization`(config-store 已拒;命令再拒一层) |
| 为**可信** `tenantId` 设置 allowlist(带 actor/reason)  | 注入 / 轮转 `OPENBOT_CT_SHADOW_HMAC_KEY`(密钥属部署 env / vault)                   |
| 开 / 关 `detection` / `qualification`(带 actor/reason) | 部署 / 构建 / cutover / 改 `chat.send` / 写 Ledger                                 |
| 干跑预览(default)+ 显式 `--confirm` 才落写             | **代替 AC-cond-1 闭合或 C 批准**——命令存在 ≠ 获准运行                              |

**本工具随代码上线即"休眠":命令存在,但在运维**(≠ 我)**于 AC-cond-1 闭合 + C 获批后显式运行前,改变 0 状态。**

## 1. 现状缺口(已核,`origin/main@126d3a89be`)

- `ConversationTaskConfigStore`(`src/conversation-task/config-store.ts`)已具备:`setTenantAllow`(版本化 CAS、operator 归属、tenant 以完整 SHA-256 键存、无明文)、`setFlag`(拒绝三禁用相位)、`isTenantAllowed` / `isFlagEnabled`(fail-closed 单项读)。
- **缺**:(a) 无外部调用方(无 CLI / 网关);(b) 无 `status`/快照读(无法列举已开相位与 allowlist 概况供运维核对);(c) 无"为某租户一步开 C"的复合、带预检的受控操作。

## 2. 提议的运维命令面(`openclaw conversation-task ...`)

> 全部默认**只读 / 干跑**;写操作必须显式 `--confirm` + `--actor <id>` + `--reason <text>`。

- `openclaw conversation-task status` — 只读:列 `detection`/`qualification` 当前值 + 元数据(actor/reason/stateVersion/updatedAt),allowlist **计数**与**哈希键前缀**(绝不打印明文 tenantId),三禁用相位恒显示 `forbidden(off)`。默认命令。
- `openclaw conversation-task allow-tenant <tenantId> --actor <id> --reason <text> [--confirm]` — 干跑显示将写内容;`--confirm` 才 `setTenantAllow`。
- `openclaw conversation-task enable <detection|qualification> --actor <id> --reason <text> [--confirm]` — 同上;`enable activation|projection|authorization` 一律**硬拒**并退非零。
- `openclaw conversation-task disable <...>` / `deny-tenant <...>` — 对称的即时关闭(C 观察失败时快速回退:清 allowlist / 关 detection·qualification)。

## 3. 安全不变式(红线,必须被测试强制)

1. **仅 shadow 相位**:命令层 + `config-store` 双重拒绝 `activation`/`projection`/`authorization`(退非零、无副作用)。
2. **强制归属**:写操作缺 `--actor` 或 `--reason` 即拒;写入落 `config-store` 的 actor/reason 字段 + 一行审计日志。
3. **干跑优先**:无 `--confirm` 绝不落写(默认预览)。
4. **fail-closed**:任何读错误 ⇒ 显示 off/empty,绝不显示"已开/已允许"。
5. **无明文 tenant 泄露**:`status` 只输出哈希键前缀 + 元数据(与 no-plaintext-tenant 设计一致)。
6. **不越界**:不碰密钥、不部署、不写 Ledger、不改 `chat.send`;可信 `tenantId` 缺失即拒(不回退个人域)。

## 4. 代码落点与所需授权 / 评审

- **在我分区**(`src/conversation-task/**`,现有授权,可立即实现):
  - `config-store.ts`:新增只读 `readEnablementStatus()` 快照(相位元数据 + allowlist 概况;fail-closed;无明文)。
  - 新 `enablement.ts`:组合式受控服务(`previewAllowTenant`/`applyAllowTenant`/`previewEnable`/`applyEnable`/`status`),封装 `config-store`,强制 actor/reason、拒禁用相位、结构化结果 + 审计记录。
  - 全部 `*.test.ts`。
- **需要 `src/cli` 分区授权(超出我当前授权):**
  - `src/cli/**` 一条薄命令注册,仅解析参数 + 解析可信 tenant/actor + 调用 `enablement.ts` + 打印。**无业务逻辑**。
- **需要的独立评审(≠ 实施 owner):**
  - `kiro-privacy-reviewer`:`status` 输出无明文 tenant、无敏感值。
  - `kiro-security-reviewer`:归属 / 审计 / 干跑 / 禁用相位硬拒。
  - (可选)运维:命令人体工学。

## 5. 验收 / 测试计划

- 单测:禁用相位硬拒(命令 + store 两层);缺 actor/reason 拒写;无 `--confirm` 零落写;`status` 读错误 fail-closed;`status` 无明文 tenant;`allow-tenant`/`enable` 幂等 + 版本化 CAS。
- 门禁:`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task`、`pnpm exec oxlint`、`pnpm build`(无 `[INEFFECTIVE_DYNAMIC_IMPORT]`)。
- 上线证明:默认值不变;命令存在但不改状态,直到运维显式运行。

## 6. 治理声明

本工具**不是**开启 C 的批准,也不是 AC-cond-1 闭合。放行 C 的顺序仍为 `readiness §7`(B→A→D→C)+ AC-cond-1 vault 迁移 + `kiro-privacy-reviewer` §5 署名。实施 owner `kiro-conversation-task-runtime` **不**运行该命令翻开生产 flag、**不**代签任何门禁;工具由运维在获批后执行。`production rollout (to activation) = NOT APPROVED` 不变。
