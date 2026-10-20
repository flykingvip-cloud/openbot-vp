# Implementation Plan — Knowledge Vault Sync（同步仓库）

> P0：现状核验 + 协议/威胁模型/合约。P0 评审通过前不大规模写实现。
> 设计：`docs/design/openbot-knowledge-vault-sync-p0-2026-07-22.md`
> 需求：`.kiro/specs/knowledge-vault-sync/requirements.md`

## Agents

- cursor-vault-sync · role: owner · scope: P0–P4 Knowledge Vault Sync（E2EE 同步仓库；含移动 runner；**产品入口 TBD**） · paths: `.kiro/specs/knowledge-vault-sync/**`, `docs/design/openbot-knowledge-vault-sync-*.md`, `src/vault-sync/**`, `src/gateway/server-methods/vault-sync.ts`, `src/gateway/server-methods/vault-sync.test.ts`, `src/gateway/vault-sync-runtime-hook.ts`, `src/gateway/server-startup.ts`, `ui/src/ui/vault-sync/**`, `ui/package.json`, `ui/src/ui/app.ts`, `ui/src/ui/controllers/knowledge-universe-vault-sync.ts`, `ui/src/ui/controllers/knowledge-universe-vault-sync.node.test.ts`, `ui/src/ui/controllers/knowledge-universe-workspace.ts`, `ui/src/ui/views/knowledge-universe-space-import-vault-sync.ts`, `ui/src/ui/views/knowledge-universe-vault-sync.browser.test.ts`, `ui/src/ui/capability/knowledge-universe/gateway-client.ts`, `ui/src/ui/ports/employee/views/home-page-contracts.ts`, `apps/ios/Sources/VaultSync/**`, `apps/ios/Tests/VaultSync*`, `apps/android/app/src/main/java/ai/openclaw/app/vaultsync/**`, `apps/android/app/src/test/java/ai/openclaw/app/vaultsync/**` · since: 2026-07-22

> 签到以 `pnpm loom register` 为准（本块为派生视图）。
> **Takeover（2026-07-22 P1）**：实现落在 `src/vault-sync/**`（knowledge 前缀外），避免与 `grok` 的 `src/gateway/knowledge/**` 重叠；未接管 grok 宽泛路径。Gateway 仅新增 `server-methods/vault-sync.ts`。
> **Import IA 边界（2026-07-23）**：`knowledge-universe-space-import.ts` / `*-local-folder.ts` / `space-import.node.test.ts` / `knowledge-universe-local-folder.ts` 归 `kiro-web-ui`（`knowledge-workbench-import-ia`）—— **勿改**。
> **共享热点**（落地时最小 diff，勿动他人 WIP）：`ui/src/i18n/locales/en.ts`、`zh-CN.ts`、`ui/src/ui/ports/employee/views/home-page-contracts.ts`、`ui/src/ui/ports/employee/render-model.ts`、`src/gateway/server-methods.ts`、`src/gateway/server-methods-list.ts`、`src/gateway/method-scopes.ts`、`.loom/registry.yaml`、`ui/src/styles/workbench.css`。

### 路径所有权核验（2026-07-22）

| 路径 / 任务                                               | Owner               | 与本任务关系                                                       |
| --------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `src/gateway/knowledge/**`（宽泛）                        | `grok`              | **已规避**：P1 核心在 `src/vault-sync/**`，不写入 knowledge 子树。 |
| `src/vault-sync/**`                                       | `cursor-vault-sync` | 本任务 owner                                                       |
| `src/gateway/enterprise-data/connector-credential-vault*` | `kiro-vault-kms`    | 名冲突仅；不复用                                                   |

**Takeover 记录**：P1 采用路径规避而非接管 grok；verify-then-take 结论 = 无需收窄 grok（只要不在其前缀下新增）。 — cursor-vault-sync

---

## P0 现状核验发现

### 现有能力（可证据）

