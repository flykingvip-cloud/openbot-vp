# OpenBot Knowledge Vault Sync — P0 协议与威胁模型

Date: 2026-07-22
Status: 草案待评审（P0 未通过前不大规模写实现）
作者: cursor-vault-sync
定位: Knowledge Vault Sync（E2EE 跨设备同步仓库）。**产品 UI 入口 = TBD / 暂不开放（2026-07-23）**；勿与「录入知识 → 本地文件夹」（`managed_push`，明文）混淆。
关联:

- `.kiro/specs/knowledge-vault-sync/requirements.md`
- `.kiro/specs/knowledge-vault-sync/tasks.md`
- `docs/design/openbot-knowledge-runtime-source-connector-2026-07-14.md`（localFolder 三层模型）
- `docs/design/openbot-localfolder-passive-connector-review-remediation-2026-07-14.md`（500 截断 / 云盘脚手架）
- `SECURITY.md`（一用户信任模型；Vault Sync E2EE 是**额外**威胁面，不削弱既有边界）

---

## 0. 执行摘要

| 模式                       | 信任承诺                                   | 服务器可见                               | Knowledge Runtime                                            |
| -------------------------- | ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| **私密同步 (E2EE)**        | 端到端加密；服务器不可读内容/路径/文件名   | 密文 blob、opaque 元数据、设备游标、配额 | **仅**在解密后的本地设备（或用户自托管且持钥的 Gateway）构建 |
| **企业托管知识**           | 服务器/自托管 Gateway 可信；可做索引与 RAG | 明文或企业 KMS 信封                      | Gateway / 云端 Runtime 正常构建                              |
| **外部来源导入**（原云盘） | 第三方云盘 OAuth；导入后进入所选空间索引   | 导入过程可读文件内容                     | 导入后按既有 passive 路径索引                                |

本方案产品核心是 **私密同步**。企业托管是显式第二模式，UI 与协议字段必须分清，禁止把 E2EE Vault 的密文交给云端 Embedding。

**与现有能力的关系（禁止混淆）:**

- `localFolder` / `knowledge.local-folder.*` = 本地文件夹 → **本机** Knowledge Runtime 索引（路径不出云）。**不是**跨设备 Vault Sync。
- `cloudDrive` / `knowledge.connector.*` + `sources/cloud-drive/**` = 百度/阿里/夸克 **外部导入**。迁到「外部来源导入」，不得继续代表跨设备同步。
- `managed_push` + `sync.plan/commit` = 客户端把**明文**（Base64/文本）推给 Gateway 做 ingest。可用于企业托管模式参考，**绝不能**作为 E2EE 私密同步传输层。

---

## 1. 威胁模型

### 1.1 资产

- Vault 明文文件内容、真实路径、文件名、扩展元数据
- 同步密码、恢复码、派生密钥、设备密钥
- 版本历史（含 tombstone 前内容）
- 设备身份与游标（元数据；泄漏影响较小但仍需限流）

### 1.2 攻击者与目标

| 攻击者                                        | 能力                    | 目标                 | 期望结果                                        |
| --------------------------------------------- | ----------------------- | -------------------- | ----------------------------------------------- |
| 诚实但好奇的服务器运营方                      | 读 DB / 对象存储 / 日志 | 读用户笔记           | E2EE 下失败                                     |
| 服务器 DB / 对象存储泄漏                      | 离线拿到全部密文行      | 恢复明文与路径       | 失败（无密钥）                                  |
| 网络中间人                                    | 观察/篡改 HTTPS 流量    | 注入修订             | TLS + 密文 AEAD 失败关闭                        |
| 被盗设备（已解锁 OS）                         | 读 Keychain 需用户会话  | 导出密钥             | OS 保护；设备撤销限制新同步                     |
| 恶意/被攻破客户端                             | 持有解锁后的密钥        | 上传恶意密文         | 完整性靠 AEAD；不能破坏其他 Vault               |
| 同 Gateway 另一操作者（OpenBot 默认信任模型） | 已是 trusted operator   | 读本机解密后 Runtime | **预期**：同机信任边界内可见；E2EE 云端仍不可见 |

### 1.3 明确不在范围内

- 对抗同机 trusted operator（见 `SECURITY.md` 一用户模型）
- 对抗已解锁且持有同步密码的合法设备
- 对抗侧信道（功耗/缓存）— 使用成熟库即可，不做专用硬化
- CRDT 实时同文档协作（P4 后再评估）

