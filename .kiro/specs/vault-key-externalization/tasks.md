# Implementation Plan — Vault 密钥外置（可插拔 KEK 来源）

> 依赖：`src/secrets`（resolveSecretRefString/coerceSecretRef）、connector-credential-vault 既有 AES-256-GCM。
> 后继：exec provider 指向 Vault/KMS/Secrets Manager CLI 即可真正对接；术语对照文档（P3）。
>
> **状态（2026-07-12，— kiro-vault-kms）**：全部任务落地并验证。
> 9 个本任务单测全绿（key 模块 6 / vault 往返 3）；改动文件 `pnpm tsgo` 零错误（剩余为他人 WIP）；
> oxfmt + oxlint 本任务 4 文件全清。AES-256-GCM 信封逻辑未改（仅插拔 KEK 来源）。

## Agents

- kiro-vault-kms · role: owner · scope: Vault KEK 来源可插拔（新增 secretref 来源，沿 env-key 接缝，复用 src/secrets；不动 AES-256-GCM 信封） · paths: `.kiro/specs/vault-key-externalization/**`, `src/gateway/enterprise-data/connector-credential-vault-key.ts`, `src/gateway/enterprise-data/connector-credential-vault-key.test.ts`, `src/gateway/enterprise-data/connector-credential-vault.test.ts` · since: 2026-07-12

### 定位（强约束）

- **只插拔 KEK 来源，不动信封**（D1）：加解密逻辑一字不改。
- **沿既有 env 接缝、零 config schema 改动**（D2）：新增 `OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF`。
- **复用 src/secrets，不造轮子**（D3）：resolveSecretRefString + coerceSecretRef。
- **失败关闭**（D4）：secretref env 非法/解析失败 → 抛错，绝不回退本地文件。
- **敏感文件最小改**（D5）：逻辑抽到新模块，vault 仅替换 env-key 分支。

### 共享文件说明（多 agent 安全）

- **纯新增文件**（owned）：connector-credential-vault-key(.test)、connector-credential-vault.test。
- **增量编辑**：`connector-credential-vault.ts`（当前 CLEAN，安全敏感）——删 env-key 常量/私有函数 + 改 `resolveVaultKey` 的 env 分支为调用新模块；crypto 不变。

## Tasks

- [x] 1. 调研（vault 现状 + src/secrets 契约 + encryptedLocal.masterKeyRef 先例）——结论见 design.md。 — kiro-vault-kms

- [x] 2. 创建本 spec（requirements + design + tasks），签到 `## Agents`。 — kiro-vault-kms

- [x] 3. 新模块 `connector-credential-vault-key.ts`
  - `VAULT_KEY_ENV_VARS` + `VAULT_KEY_REF_ENV_VARS` + `VaultKeyMaterialSource` + `VaultKeyRefResolver`。
  - `deriveVaultKey(material)`（sha256→32B）。
  - `resolveVaultKeyMaterialFromEnv({env?,loadConfig?,resolveRefString?})`（inline→secretref→null；缓存 + 失败关闭）。
  - `resetVaultKeyMaterialCacheForTest()`。
  - _Requirements: R1, R2, R3, R4_ — kiro-vault-kms

- [x] 4. 接入 `connector-credential-vault.ts`（最小增量）
  - 删 `VAULT_KEY_ENV_VARS`/`readEnvKey` + 未用的 `createHash` 导入；`resolveVaultKey` 先调
    `resolveVaultKeyMaterialFromEnv()` → `deriveVaultKey`；保留本地文件逻辑与 AES-256-GCM crypto 不变。
  - _Requirements: R2, R3, R5.1_ — kiro-vault-kms

- [x]\* 5. 单测 `connector-credential-vault-key.test.ts`（6 tests）
  - inline 优先+短路（loadConfig 未调用）/ secretref(JSON ref + 注入 resolver)+缓存只解析一次 / `${VAR}` 模板 /
    非法 ref 失败关闭 / 皆无返回 null / deriveVaultKey 确定性 32B。
  - _Requirements: R1, R2, R3, R4_ — kiro-vault-kms

- [x]\* 6. 往返测试 `connector-credential-vault.test.ts`（3 tests）
  - inline env 往返解密（且断言磁盘信封不含明文）/ 本地文件往返（回归）/ 删除；hermetic 临时路径 + 清理 env/缓存。
  - _Requirements: R2, R3_ — kiro-vault-kms

- [x] 7. 验证：`pnpm tsgo` 改动文件零错误 + 9 个 scoped 测试全绿 + oxfmt/oxlint 全清 + 清理临时文件。 — kiro-vault-kms

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **安全敏感**：不削弱 AES-256-GCM；密钥材料不回显日志；失败关闭。
- 标 `*` 为测试任务。