- [x] Knowledge Runtime / 知识空间统一化已落地（见 source-connector 设计 §1）。 — cursor-vault-sync
- [x] `localFolder` 三层模型：`LocalFolderBinding` / `SourceDocumentLink` / 专用 RPC `knowledge.local-folder.*`。 — cursor-vault-sync
- [x] chokidar watcher：`local-folder-watcher.ts`（debounce 750ms，local_index）。 — cursor-vault-sync
- [x] tombstone / snapshot 删除策略（Runtime 投影层，非跨设备 FileRevision）。 — cursor-vault-sync
- [x] `managed_push`：`sync.plan` / `sync.commit`，客户端 inventory + **明文 Base64/文本** 上传 Gateway ingest。 — cursor-vault-sync
- [x] passive connector 契约：`gitRepo` / `cloudDrive` / `mailAttachment`；RPC `knowledge.connector.*`。 — cursor-vault-sync
- [x] 云盘适配器：`sources/cloud-drive/**`（baidu / aliyun / quark）；`passive-connector-providers` 中 `cloudDrive.ready=true`；凭证不进 SourceDescriptor。 — cursor-vault-sync
- [x] UI 导入五通道含 `cloudDrive`，中文文案「云盘」（`zh-CN.ts`）。 — cursor-vault-sync
- [x] 企业连接器 AES-256-GCM vault + 失败关闭先例（不同威胁模型，仅作风参考）。 — cursor-vault-sync
- [x] 仓库已有 `@noble/hashes` / Node crypto；**无**现成 Argon2id Vault Sync 协议实现。 — cursor-vault-sync

### 可复用 vs 禁止当产品核心

| 复用                                            | 禁止当 E2EE Sync 核心                |
| ----------------------------------------------- | ------------------------------------ |
| watcher debounce 模式                           | Syncthing / rsync / 通用云盘同步     |
| tombstone **语义灵感**（本地 link 层）          | CouchDB 明文文档                     |
| document fingerprint / 本地 ingest 触发 Runtime | `contentBase64` 经 Gateway/WS 传附件 |
| cloud-drive 作为「外部导入」保留                | 把 cloudDrive 入口继续标成跨设备同步 |
| 成熟 AEAD / KDF 库                              | 自写密码学原语；CRDT（P1）           |

### 明确缺口（相对目标）

1. **无** FileRevision / deviceSequence / opaquePathId / 跨设备 control plane。
2. **无** E2EE 密钥层级、恢复码、设备撤销协议。
3. **无** 冲突组 / 三方合并 / conflict copy UI。
4. **无** 版本历史恢复（跨设备）；localFolder 无等价物。
5. **无** 选择性同步产品面。
6. Inventory：**`LOCAL_FOLDER_SCAN_MAX_FILES = 500` 静默截断**（R2 整改项）— Vault Sync 不得继承。
7. 传输：既有 commit 走 Base64 — **违反**大附件验收门槛。
8. 模式混淆风险：managed_push / cloudDrive / E2EE 若文案不清会错误承诺。
9. Web UI 密钥存储策略未定义（须禁 localStorage）。
10. PostgreSQL + 对象存储 Sync 控制面未建。

### 云盘入口现状 → 迁移

- 入口（Import IA 现行）：「录入知识」仅 4 tab（本地文件夹 / 网页 / 笔记 / 主动源）；`cloudDrive` 属 **外部来源导入**，非 Vault。
- 行为：外部云盘绑定 locator（如 `baidu:/docs`）→ `knowledge.connector.bind`。
- **Vault 产品入口 = TBD / 暂不开放（2026-07-23）**：不得再规划「录入知识内新增同步仓库主入口」或「本地文件夹·同步方式」挂载；能力层表单/协议保留，待独立入口确定后再产品化。
- 迁移（历史，superseded）：曾规划把 `cloudDrive` 文案升级为同步仓库主入口 —— **已废止**，见 alignment §9 / Wave U。

---

## Tasks

### P0 — 协议与威胁模型（本阶段）

- [x] 0.1 阅读 `AGENTS.md`、`SECURITY.md`、source-connector / remediation 设计与 local-folder / passive / cloud-drive / UI 相关源码。 — cursor-vault-sync
- [x] 0.2 `git status` + `bun scripts/agent-attribution.ts` + `pnpm loom status`；确认不触碰他人 WIP。 — cursor-vault-sync
- [x] 0.3 建立本 spec（requirements + design + tasks）并 loom register。 — cursor-vault-sync
- [x] 0.4 输出 P0 设计：威胁模型、架构、FileRevision、状态机、DDL、API、密钥层级、冲突、UI 迁移、验收矩阵。 — cursor-vault-sync
- [x] 0.5 将现有能力 / 可复用 / 缺口 / 路径所有权写入 tasks.md。 — cursor-vault-sync
- [x] 0.6 **人工评审通过** P0 设计（开放问题 §13 拍板）后方可开 P1。 — cursor-vault-sync（用户指示直接执行 P1）

### P1 — 桌面双设备 MVP（评审后）

> **验收状态（2026-07-22）**：未通过。实现为原型/部分完成，不得标为验收完成。