### 1.4 安全边界铁律

1. E2EE 控制面与对象存储：**零明文**（日志、错误、指标标签亦然）。
2. `opaquePathId` 不可逆；真实路径只出现在客户端解密后。
3. Web UI **禁止** `localStorage` / `sessionStorage` 存 Vault 密钥；桌面走 Keychain，移动走 Keystore；Web 仅内存 + 可选 OS 凭据 API（若不可用则每次解锁）。
4. 错误信息不得回显密钥、明文路径、KDF/nonce 内部状态。
5. Fail closed：错误密码、标签校验失败、AAD 不匹配 → 拒绝写入本地。

---

## 2. 目标架构

```text
Local Vault (files)
  → watcher / inventory / offline journal
  → device sync engine
  → E2EE (content + metadata + path-id)
  → sync control plane (HTTPS APIs)
  → PostgreSQL (revision metadata) + S3/MinIO (ciphertext blobs)
  → WebSocket (cursor / revision notify only)
  → peer device sync engine
  → decrypt + write local files
  → local Knowledge Runtime re-index (existing localFolder / ingest path)
```

**分层:**

| 层                      | 职责                                       | 部署                                     |
| ----------------------- | ------------------------------------------ | ---------------------------------------- |
| Device Sync Engine      | journal、inventory、冲突、加解密、幂等提交 | 桌面 / 移动客户端；可选同机 Gateway 插件 |
| Sync Control Plane      | 鉴权、配额、分叉检测、游标、设备生命周期   | 云端或企业自托管                         |
| Blob Store              | 密文对象；预签名上传/下载                  | S3 / MinIO                               |
| Metadata DB             | `FileRevision` 与设备游标；无明文路径      | PostgreSQL                               |
| Local Knowledge Runtime | 解密后索引；与 Sync **解耦**               | 仅可信设备                               |

---

## 3. 同步协议：不可变 FileRevision

### 3.1 类型（逻辑合约）

```ts
type FileRevision = {
  vaultId: string; // ULID / UUID
  opaquePathId: string; // HMAC/KDF 派生，不可逆
  revisionId: string; // 稳定、可验证、幂等（见 §3.2）
  parentRevisionIds: string[]; // 0=创建；1=线性；2+=合并/冲突解决
  deviceId: string;
  deviceSequence: number; // 每设备单调递增
  encryptedMetadata: Uint8Array; // 路径、文件名、mime、mtime… AEAD
  ciphertextBlobId: string | null; // tombstone 可为 null
  plaintextSize: number; // 可公开（配额）；可选模糊
  ciphertextHash: string; // 密文完整性（独立于 AEAD tag）
  tombstone: boolean;
  createdAt: string; // RFC3339；服务器权威时间可另存 serverReceivedAt
  protocolVersion: number; // 当前 1
  encryptionVersion: number; // 当前 1
};
```

### 3.2 revisionId 生成（客户端）

```text
revisionId = base64url(
  BLAKE3 or SHA-256(
    vaultId || opaquePathId || deviceId || uint64_be(deviceSequence)
      || ciphertextHash || parentRevisionIds_sorted_join || protocolVersion
  )
)
```

- 同一输入 → 同一 `revisionId` → 重试幂等。
- 服务器以 `(vaultId, revisionId)` 唯一约束；冲突且内容哈希一致视为成功重放。

### 3.3 分叉检测（服务器，不读内容）

对每个 `opaquePathId` 维护当前 head 集合：

- 新修订的每个 `parentRevisionIds` 必须是已知修订。
- 若父集恰好覆盖当前 heads → 快进 / 合并，更新 heads。
- 若与现有 head 并列（共同祖先但互不为祖先）→ 标记 `conflict_group_id`，双方 head 并存。
- 服务器**从不**打开 `encryptedMetadata` 或 blob。

### 3.4 Tombstone

- `tombstone=true` 的修订仍写入历史；blob 可延迟 GC。
- 物理删除历史仅在用户显式「清空历史 / 销毁 Vault」或 retention 策略之后。

### 3.5 不同步清单

| 排除                                               | 原因           |
| -------------------------------------------------- | -------------- |
| `**/.openbot/**`、Knowledge SQLite、embedding 缓存 | Runtime 派生物 |
| `**/*~`、`**/.*.swp`、`**/.DS_Store`、锁文件       | 临时/OS        |
| Vault 配置中 `excludeGlobs`                        | 用户选择       |
| 选择性同步关闭的媒体类别                           | R4             |

