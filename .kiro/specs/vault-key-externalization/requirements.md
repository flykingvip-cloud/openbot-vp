# Requirements — Vault 密钥外置到外部密管（KMS / Secrets Manager / Vault）

> Agent OS 方案落地第 3 步的收尾项（P2）。与企业数据事件总线（P1）并行。
>
> **一句话定位**：`connector-credential-vault.ts` 已是 AES-256-GCM，并预留了环境密钥钩子
> （设 `OPENBOT_ENTERPRISE_DATA_VAULT_KEY` 就不落地密钥文件）。本规格沿这条**既有 env-key 接缝**，
> 把「密钥来源（KEK）」做成可插拔——除了 inline env 与本地密钥文件，新增**通过 secretref 从外部密管
> （Hashicorp Vault / AWS Secrets Manager / KMS / 任意 exec provider）解析密钥**，复用 `src/secrets`
> 既有 provider 契约，不新造轮子、不动 AES-256-GCM 信封。

## 背景与缺口

- 现状：vault 用 AES-256-GCM 加密每条 `DataConnectorCredentialSecret`；KEK 来源 = inline env
  （`OPENBOT_ENTERPRISE_DATA_VAULT_KEY`，sha256→32B）→ 本地 `*.key` 文件（随机 32B，0600）。
- 缺口：还没真正对接外部密管。`src/secrets` 已有成熟的 secretref 解析
  （`resolveSecretRefString(ref,{config,env})`，支持 env/file/exec provider，exec 即「vault」provider 契约），
  且 `secrets.encryptedLocal.masterKeyRef` 已是「用 SecretRef 取主密钥」的先例——本规格照搬该模式到 vault KEK。

## Requirements

### R1：KEK 来源可插拔（复用 secretref，不新造轮子）

**User Story**：作为企业管理员，我希望连接器凭证 vault 的加密密钥能托管在外部密管（Vault/KMS/
Secrets Manager），由 OpenBot 运行时按需解析，而不是把密钥明文放进环境变量或落地到磁盘。

1. SHALL 新增一条 KEK 来源：**secretref**——运行时用 `src/secrets` 的 `resolveSecretRefString`
   把一个 `SecretRef` 解析为密钥材料。
2. SHALL 复用 `config.secrets.providers` 里已配置的 provider（含 exec「vault」provider），
   不新增 provider 类型、不复制解析逻辑。
3. secretref 来源 SHALL 沿**既有 env-key 接缝**接入（新增环境变量 `OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF`
   - `OPENCLAW_*` 别名），无需改动 config schema。

### R2：来源优先级与向后兼容

1. KEK 解析优先级 SHALL 为：inline env（`OPENBOT_ENTERPRISE_DATA_VAULT_KEY`）→ secretref env
   （`OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF`）→ 本地密钥文件（现状）。
2. WHEN 两个 env 都未设置 THEN 行为 SHALL 与现状完全一致（本地密钥文件；已有 vault/密钥文件继续可用）。
3. inline env 存在时 SHALL 短路，不加载 config、不解析 secretref（零额外开销、零新依赖触发）。

### R3：密钥派生与信封不变 + 失败关闭

1. 无论来源如何，密钥材料 SHALL 经**相同派生**（sha256 → 32 字节）得到 AES 密钥；
   AES-256-GCM 信封格式与读写路径 SHALL 完全不变。
2. WHEN secretref env 已设置但无法解析为合法 `SecretRef`，或解析/派生失败 THEN SHALL **失败关闭**
   （抛出清晰错误，不回退到本地文件、不静默降级），避免用错误密钥写出无法解密的信封。
3. 解析出的密钥材料 SHALL NOT 被日志/错误信息回显。

### R4：secretref 表达（沿用既有契约）

1. `OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF` 的值 SHALL 通过既有 `coerceSecretRef` 解释为 `SecretRef`：
   规范形态为 **JSON SecretRef 对象**（如 `{"source":"exec","provider":"vault","id":"enterprise/kek"}`），
   或 `${ENV_VAR}` 环境模板（env 源）。不发明新的 provider 契约。
2. 解析出的 `SecretRef` SHALL 交给 `resolveSecretRefString(ref,{config,env})`（config 经 `loadConfig()`）取材料。

### R5：工程约束（多 agent 安全 + 安全敏感）

1. 密钥来源逻辑 SHALL 抽到独立新模块（owned），使敏感文件 `connector-credential-vault.ts` 仅做**最小增量**
   （替换 env-key 分支为调用新解析器；crypto 信封逻辑一字不改）。
2. 依赖可注入（`loadConfig`/`resolveRefString`/`env`）以便单测，不在测试里触达真实 gateway/外部进程。
3. 严格类型，避免 `any`；改动文件 `pnpm tsgo` 零错误；scoped 测试全绿；oxfmt/oxlint 清洁。