- [x] 1.0 verify-then-take：以 `src/vault-sync/**` 规避 `knowledge-data-closure-audit:grok` 的 `src/gateway/knowledge/**` 重叠。 — cursor-vault-sync
- [x] 1.1 `src/vault-sync`：FileRevision 类型 + 幂等 revisionId + 单测（实现有；验收未过）。 — cursor-vault-sync
- [x] 1.2 加密模块：scrypt + HKDF + AES-256-GCM（实现有；验收未过）。 — cursor-vault-sync
- [x] 1.3 本地 inventory 分页 + opaque journal + excludes（实现有；验收未过）。 — cursor-vault-sync
- [x] 1.4 Control plane MVP：Vault CRUD、revision commit、ciphertext blob（文件后端；生产 PG 未过）。 — cursor-vault-sync
- [x] 1.5 双设备增量同步 + conflict copy（实现有；Chromium E2E 未勾选）。 — cursor-vault-sync
- [x] 1.6 UI：**表单/控制器组件**（`renderVaultSyncImportForm` + vault-sync controller）；云盘保持外部来源。**产品入口 = TBD — 不得标为「同步仓库入口已交付」**（Wave U）。i18n 共享热文件最小 diff、未强提。 — cursor-vault-sync
- [x] 1.7 同步完成后 Runtime 真投影/索引/删除传播（hook 已接 local-folder scan + `runtime.reindex` RPC；浏览器 FSA 需 gateway 可见 root 或同 KB 的 local-folder 绑定；整体验收未过）。 — cursor-vault-sync
- [x] 1.8 门禁：`pnpm tsgo` Vault Sync **自身**相关错误（Wave M：FSA memory / runtime hook logger / vault HTTP body）。**不代表** 全仓 tsgo 清零，也不代表 Chromium UI 验收或整体 P1 通过。 — cursor-vault-sync

### P2 — 产品闭环

> **验收状态（2026-07-22）**：未通过。

- [x] 2.1 WebSocket cursor/revision 通知（实现有；验收未过）。 — cursor-vault-sync
- [x] 2.2 版本历史与恢复删除（实现有；验收未过）。 — cursor-vault-sync
- [x] 2.3 选择性同步（实现有；部分 RPC 缺成员校验）。 — cursor-vault-sync
- [x] 2.4 设备撤销与密钥版本（实现有；撤销前向保密未过）。 — cursor-vault-sync
- [x] 2.5 大文件 HTTP 二进制分片上传（Wave D：`PUT /__openbot/vault-sync/v1/.../chunks/{i}` + upload token；WS Base64 仍 capped；S3 预签名属 Wave E；整体验收未过）。 — cursor-vault-sync
- [x] 2.6 inventory/status/history/trash/selective-sync/devices/upload-session 完整成员身份校验（实现已接 `requireVaultMemberAccess`；验收未过）。 — cursor-vault-sync
- [x] 2.7 生产存储：PostgreSQL 元数据镜像 DDL + S3/MinIO 对象存储后端（file 默认；`OPENBOT_VAULT_SYNC_BLOB_BACKEND=s3` / `OPENBOT_VAULT_SYNC_DATABASE_URL`；文件平面仍为权威；整体验收未过）。 — cursor-vault-sync
- [x] Wave G：`OPENBOT_VAULT_SYNC_METADATA_PRIMARY=postgres` 时 vault/blob/revision/heads/devices **强制持久化 PG** + `flushMetadataPrimary` + 文件缓存 wipe 后 `hydrateVaultMetadataFromPostgres` 恢复。 — cursor-vault-sync
- [x] Wave H：members/invites 进入 PG DDL + primary replace/hydrate（仅 wrapped/public key；无 invite secret）。**≠** 生产切主 / P2 验收完成。 — cursor-vault-sync
- [x] Wave J：真实 PG + MinIO **可选 live smoke**（`postgres-s3.live.test.ts` + `src/vault-sync/dev/run-smoke.sh` + `src/vault-sync/dev/docker-compose.smoke.yml`；默认 CI skip）。**≠** 生产切主验收。 — cursor-vault-sync
- [x] Wave Q：切主形 live smoke — `run-cutover-smoke.sh`（`METADATA_PRIMARY=postgres` + S3 + objectUpload PG hydrate）+ `CUTOVER-SIGNOFF.template.md`。**≠** P2 生产签收。 — cursor-vault-sync
- [x] Wave R：Chromium **restore 脚手架** E2E（`client-restore.e2e.browser.test.ts`：tombstone → restore → 本地文件 + 新 revision）。**≠** KU 版本历史 UI 人工签收。 — cursor-vault-sync
- [x] Wave L：audit events → PG append/hydrate + `src/vault-sync/dev/CUTOVER.md` 切主 checklist。**≠** 生产切主签收 / P2 验收。 — cursor-vault-sync