### 3.6 Inventory 分页

- `GET /vaults/{vaultId}/inventory?cursor=&limit=`（limit 默认 500，最大 2000）。
- **禁止**沿用 `LOCAL_FOLDER_SCAN_MAX_FILES = 500` 的静默截断语义；必须返回 `nextCursor` 或显式 `truncated` + 续扫令牌。
- 客户端 offline journal 按路径记录变更，重连后分页拉取 remote heads 再 diff。

---

## 4. 状态机

### 4.1 Vault 连接状态（UI）

```text
unconfigured → unlocking → idle_synced
                         ↘ syncing ⇄ idle_synced
                         ↘ offline (journal 堆积)
                         ↘ conflict (需用户或自动合并)
                         ↘ error (可重试)
                         ↘ paused (用户暂停)
unlocking → error_bad_password (fail closed)
任意非终态 → revoked (设备撤销后只读本地)
```

### 4.2 单文件修订状态（引擎）

```text
local_dirty → encrypting → uploading_blob → committing_revision → acked
acked → (remote notify) fetching_blob → decrypting → writing → local_applied → runtime_reindex
concurrent parents → conflict_pending → merged_revision | conflict_copies
```

### 4.3 设备生命周期

```text
pending_register → active → revoked
active → key_rotation_pending → active
```

---

## 5. 数据表（PostgreSQL 逻辑模型）

> 仅元数据与密文指针；无明文路径/内容列。

```sql
-- 逻辑 DDL（实现时可迁移调整；列语义锁定）

CREATE TABLE vaults (
  vault_id            UUID PRIMARY KEY,
  owner_account_id    TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('e2ee_private', 'enterprise_hosted')),
  protocol_version    INT NOT NULL DEFAULT 1,
  encryption_version  INT NOT NULL DEFAULT 1,
  salt_b64            TEXT NOT NULL,           -- 公钥材料：KDF salt（非密钥）
  kdf_params_json     JSONB NOT NULL,          -- 内存/迭代参数（公开）
  display_name_enc    BYTEA,                   -- 可选：加密显示名；或仅客户端存
  quota_bytes         BIGINT NOT NULL,
  usage_bytes         BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL,
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE vault_devices (
  vault_id            UUID NOT NULL REFERENCES vaults(vault_id),
  device_id           TEXT NOT NULL,
  device_name_enc     BYTEA,                   -- E2EE 下加密；企业模式可明文
  platform            TEXT NOT NULL,
  last_sequence       BIGINT NOT NULL DEFAULT 0,
  cursor_revision_id  TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active','revoked')),
  registered_at       TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  PRIMARY KEY (vault_id, device_id)
);

CREATE TABLE file_revisions (
  vault_id            UUID NOT NULL,
  revision_id         TEXT NOT NULL,
  opaque_path_id      TEXT NOT NULL,
  parent_revision_ids TEXT[] NOT NULL,
  device_id           TEXT NOT NULL,
  device_sequence     BIGINT NOT NULL,
  encrypted_metadata  BYTEA NOT NULL,
  ciphertext_blob_id  TEXT,
  plaintext_size      BIGINT NOT NULL,
  ciphertext_hash     TEXT NOT NULL,
  tombstone           BOOLEAN NOT NULL DEFAULT FALSE,
  protocol_version    INT NOT NULL,
  encryption_version  INT NOT NULL,
  conflict_group_id   UUID,
  created_at          TIMESTAMPTZ NOT NULL,    -- 客户端声明
  server_received_at  TIMESTAMPTZ NOT NULL,    -- 服务器权威
  idempotency_key     TEXT,
  PRIMARY KEY (vault_id, revision_id),
  UNIQUE (vault_id, device_id, device_sequence),
  UNIQUE (vault_id, idempotency_key)
);

CREATE INDEX file_revisions_path_time
  ON file_revisions (vault_id, opaque_path_id, server_received_at);

CREATE TABLE path_heads (
  vault_id            UUID NOT NULL,
  opaque_path_id      TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  PRIMARY KEY (vault_id, opaque_path_id, revision_id)
);

CREATE TABLE blobs (
  blob_id             TEXT PRIMARY KEY,
  vault_id            UUID NOT NULL,
  size_bytes          BIGINT NOT NULL,
  ciphertext_hash     TEXT NOT NULL,
  storage_key         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE vault_audit_events (
  id                  BIGSERIAL PRIMARY KEY,
  vault_id            UUID NOT NULL,
  device_id           TEXT,
  event_type          TEXT NOT NULL,           -- device_revoked, quota_exceeded…
  -- 禁止记录明文路径/密钥；仅 opaque ids
  payload_json        JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL
);
```

