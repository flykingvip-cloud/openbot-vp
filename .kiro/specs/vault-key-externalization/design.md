# Design — Vault 密钥外置（可插拔 KEK 来源）

> 依赖：`src/secrets`（`resolveSecretRefString`、`coerceSecretRef`）、`connector-credential-vault.ts`
> 既有 AES-256-GCM 信封、`loadConfig`。先例：`secrets.encryptedLocal.masterKeyRef`（用 SecretRef 取主密钥）。

## 关键决策

- **D1（只插拔 KEK 来源，不动信封）**：可插拔点是「32 字节 AES 密钥从哪来」。加解密信封
  （AES-256-GCM，`{v,alg,iv,tag,ct}`）与读写路径**一字不改**。这是最小、最低风险的「外置」语义
  ——KEK 外置（envelope encryption with external KEK）。
- **D2（沿既有 env 接缝，零 config schema 改动）**：新增 `OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF`
  （+`OPENCLAW_*` 别名）承载一个 `SecretRef`。provider 定义仍来自已有 `config.secrets.providers`。
  不新增 config 字段（规避共享 config 热文件冲突）。
- **D3（复用 src/secrets，不造轮子）**：secretref 解析走 `resolveSecretRefString(ref,{config,env})`；
  ref 解释走 `coerceSecretRef`（JSON SecretRef 对象 / `${VAR}` env 模板）。exec provider 即方案说的
  「vault provider 契约」，Vault/KMS/Secrets Manager 都可作为 exec/file provider 接入。
- **D4（优先级 + 短路 + 失败关闭）**：inline env → secretref env → 本地文件。inline 命中即短路
  （不 loadConfig）。secretref env 已设但非法/解析失败 → 抛错，绝不回退本地文件（防止用错密钥写坏信封）。
- **D5（抽独立模块，敏感文件最小改）**：KEK 来源逻辑放新 owned 模块 `connector-credential-vault-key.ts`；
  `connector-credential-vault.ts` 仅把原 `readEnvKey()+if(envKey)` 分支替换为
  `resolveVaultKeyMaterialFromEnv()`；其余（keyLock/keyCache/文件生成/encrypt/decrypt）不变。
- **D6（可注入 + 缓存）**：新模块的 `loadConfig`/`resolveRefString`/`env` 可注入（单测）；secretref
  解析结果按 ref-env 字符串缓存（避免每次 load/save 都 exec 外部进程），提供 test-reset。

## 模块与文件

### 新增（owned）

- `src/gateway/enterprise-data/connector-credential-vault-key.ts`
  - `VAULT_KEY_ENV_VARS`（inline，从 vault 迁入）、`VAULT_KEY_REF_ENV_VARS`（新）。
  - `type VaultKeyMaterialSource = "inline-env" | "secret-ref"`。
  - `deriveVaultKey(material: string): Buffer`（sha256→32B，来源无关的统一派生）。
  - `resolveVaultKeyMaterialFromEnv(params?): Promise<{ material: string; source } | null>`
    （inline → secretref → null；可注入 env/loadConfig/resolveRefString；secretref 结果缓存）。
  - `resetVaultKeyMaterialCacheForTest()`。
- `src/gateway/enterprise-data/connector-credential-vault-key.test.ts`（单测）。

### 增量编辑（clean，安全敏感，最小改）

- `src/gateway/enterprise-data/connector-credential-vault.ts`
  - 删 `VAULT_KEY_ENV_VARS` + `readEnvKey`（迁入新模块）。
  - `resolveVaultKey(vaultPath)`：先 `const envMaterial = await resolveVaultKeyMaterialFromEnv();`
    `if (envMaterial) return deriveVaultKey(envMaterial.material);` 然后**原样保留**本地文件逻辑。
- `src/gateway/enterprise-data/connector-credential-vault.test.ts`（新增；此前无测试）：inline-env 往返 + 本地文件往返回归。

## 解析流程（`resolveVaultKeyMaterialFromEnv`）

```
1. inline = readFirstEnv(VAULT_KEY_ENV_VARS)
   if inline: return { material: inline, source: "inline-env" }        // 短路，不 loadConfig
2. refRaw = readFirstEnv(VAULT_KEY_REF_ENV_VARS)
   if !refRaw: return null                                             // 交本地文件
   if cache.has(refRaw): return cached
   ref = coerceSecretRef(parseMaybeJson(refRaw), defaults)             // JSON 对象 / ${VAR} / 合法对象
   if !ref: throw "VAULT_KEY_REF is not a valid SecretRef"             // 失败关闭
   config = await loadConfig()
   material = await resolveRefString(ref, { config, env })             // 复用 src/secrets
   cache.set(refRaw, { material, source: "secret-ref" }); return it
```

- `parseMaybeJson`：以 `{` 开头 → `JSON.parse` 成对象交 `coerceSecretRef`；否则原字符串交
  `coerceSecretRef`（支持 `${VAR}` 模板）。解析异常 → 抛清晰错误（不回显值）。
- 缓存粒度 = ref-env 原串；进程内有效（与本地 keyCache 一致，轮转需重启，与现状同）。

## 测试策略

- 单测（`connector-credential-vault-key.test.ts`）：
  - inline env 优先且短路（注入会抛错的 loadConfig，断言未被调用）。
  - secretref（注入 resolveRefString 返回固定串 + JSON ref env）→ material 正确、source="secret-ref"、命中缓存只解析一次。
  - `${VAR}` 模板 ref（注入 resolveRefString）→ 正确解析。
  - 非法 ref env（既非 JSON 对象也非模板）→ 抛错（失败关闭）。
  - 两 env 皆无 → null。
  - `deriveVaultKey`：确定性、32 字节、同串同 key。
- vault 往返（`connector-credential-vault.test.ts`）：设 inline env → save→load 解出原 secret；
  无 env → 本地文件路径 save→load 往返（回归）；hermetic 临时 vaultPath + 清理 env/缓存。

## 与后续/方案的关系

- exec provider 指向 Vault/KMS/Secrets Manager CLI 即可真正对接（provider 契约已存在，无需改本模块）。
- 术语对照文档（P3）：Security Governance / Vault 外置 ↔ 本模块 + `src/secrets`。