### P3 — 移动端

> **验收状态（2026-07-23）**：未通过整体验收。Wave E 已接入真实 sync runner；Wave I 已接 >1MiB HTTP/WS upload-session（真机 E2E 未勾选）。

- [x] 3.1 iOS/Android 安全绑定 + 本地 Vault 目录（绑定/目录 + runner 已接；整体验收未过）。 — cursor-vault-sync
- [x] 3.2 前台/后台同步执行器接入（Coordinator → VaultSyncRunner；gateway connect 时接线；整体验收未过）。 — cursor-vault-sync
- [x] Wave I：移动端 `storeCiphertextBlob` — ≤1MiB direct put；>1MiB upload-session + HTTP binary chunk（有 httpOrigin）/ WS Base64 fallback；Wave N 加 S3 objectUpload 优先。**≠** 真机 E2E 验收。 — cursor-vault-sync
- [x] Wave P：真机验收脚手架 — `MOBILE-ACCEPTANCE.md` + Android/iOS objectUpload 单测。**≠** 真机 checklist 签收。 — cursor-vault-sync

### P4 — 团队 Vault

> **验收状态（2026-07-22）**：未通过。实现已改为随机 BaseKey + epoch；历史密文不重加密；整体验收未过。

- [x] 4.1 成员密钥封装、邀请、撤销、**随机 BaseKey + epoch** 轮换（前向保密仅保证轮换后新写入；实现有；验收未过）。 — cursor-vault-sync
- [ ] 4.2 仅真实多人同文档协作需求出现后评估 CRDT。

### R1→R3 整改（专家验收后，2026-07-22）

- [x] R1（P0）：Gateway `gateway-auth`；密文 RPC；legacy sync 默认关闭。 **P0 验收通过。** — cursor-vault-sync
- [x] R2 部分：inventory 基线 + epoch HKDF helpers（撤销仍用同 BaseKey → P4 未过）。 — cursor-vault-sync
- [x] R1 UI：浏览器 FSA + 本地加密 client（E2EE 主链路成立）。 — cursor-vault-sync
- [ ] R3：Runtime 真投影（Wave C）；HTTP 二进制上传（Wave D）；S3/MinIO + PG（Wave E/G/H）；移动端 runner + >1MiB HTTP（Wave E/I 已实现未验收）；Chromium 人工 UI E2E / 移动真机 E2E。
- [x] Wave F：双端 client-sync **脚手架** E2E（`client-sync.e2e.node.test.ts` + Node `localFs` 代替 FSA；A→B + >1MiB HTTP chunk；断言密文不上报明文）。**≠** 人工 Chromium FSA UI 验收。 — cursor-vault-sync
- [x] Wave G：PG metadata primary + hydrate（见 2.7 备注）。**≠** 生产切主验收。 — cursor-vault-sync
- [x] Wave H：members/invites PG schema + hydrate（见 2.7 备注）。**≠** 生产切主验收。 — cursor-vault-sync
- [x] Wave I：移动端 >1MiB HTTP upload-session（见 P3）。**≠** 真机 E2E。 — cursor-vault-sync
- [x] Wave J：PG+MinIO live smoke 脚手架（见 2.7/Notes）。**≠** 生产切主。 — cursor-vault-sync
- [x] Wave K：Chromium Playwright 双端 E2E **脚手架**（`client-sync.e2e.browser.test.ts` + memory FSA + memory plane；A→B + >1MiB HTTP；真实 Web Crypto）。**≠** 人工选文件夹 / KU 表单 UI 验收。 — cursor-vault-sync
- [x] Wave L：audit → PG + cutover runbook（见 2.7 / `src/vault-sync/dev/CUTOVER.md`）。**≠** 生产切主签收。 — cursor-vault-sync
- [x] Wave M：原子 revoke+epoch+wraps（见再次验收 / P4）。**≠** P1/P4 整体验收。 — cursor-vault-sync
- [x] Wave N：S3 `objectUpload` 预签名直传闭环 — create session 返回 presigned PUT；客户端（Web/Android/iOS）优先直传 S3；`completeUploadSessionAsync` 校验对象后注册 blob（无 gateway chunk 文件）。单测：`object-upload-direct.node.test.ts` + `client-blob-upload` objectUpload 优先。**≠** P2 整体验收 / 生产切主签收 / presigned GET 下载。 — cursor-vault-sync
- [x] Wave O：Chromium 团队流 **脚手架** E2E（`client-team.e2e.browser.test.ts`：enable team → invite → accept → sync → revoke+rotate → >1MiB）+ 人工验收清单 `src/vault-sync/dev/CHROMIUM-ACCEPTANCE.md`。**≠** Knowledge Universe 表单/选文件夹人工 UI 签收。 — cursor-vault-sync
- [x] Wave P：移动真机 **脚手架** — `MOBILE-ACCEPTANCE.md` 人工清单；Android/iOS `VaultSyncGatewayClientObjectUpload*` 单测（objectUpload 优先于 HTTP chunk）；iOS `putObjectUploadDirect` 改用注入 `urlSession`。**≠** P3 真机签收。 — cursor-vault-sync
- [ ] 人工 Chromium E2E：建库 → 选文件夹 → sync → team → invite → revoke → epoch bump → restore → >1MB（见 `CHROMIUM-ACCEPTANCE.md` 勾选签收）。
- [ ] 人工移动真机 E2E：见 `src/vault-sync/dev/MOBILE-ACCEPTANCE.md` 勾选签收。