对象存储：`s3://{bucket}/vaults/{vaultId}/blobs/{blobId}`，全部为密文字节。

---

## 6. API 合约

基路径：`/api/vault-sync/v1`（名称避免与 enterprise `connector-credential-vault` 混淆）。  
鉴权：OpenBot 账户会话 + Vault 级设备令牌（注册时下发；撤销即失效）。

### 6.1 Vault CRUD

| Method   | Path                | 说明                                                |
| -------- | ------------------- | --------------------------------------------------- |
| `POST`   | `/vaults`           | 创建远程 Vault；返回 `vaultId`、`salt`、`kdfParams` |
| `GET`    | `/vaults`           | 列出账户下 Vault（无明文名则返回 opaque 标签）      |
| `GET`    | `/vaults/{vaultId}` | 元数据 + 配额                                       |
| `DELETE` | `/vaults/{vaultId}` | 软删；保留 retention                                |

### 6.2 Devices

| Method | Path                                          | 说明                                     |
| ------ | --------------------------------------------- | ---------------------------------------- |
| `POST` | `/vaults/{vaultId}/devices`                   | 注册设备；需证明持有同步密钥（挑战响应） |
| `GET`  | `/vaults/{vaultId}/devices`                   | 设备列表                                 |
| `POST` | `/vaults/{vaultId}/devices/{deviceId}/revoke` | 撤销                                     |

### 6.3 Blobs（大文件不走 WS）

| Method | Path                                        | 说明                                  |
| ------ | ------------------------------------------- | ------------------------------------- |
| `POST` | `/vaults/{vaultId}/blobs/upload-session`    | 创建分块上传会话；返回预签名 URL      |
| `PUT`  | 预签名 URL                                  | 直传对象存储；支持断点续传            |
| `POST` | `/vaults/{vaultId}/blobs/{blobId}/complete` | 校验 `ciphertextHash`                 |
| `POST` | `/vaults/{vaultId}/blobs/download-urls`     | 批量签发下载 URL（body: `blobIds[]`） |

硬限制：单 blob 经 Gateway 代理的同步路径 **禁止**；≥ 阈值（建议 1 MiB）必须预签名直传。验收：**200 MiB 附件不得经 Gateway WebSocket Base64**。

### 6.4 Revisions

| Method | Path                                              | 说明                                      |
| ------ | ------------------------------------------------- | ----------------------------------------- |
| `POST` | `/vaults/{vaultId}/revisions`                     | 提交 `FileRevision`；头 `Idempotency-Key` |
| `GET`  | `/vaults/{vaultId}/revisions?sinceCursor=&limit=` | 增量拉取                                  |
| `GET`  | `/vaults/{vaultId}/paths/{opaquePathId}/history`  | 单路径历史（含 tombstone）                |
| `GET`  | `/vaults/{vaultId}/inventory?cursor=&limit=`      | 当前 heads 分页                           |

`POST /revisions` 响应：

```json
{
  "status": "accepted" | "duplicate" | "conflict" | "rejected",
  "revisionId": "...",
  "conflictGroupId": null,
  "heads": ["..."],
  "serverReceivedAt": "..."
}
```

### 6.5 WebSocket

- 频道：`vault-sync:{vaultId}`
- 事件：`{ "type": "revisions_available", "cursor": "...", "revisionIds": ["..."] }`
- **禁止**携带 blob 或明文；客户端收到后走 HTTP inventory/download。

### 6.6 与 Knowledge Runtime 的边界 API

E2EE 模式：**无**「云端 ingest」API。  
本地引擎在 `local_applied` 后调用既有本机路径（例如触发 `localFolder` scan 或直接 `ingestKnowledgePayloadToBase`），且仅限本机。

企业托管模式可另定义 `enterprise_hosted` 下的明文/信封 ingest（P1 不实现）。

---

## 7. 密钥层级

