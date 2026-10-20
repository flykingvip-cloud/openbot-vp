# P2.5 shadow-only — AC-A1 密钥派生隐私签核请求

> 类型:签核请求(移交件 C 前置门禁 AC-A1)。**待独立 `kiro-privacy-reviewer` 裁决**;实施 owner `kiro-conversation-task-runtime` 不自签。
> 授权来源:移交件 A `APPROVED — 有条件 GO`(`kiro-release-authority`,2026-08-26,候选 `83c6718cb7`),条件 AC-A1。
> 关联:`./p2-5-production-readiness.md` §4 步骤 1、`./p2-5-production-integration.md` §6、`./p2-5-admission-package.md` §5.1(C5)。
> 门禁位置:**AC-A1 必须在 D cutover 注入 `OPENBOT_CT_SHADOW_HMAC_KEY` 之前完成。** 顺序:AC-A1 → D(部署 + 注入 key)→ C(热切 allowlist/flag)。

## 1. 请裁决的对象

P2.5 shadow 影子日志所用的 **tenant-scoped HMAC 密钥派生方案**是否满足隐私要求(C5:无明文 id、无无密钥指纹、缺 key 不降级)。

## 2. 方案事实(对照真实代码,便于裁决)

代码锚点:`src/conversation-task/runtime-bootstrap.ts` `envTenantHmacKeyProvider`;`src/conversation-task/shadow.ts`。

- **单一服务端 root secret**:部署 env `OPENBOT_CT_SHADOW_HMAC_KEY`(兼容旧 `OPENCLAW_CT_SHADOW_HMAC_KEY`)。root **仅存部署密钥管理**,不入 repo/config 文件。
- **每租户派生**:`tenantSecret = HMAC-SHA256(root, "conversation-task/shadow/v1/" + tenantId)`。root **从不**直接用作租户密钥;租户间不共享原始密钥;派生盐带版本 `v1`。
- **密钥纪元**:`keyId` 取 `OPENBOT_CT_SHADOW_HMAC_KEY_ID`(默认 `"env"`);轮转 `keyId` = 新纪元(幂等在纪元内成立,轮转如 TTL 重置)。
- **缺失 fail-closed(C5)**:root 未设/为空 ⇒ provider 抛 `hmac_key_missing`(**不返回空 secret、不降级为无密钥 hash**);shadow 不写、聊天不受影响。
- **落盘去明文**:`conversationId`/`messageId` 经 `keyedIdHmac` 落 HMAC 列(无明文);`inputFingerprint` 以 keyed `tenantFingerprint` 覆盖,`log_json` 无 `fp_` 无密钥指纹;`tenantId` 以 `fileKeyForTenant`(SHA-256)落列。

## 3. 请 reviewer 明确裁定的点

- [ ] root secret 的**强度/来源/保管**(建议 ≥256-bit 随机、经部署密钥管理下发、不落盘不入日志)。
- [ ] 派生构造 `HMAC-SHA256(root, "conversation-task/shadow/v1/"+tenantId)` 的**租户隔离充分性**与盐版本策略。
- [ ] `keyId` **轮转策略**与纪元语义(轮转对既有影子行/幂等键的影响是否可接受)。
- [ ] 缺失/过期 **fail-closed** 是否满足"不降级"要求(已核代码:缺失抛 `hmac_key_missing`、过期抛 `hmac_key_expired`)。
- [ ] 是否要求告警/指标标签仅用 HMAC、绝不出现明文 id/原文(§7.4)。

## 4. 独立签核块(由 `kiro-privacy-reviewer` 填写)

- Reviewer id(**≠ `kiro-conversation-task-runtime`**):**`kiro-privacy-reviewer`**
- 日期(UTC):**2026-08-26**
- 结论:**CONDITIONAL(有条件通过)** —— 派生**方案本身 APPROVED**;密钥注入(D)须在 **AC-cond-1..3** 闭合并记入 **seq 44** 证据后方可执行;**AC-cond-4 为启用(C)后强制观察验收**(见下"死锁修正")。
- 附加条件(须闭合):
  - **AC-cond-1(root 强度/保管)**:`OPENBOT_CT_SHADOW_HMAC_KEY` 必须为 **≥256-bit CSPRNG 随机** root,经**部署密钥管理**下发;**绝不**入 repo/config/日志/env dump/ledger 证据(seq 43 只记 "key set",不记值)。
  - **AC-cond-2(环境隔离)**:生产 root 与 staging/dev **不同源、不复用**;每环境独立 root。
  - **AC-cond-3(轮转)**:设定并记录 `OPENBOT_CT_SHADOW_HMAC_KEY_ID` 纪元;轮转周期 **≤ 90 天**(与代码 `HMAC_KEY_MAX_AGE_MS` 对齐,过期即 `hmac_key_expired` fail-closed);运维须知轮转=幂等纪元重置(设计已冻结)。
  - **AC-cond-4(告警/指标去标识)**:C 观察期须抽验 §7.4 告警/指标 payload 与标签**仅含** `keyId`/HMAC/reason-code,**零**明文 `tenantId`/`conversationId`/`messageId`/原文。
