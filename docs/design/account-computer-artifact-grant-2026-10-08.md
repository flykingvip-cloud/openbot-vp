# Account Computer · 跨机器人产出通行证（Artifact Grant）

> **状态：MVP 设计 + 可验证垂直切片** | 日期：2026-10-08 | Landing：`ARTIFACT_GRANT_MVP`
>
> **触发：** 用户确认「一用户一台云电脑、多机器人共享桌面」后，要求下一片设计并打通：机器人 A 的产出交给机器人 B 审核时，只交**该产出的临时通行证**，不交出 A 的整盘门禁。
>
> **关联：** #423 一用户一云电脑；#439 Interaction Ownership（键鼠/导航归属，**不是**文件 ACL）；`openbot-local-disk-read-grant-2026-09-29.md`（本机节点读盘，**不同威胁面**）；`src/gateway/account-execution-paths.ts` 的 `sharedArtifactsDir`。

---

## 0. 一句话结论

| 层 | 共享？ | 含义 |
| --- | --- | --- |
| Account Computer 桌面 / Chromium profile / noVNC | **按用户共享** | 同用户多 agent 共用一台「显示器 + 浏览器」 |
| Agent workspace / exec 写根 / 私有 artifacts | **按 agent 隔离** | 共享桌面 ≠ 共享整盘 ACL |
| 跨 agent 审稿 | **仅 Artifact Grant** | 路径级、TTL、只读、可撤销、可审计的通行证 |

**不要**把 Ownership、剪贴板、或 Account Computer profile 当成文件 ACL。

---

## 1. 威胁模型

### 1.1 资产

- Agent A 私有工作区与私有 `artifactsDir`（报告、草稿、密钥材料旁路）。
- 用户级 `sharedArtifactsDir`（`dataRoot/artifacts`）：浏览器下载落点，**不是**默认同挂即互开 ACL。
- Account Computer 登录态（cookie / profile）：桌面共享带来的浏览器态，与本方案正交。

### 1.2 攻击者 / 误用

- 恶意或越权 agent B：试图列举或读取 A 工作区其它路径。
- 过期 / 已撤销 grant 被重放。
- 把 grant 交给错误 agentId，或 publisher 误把「整目录」当产物。
- 把「人接管桌面」或 Ownership `HUMAN_TAKEOVER` 误解成获得 A 的私有盘。

### 1.3 目标属性（MVP）

1. **最小授权：** grant 只绑定单个 `artifactId`（内容副本在用户级 store），不绑定 A 的 workspace 树。
2. **主体绑定：** 兑换时 `actorAgentId` 必须等于 `granteeAgentId`。
3. **时间绑定：** `expiresAt` 之后拒绝；`revoke` 立即拒绝。
4. **可选单次：** `singleUse` 兑换成功后作废。
5. **审计：** publish / createGrant / redeem / revoke / deny 有结构化事件（无完整 token 明文进日志可选，MVP 记 grantId）。
6. **失败封闭：** 未知 artifact、错主体、过期、撤销、越权路径 → deny，不泄漏兄弟 artifact 列表。

### 1.4 非目标（明确）

- 不整盘共享、不目录级长期授权。
- 不把 Account Computer profile / 登录态当作文件通行证。
- 不做剪贴板双向同步（属 Input capability 后续）。
- 不替代 local-disk-read-grant（本机节点读用户 Mac 路径）。
- 不替代 group-workspace-file（协作空间文件面）。
- MVP 不做多 scope 写、不做跨租户、不做公网 URL。

---

## 2. 身份与存放

### 2.1 Artifact 身份

```text
(userId, artifactId) → 唯一内容对象
```

- `artifactId`：服务端生成（不可猜测）。
- 元数据：`publisherAgentId`、`name`、`contentType`、`sha256`、`byteLength`、`createdAt`。
- **内容落点：** 用户级 store，推荐物理根：

```text
{sharedArtifactsDir}/.grants/blobs/{artifactId}
{sharedArtifactsDir}/.grants/meta/{artifactId}.json
{sharedArtifactsDir}/.grants/grants/{grantId}.json
{sharedArtifactsDir}/.grants/audit.jsonl
```

即挂在已有 **user-scoped** `sharedArtifactsDir`（`account-execution-paths.ts`）下的隐藏命名空间，而不是 A 的 `.../agents/{agentId}/artifacts`。

### 2.2 为何不直接分享 A 的路径

若 B 拿到 A 工作区相对路径，等于扩大了「路径知识」与挂载面；A 后续写入同路径也会被 B 看到。MVP 在 publish 时**复制或写入**用户级 blob，B 只通过 grant 读该 blob。A 的原路径从不进入 B 的可读面。