```text
Vault Sync Password (user) + salt (per vault, public)
  → memory-hard KDF (Argon2id preferred; platform APIs OK)
      → BaseKey
          → HKDF-SHA256
              ├─ ContentKey        (file body AEAD)
              ├─ MetadataKey       (encryptedMetadata AEAD)
              ├─ PathLookupKey     (opaquePathId = HMAC(PathLookupKey, normalizedPath))
              └─ ManifestAuthKey   (可选：设备清单 / 选择性同步清单 MAC)
```

### 7.1 内容加密

- AEAD：AES-256-GCM 或 ChaCha20-Poly1305（选平台已审计实现；Node `crypto` / WebCrypto / `@noble` 仅作辅助哈希时需评审）。
- 每文件每修订随机 nonce；**禁止**nonce 复用（单测覆盖）。
- AAD = `vaultId | opaquePathId | revisionId | encryptionVersion`（编码规范写入测试向量）。

### 7.2 恢复与轮换

- 恢复码：高熵；可派生 RecoveryKey 解包 BaseKey 备份信封（客户端生成，服务器只存**加密后的** key package）。
- `encryptionVersion` 递增支持迁移；旧修订保持旧 version 可读。
- 设备撤销：吊销设备令牌；不自动重加密历史（P2+ 可选 epoch 轮换）。

### 7.3 测试要求（P1 起必须）

1. 固定测试向量（密码、salt、kdf、明文、AAD → 密文）
2. 篡改密文 / 元数据 → 解密失败
3. 错误密码 → 失败关闭
4. nonce 唯一性（同密钥下统计/构造检测）

---

## 8. 冲突策略

1. 相同父修订的并发更新 → `conflict_group_id`。
2. Markdown / 纯文本：找共同祖先，三方合并（LCS/行级）；启发式冲突标记写入文件。
3. 无共同祖先或自动合并不安全 → 保留双方为 conflict copy（路径规则：`{name}.{device}.{time}.sync-conflict.ext`），再提交合并修订（parents = 双方）。
4. 二进制：禁止自动合并；仅 conflict copy。
5. UI 展示：来源设备、时间、路径、解决状态。
6. 解决产生新 `FileRevision`，`parentRevisionIds` = 冲突双方。

P1：可先实现「冲突副本 + 手动选边」，三方合并可并行落地但非阻塞双设备 MVP 的最小路径。

---

## 9. UI 改造契约

### 9.1 入口

> **最终产品决策（2026-07-23）**：Vault 产品入口 = **TBD / 暂不开放**。当前「录入知识」仅 4 tab（本地文件夹 / 网页 / 笔记 / 主动源）；本地文件夹固定 `managed_push`（明文，非 E2EE），**无**同步方式选择器，**不**挂载 Vault。  
> **历史（superseded）**：曾规划把导入五通道中的「云盘」升级为独立「同步仓库」tab；后又有「方案 A」把 Vault 并入本地文件夹·同步方式三档——均已废止。详见 `docs/design/openbot-knowledge-vault-sync-import-entry-merge-alignment-2026-07-23.md` §9。

| 能力                                         | 当前状态                           |
| -------------------------------------------- | ---------------------------------- |
| Vault Sync 协议 / 客户端 / 设备 / 团队       | **保留**（实现层）；非产品录入入口 |
| 「录入知识」页 Vault tab / 选择器 / 隐藏入口 | **禁止**                           |
| 外部云盘（百度/阿里/夸克）                   | 「外部来源导入」；≠ E2EE Vault     |
| 新 Vault 产品入口位置 / IA                   | **TBD**                            |

### 9.2 同步仓库能力面板

新建 / 打开本地 / 连接远程 / 解锁密码 / 选择性同步 / 状态 / 设备 / 日志 / 历史 / 恢复删除。  
组件与 controller（如 `renderVaultSyncImportForm`）可保留供未来入口复用；**不得**在当前录入知识页重新挂载。

### 9.3 i18n

- 更新 `ui/src/i18n/locales/en.ts` 与 `zh-CN.ts`（共享热点，落地时最小 diff；Import IA 期间勿强提）。
- 不直接编辑 `docs/zh-CN/**`。
- 用户可见字符串使用 **OpenBot**，不新增 openclaw。
- 已废止的 `importToSpace.folderSync.*` 三档文案无产品入口；清理归属 Import IA / i18n 协调，非本任务强提范围。