### 2026-07-23 实现层签收（自动化证据）

> 证据文件：`src/vault-sync/dev/ACCEPTANCE-EVIDENCE-2026-07-23.md`（git `68a76e9673` Wave S）。  
> **层 A 签收 ✅** = 协议/客户端/本地 cutover smoke 已实现且自动化通过。  
> **≠ P1–P4 整包产品验收**（KU 表单点击 / 真机 / 生产 flip 仍待层 B/C/D）。

| 层               | 状态                       | 待办                                                                                                                   |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A 实现/自动化    | **已签收**                 | —                                                                                                                      |
| B Chromium KU UI | **入口 TBD — 不可签**      | 组件 DOM 可测；**产品 walkthrough 为未来入口模板**（`CHROMIUM-ACCEPTANCE.md`）；Import IA 四通道页未全部落入本任务提交 |
| C 移动真机       | 待签                       | `MOBILE-ACCEPTANCE.md`                                                                                                 |
| D 生产切主       | 本地 smoke 已签 / 生产待签 | `CUTOVER-SIGNOFF.template.md`                                                                                          |

### 2026-07-23 再次验收结论（更新）

**判定：P0 + 实现层（层 A）通过；P1–P4 产品整包仍不通过。**

| 项  | 结果                            | 说明                                                             |
| --- | ------------------------------- | ---------------------------------------------------------------- |
| P0  | 通过                            | 不变                                                             |
| P1  | 不通过（整包）                  | 层 A 自动化过；**产品 Vault 入口 = TBD**；不得用导入页签收 KU UI |
| P2  | 不通过（产品）/ 本地 smoke 通过 | `run-cutover-smoke.sh` 2/2；**生产 cutover 未 flip**             |
| P3  | 不通过                          | 代码+单测脚手架有；**真机 checklist 未签**                       |
| P4  | 不通过（产品）/ 协议通过        | 原子 revoke+rotate 自动化过；**KU 团队 UI 未人工点**             |

已确认通过的整改（2026-07-23 自动化复跑）：Chromium browser E2E **5/5**（K+O+R）；KU 表单 Wave S **4/4**；cutover smoke **2/2**；vault-sync node **78+** pass。