### 2.3 与 Ownership / 桌面的关系

| 能力 | 管什么 | 不管什么 |
| --- | --- | --- |
| #423 Account Computer | 谁用哪台共享浏览器 | 文件 ACL |
| #439 Ownership | keyboard/mouse/clipboard-flag/navigation lease | 产出读写 |
| Artifact Grant（本片） | 跨 agent 单对象读授权 | 键鼠、profile、整盘 |

---

## 3. Grant 对象

```ts
type ArtifactGrant = {
  grantId: string;
  artifactId: string;
  userId: string;
  publisherAgentId: string;
  granteeAgentId: string;
  scopes: Array<"read">;      // MVP：仅 read
  expiresAt: number;          // epoch ms
  singleUse: boolean;
  revokedAt?: number;
  redeemedCount: number;
  createdAt: number;
};
```

规则：

- `createGrant` 仅 **publisher**（或未来用户显式代授）可对自有 artifact 发卡。
- `redeem`：校验 userId + grantee + !revoked + now < expiresAt + (!singleUse || redeemedCount == 0)，然后返回**仅该 artifact** 的字节/文本。
- `revoke`：publisher 或用户（后续）可撤；立即生效。
- 无 `list siblings`：持 grant 不能列举 store。

---

## 4. API / Gateway / 工具面

### 4.1 Gateway methods（pack `artifact-grant`）

| Method | Scope | 作用 |
| --- | --- | --- |
| `artifact.publish` | write | A 发布 blob → artifactId |
| `artifact.grant.create` | write | A 为 B 建 grant（TTL、singleUse） |
| `artifact.grant.redeem` | read | B 兑换并读取内容 |
| `artifact.grant.revoke` | write | A 撤销 |
| `artifact.grant.get` | read | 查 grant 元数据（不含内容；错主体仅知存在性策略见实现） |

MVP 实现见 `src/artifact-grant/` + `src/gateway/server-methods/artifact-grant*.ts`。

### 4.2 工具面（后续可挂）

建议 agent 工具名（本 MVP 可不注册 pi-tools，避免扩大面）：

- `artifact_publish` / `artifact_grant_create` / `artifact_grant_redeem`

审稿话术：「请用 grantId=… 只读审这一份」，B 调 redeem，而不是「去 A 的工作区看」。

### 4.3 B 如何打开文档而不继承 A 的凭证

1. A `publish` → 内容进入用户级 blob（与 A workspace 脱钩）。
2. A `createGrant(grantee=B, ttl, read)`。
3. 会话/协作消息只传 `grantId`（或短码），不传 A 路径、不传 A 的 API token。
4. B `redeem(grantId)` → Gateway 校验主体后返回内容；B 的 sandbox **不**挂载 A 的 workspace。
5. 浏览器里若需预览：后续可用短时 preview URL 绑 grant（非本 MVP）。

---

## 5. 验收标准（MVP 验证）

必须全部 PASS（单测 / verify 脚本）：

1. A publish markdown/blob → 得到 artifactId。
2. A createGrant 给 B（TTL、read-only）。
3. B redeem → 读到**完整且仅该**内容。
4. 另一 agent C redeem 同 grant → deny。
5. revoke 后 B redeem → deny。
6. 过期后 B redeem → deny。
7. singleUse：第二次 redeem → deny。
8. 任意「读 artifactId 以外路径 / 列举 store」API 不存在或 deny。
9. 审计日志含 publish/create/redeem/revoke/deny。
10. Registry 声明 `ARTIFACT_GRANT_MVP`；**不**改 Ownership / clipboard / desktop session 铁律。

---

## 6. 实现边界（本 PR）

**做：**

- 设计本文档。
- 纯库 `ArtifactGrantService`（文件后端）+ ACL 单测。
- Gateway method pack 薄封装。
- Landing stream + verify 证据命令。

**不做：**

- Control UI 大页、公网分享链接、写 scope、目录 grant。
- 自动从 A workspace 透传挂载。
- 与 local-files capability token 合并（威胁面不同，可后续对齐签名形态）。

---

## 7. 后续

1. 会话卡片：「邀请审核」一键 createGrant + 投递 grantId。
2. Preview URL / Control UI 只读打开。
3. 与 progress-ledger / deliverable envelope 对齐 artifactRef。
4. 生产路径强制走 `resolveAccountExecutionPaths(...).sharedArtifactsDir`。
5. 可选：single-use + 绑定 sessionKey / turnId（对齐 local-disk-read-grant 的 turn 思想）。