- 备注(亲验依据,基线 `origin/main 278958330c`):
  - 租户隔离 = 真:`envTenantHmacKeyProvider` = `HMAC-SHA256(root, "conversation-task/shadow/v1/"+tenantId)`,root 不直接作租户密钥、租户间不共享、盐版本 `v1`(`runtime-bootstrap.ts`)。
  - 去明文落盘 = 真:`keyedIdHmac` → `hi_<keyId>_<HMAC>`(域分隔 conv/msg、全宽、NFC、keyed、不可无密钥重算);`tenantFingerprint` → `hf_<keyId>_<HMAC>`,原文不存;`append` 以 keyed 指纹覆盖 `inputFingerprint`(`log_json` 无 `fp_`)。
  - fail-closed = 真:`assertUsableKey` 对缺失/空 secret/空 keyId 抛 `hmac_key_missing`(不降级);`isHmacRotationDue`(≥90d)抛 `hmac_key_expired`。**满足 C5「缺失非仅过期、不降级」。**
  - 结论理由:密码学派生与 fail-closed 在代码层已正确、充分;CONDITIONAL 仅因 root 强度/保管/轮转/告警去标识属**运维不可由代码自证**项,须由 D/C 执行方满足并留痕。这些闭合后本签核即视为放行 key 注入。

> 治理:未获本签核(方案 APPROVED 且 **AC-cond-1..3** 闭合)前,**不得**在任何生产部署 env 中注入 `OPENBOT_CT_SHADOW_HMAC_KEY`。**当前状态:方案 APPROVED;AC-cond-1..3 待 D 执行方闭合并记入 seq 44(密钥注入前置);AC-cond-4 为 C 启用后的强制观察验收。** 实施 owner `kiro-conversation-task-runtime` 不代签。

> **死锁修正(按生产部署前 CONDITIONAL 验收报告,2026-08-26;实施 owner 依报告更新相位归类,`kiro-privacy-reviewer` 复核确认):** 原表述要求 AC-cond-1..4 全部在密钥注入前闭合,但 **AC-cond-4**(启用后抽验 §7.4 告警/指标去标识)在无密钥、无 shadow 数据时无法完成——存在执行死锁。冻结修正:**AC-cond-1..3 = 密钥注入(D)前置;AC-cond-4 = 启用(C)后强制观察验收**,失败即清 allowlist + `detection`/`qualification` OFF。证据记入 **seq 44**(seq 43 = PR #748 平台鉴权 cutover,**非** CTR 密钥部署,不得追认)。条件实质不变,仅相位归类修正。

> 治理:未获本签核(APPROVED 或条件已闭合)前,**不得**在任何生产部署 env 中注入 `OPENBOT_CT_SHADOW_HMAC_KEY`,即 D cutover 的 key 注入步骤不得执行。

## 5. AC-cond-1 闭合裁定块(vault 迁移后填写;仅 `kiro-privacy-reviewer` 署名,实施 owner/executor 不代签)

> 触发条件:发布操作者已按 `deploy/production/evidence/COLLAB_CSC_CT_SHADOW_VAULT_MIGRATION_1PASSWORD_A1_20260827.md`
> 完成 1Password 迁移(机制 A1)并记入 ledger。本块把 AC-cond-1 从 seq-44 的 **partial/pending** 收敛为
> **CLOSED**(或列明残留条件)。全程 shadow 保持休眠,activation 仍 NOT APPROVED。

### 5.1 复核清单(reviewer 逐项打勾 + 亲验依据)

- [ ] **临时窗口无泄露、无使用**:seq-44 的 openssl 临时 root 生命周期内 shadow 全程 DORMANT(detection/qualification OFF、allowlist 空),`podman logs` 活动扫描零 shadow 写入;先前意外回显的候选值已作废且**从未加载**;git / 日志 / ledger 均无任何密钥值。
- [ ] **新 root 满足 AC-cond-1**:1Password 内生成的 **≥256-bit CSPRNG** root(`op://Private/openbot-ct-shadow-root`),**在 vault 内生成、从未经宿主机或任何开发终端**。
- [ ] **注入机制 A1 = "root 从不落宿主机磁盘"**:entrypoint 运行时 `op read` 注入到进程内存;`podman inspect ... .Config.Env` 中**不含** `OPENBOT_CT_SHADOW_HMAC_KEY=`(容器配置零值);无任何文件持有 root。
- [ ] **信任根披露与接受**:唯一落宿主机的密钥物料是 1Password **service-account token**(scope 仅限该单项、只读、mode 600、可独立吊销/轮转)。reviewer 明确接受"以受控 SA token 作信任根、换取 root 永不落盘"的模型。
- [ ] **临时 root 已退役**:`/root/.openbot-ct-shadow/ct-shadow.env`(openssl 临时 root)已 `shred`/覆盖销毁,无残留引用。
- [ ] **纪元与轮转(AC-cond-3 衔接)**:`OPENBOT_CT_SHADOW_HMAC_KEY_ID=ct-2026-09-vault` 已记录;≤90 天轮转策略(root + SA token)已确立(与 `HMAC_KEY_MAX_AGE_MS` 对齐,过期 `hmac_key_expired` fail-closed)。

### 5.2 裁定(由 `kiro-privacy-reviewer` 填写)

- Reviewer id(**≠ `kiro-conversation-task-runtime`、≠ `kiro-collab-csc`**):`kiro-privacy-reviewer`
- 日期(UTC):`<FILL>`
- 结论:`<FILL: AC-cond-1 = CLOSED>` 或 `<FILL: CLOSED with residual conditions: ...>`
- ledger 锚点(vault 迁移行/note 的 seq 或 commit):`<FILL>`
- 签名:`Agent: kiro-privacy-reviewer` · `<FILL: UTC timestamp>`

> 治理:本块 CLOSED 前不得进入 C(开 allowlist/flag)。AC-cond-1 CLOSED 仅解除**密钥托管**这一项;
> activation 另需 AC-cond-4(启用后告警/指标去标识抽验)与移交件 C 的独立批准。`production rollout
(to activation) = NOT APPROVED`。