- [x] Wave M（部分）：`revokeMemberAndRotateEpoch` + RPC `members.revoke-and-rotate` + UI 团队撤销走原子路径；Vault Sync 相关 tsgo（FSA memory / hook logger / HTTP body）已修。**≠** 整体 P1/P4 验收；真机 / 人工 UI / 切主签收仍阻断。 — cursor-vault-sync
- [x] Wave N（部分）：S3 presigned PUT 直传 + complete 无 chunk 文件；Web/Android/iOS 客户端优先 objectUpload。**≠** P2 整体验收 / 切主签收 / 真机 / 人工 UI。 — cursor-vault-sync
- [x] Wave O（部分）：memory plane 团队 RPC + Chromium 团队流脚手架 E2E + `CHROMIUM-ACCEPTANCE.md` 人工清单。**≠** KU 表单人工 UI 签收。 — cursor-vault-sync
- [x] Wave P（部分）：`MOBILE-ACCEPTANCE.md` + 移动 objectUpload 单测脚手架 + iOS urlSession 注入修复。**≠** P3 真机签收。 — cursor-vault-sync
- [x] Wave Q（部分）：`run-cutover-smoke.sh` + live objectUpload/PG hydrate + `CUTOVER-SIGNOFF.template.md`。**≠** P2 生产切主签收。 — cursor-vault-sync
- [x] Wave R（部分）：memory plane restore RPC + Chromium tombstone→restore E2E。**≠** KU 历史 UI 人工签收。 — cursor-vault-sync
- [x] Wave S：KU vault-sync 表单 Chromium DOM（`knowledge-universe-vault-sync.browser.test.ts`：表单控件）。**≠** 产品入口签收。Wave U 后改为直接测 `renderVaultSyncImportForm`，不依赖录入知识页。 — cursor-vault-sync
- [x] Wave T（import IA 对齐 / **已废止**）：曾接受 kiro 方案 A — `vaultSync` 并入 `本地文件夹 · 同步方式`；hydrate 接线。**Superseded by final import IA decision on 2026-07-23**（用户推翻方案 A；本地文件夹无选择器、固定 managed_push、Vault 不在此入口）。历史 handoff：`docs/design/openbot-knowledge-vault-sync-import-entry-merge-alignment-2026-07-23.md` §1–8 = 旧方案；**以 §9 为准**。 — cursor-vault-sync
- [~] Wave U（**部分** — Vault 自有收口完成；Import IA 集成待完成，2026-07-23 复检未过）：
  - **已完成（cursor-vault-sync）**：规格 R1/入口 TBD；方案 A / Wave T 标废止；hydrate 不依赖本地文件夹产品入口；`app.ts` 默认 `managed_push`；表单 browser 测直接渲染组件；证据表 SUPERSEDED。
  - **未完成（属 Import IA / 共享树，非本 Wave 整包签收）**：runtime/`local-folder` 仍可能 `local_index`；四通道页面改动尚未全部 commit；`managed_push` plan/commit 上传闭环未接通；无个人空间自动物化；废弃 `folderSync` i18n 待清。
  - **判定**：不得将 Wave U 标为整体验收通过。 — cursor-vault-sync

### 2026-07-22 验收结论

**判定：不通过整体 P0–P4；仅 P0 通过。**

| 项  | 结果   | 阻断摘要                                                                                                                                 |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | 通过   | 浏览器 E2EE 主链路；密码/明文默认不上 Gateway；legacy 需 `OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC=1`                                      |
| P1  | 不通过 | Runtime 投影已接但未经验收；Chromium E2E 未勾选                                                                                          |
| P2  | 不通过 | HTTP + S3/MinIO + PG primary（含 members/invites/audit）已实现；Wave J live smoke + Wave L cutover runbook 有；未经验收 / 未生产切主签收 |
| P3  | 不通过 | runner + >1MiB HTTP/WS session 已实现；缺移动真机 E2E                                                                                    |
| P4  | 不通过 | 随机 BaseKey 已实现；整体验收未过                                                                                                        |

整改波次：Wave A→…→Q（cutover smoke）→ R（Chromium restore E2E）。**实现落地 ≠ 整体验收通过。**

- Live smoke：`./src/vault-sync/dev/run-smoke.sh`（需 Docker；或自备 PG/MinIO + `OPENBOT_VAULT_SYNC_LIVE=1`）。
- 切主清单：`src/vault-sync/dev/CUTOVER.md`（未签收）。

---

## Notes

- Agent-id：`cursor-vault-sync`。提交：`scripts/committer` + trailers `Task: knowledge-vault-sync` / `Agent: cursor-vault-sync`。
- 不创建/切换分支、不 worktree、不 stash；不提交非本任务文件。
- 不得声称部署完成；不得声称 P0–P4 整体验收通过；**不得将 Wave U 标为整包通过**。
- **Import IA handoff（复检 2026-07-23，非本任务落地）**：
  - `knowledge-universe.ts` runtime 工厂仍 `local_index`；`knowledge-universe-local-folder.ts` bind 成功后重置 `local_index`。
  - `managed_push` 需 plan/commit 上传闭环 + 回归断言；无个人空间自动物化。
  - 四通道页改动属 `kiro-web-ui` 工作树；废弃 `folderSync` i18n 由 i18n owner 清理。
  - `app.ts` 多任务声明 — 需 Loom owner 协调归属。
- 工作树观察（2026-07-23）：其他 agent dirty 与本任务无关 — **勿动**。