---

## 10. 迁移方案

### 10.1 产品迁移

1. 产品入口确定前可保留 feature flag / 内部脚手架；**不得**声称「录入知识已开放同步仓库」。
2. 既有 `cloudDrive` 绑定保持可用，归类到外部来源；引导文案说明「云盘导入 ≠ 跨设备同步」。
3. 无自动把云盘文件转为 E2EE Vault（需用户显式「创建同步仓库并导入本地副本」——待入口 TBD）。

### 10.2 数据 / 协议迁移

- `protocolVersion` / `encryptionVersion` 字段预留。
- P0→P1：无生产数据；允许破坏性改合约直至 P1 冻结。
- 未来 v2：双读旧修订，写入仅新 version。

### 10.3 与 localFolder 的共存

- 用户本地 Vault 目录可同时是 `localFolder` 绑定根（本机索引）+ Vault Sync 根（跨设备）。
- Sync 引擎必须忽略 Runtime 派生物；localFolder 扫描继续用相对路径，**不得**上传绝对路径到 Sync 控制面。

---

## 11. 验收矩阵（P0 定义 / P1+ 验证）

| #   | 门槛                                      | 阶段                         |
| --- | ----------------------------------------- | ---------------------------- |
| 1   | A 离线编辑，联网后 B 一致                 | P1                           |
| 2   | 服务器泄漏无法恢复内容/文件名/路径        | P1 密码学测试 + 威胁模型评审 |
| 3   | 错误密码与篡改 fail closed                | P1                           |
| 4   | 同 revision 重试不重复历史                | P1                           |
| 5   | 并发不静默覆盖                            | P1                           |
| 6   | 删除可同步且可恢复                        | P1/P2                        |
| 7   | 10k 文件分页 inventory，无 500 静默截断   | P1                           |
| 8   | 200MB 不走 WS Base64                      | P1/P2                        |
| 9   | E2EE 云端无明文                           | P1                           |
| 10  | 同步后本地 Runtime 增量更新               | P1                           |
| 11  | 单测/集成/浏览器/`pnpm build`/`pnpm tsgo` | 各阶段门禁                   |
| 12  | 无新增 `INEFFECTIVE_DYNAMIC_IMPORT`       | 各阶段门禁                   |

---

## 12. 实现落点（评审通过后）

建议**新建**模块，避免与 grok 宽泛占用的 `src/gateway/knowledge/**` 审计路径纠缠：

```text
src/gateway/knowledge/vault-sync/          # 控制面适配 / 类型 / 路由（P1）
src/vault-sync/                            # 可选：纯协议与加密（无 Gateway 依赖）
ui/src/ui/controllers/knowledge-universe-vault-sync.ts
ui/src/ui/views/knowledge-universe-*-vault-sync.ts
```

复用（允许）:

- `local-folder-watcher.ts` 的 chokidar 模式（debounce reconcile）
- `SourceDocumentLink` tombstone 语义（仅本地 Runtime 投影，不复用为 FileRevision）
- `@noble/hashes` / Node `crypto`（经评审）
- enterprise vault 的「失败关闭」风格（**不**复用其账户级 KEK 作为 Vault Sync 密钥）

禁止复用为 E2EE 传输核心:

- `LocalFolderSyncCommitFile.contentBase64` / Gateway WS 传文件
- CouchDB / Syncthing / 第三方云盘 API
- `connector-credential-vault` 的企业连接器密钥（不同威胁模型）

---

## 13. 开放问题（需评审拍板）

1. Control plane 首发：仅云端托管 vs 同步支持「企业自托管 Sync 服务」？
2. Web 客户端是否进入 P1，还是 P1 仅桌面（Keychain）？
3. `plaintextSize` 是否做分桶模糊以降低指纹？
4. P1 冲突：仅 conflict copy，还是必须含三方合并？
5. 与 Data Space `~/OpenBot` 的默认根路径约定。

---

## 14. 评审检查表

- [ ] 双模式安全承诺文案无歧义
- [ ] FileRevision 字段与幂等规则完整
- [ ] DDL 无明文路径/内容
- [ ] API 无 WS 传 blob
- [ ] 密钥层级与测试向量计划完整
- [ ] UI 迁移不破坏既有云盘导入
- [ ] 路径所有权 / loom 登记无重叠
- [ ] P0 通过后方可开 P1 大规模实现
