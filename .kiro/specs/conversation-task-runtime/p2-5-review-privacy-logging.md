# P2.5 专项评审 — 隐私与日志

> 被评审设计: `./p2-5-production-integration.md`(§3、§6、§7)、`./p2-5-admission-package.md`(§2)
> 实施 owner: `kiro-conversation-task-runtime` · 独立 reviewer: `kiro-privacy-reviewer`(**≠ 实施 owner**)
> 关注点: 仅 tenant-scoped HMAC、禁止无密钥指纹与明文 id、幂等键隐私、留存与降级禁令。
> 状态: **独立评审已签署;经 C1–C7 复核(2026-08-25,基线 `1e948ebf70`/#707)后 CONDITIONAL 已解除 → CLOSED。** 治理: 实施 owner 不得切角色代签。
> 评审基线: v1 初评 `origin/main` = `968b4b739f`;C1–C7 复核基线 = `origin/main` = `1e948ebf70`(#707 设计整改)。所有判据均对照相应 SHA 的真实代码亲验。

## 评审清单(逐项 decision 由独立 reviewer 填写)

| #   | 评审项                | 判据                                                                                                 | 实施自评(证据)                  | 独立 decision    |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------- |
| P1  | 仅 tenant-scoped HMAC | 文本指纹只用 `tenantFingerprint`(keyed HMAC);**禁止** `fingerprintText`(无密钥)作生产替代            | 设计 §6;`shadow.ts`/`replay.ts` | **CLOSED**       |
| P2  | 无明文 id             | 日志/指标标签**无**明文 `tenantId`/`conversationId`/`messageId`;关联用各自 tenant-scoped HMAC        | 设计 §6;验收 #10                | **CLOSED**       |
| P3  | 无原文/实体/密钥      | 落盘/指标不含原文、抽取实体、HMAC key、凭据                                                          | 设计 §6                         | **PASS(设计层)** |
| P4  | 幂等键隐私            | 复合 UNIQUE 的 `conversationId`/`messageId` 列以全宽 tenant-scoped HMAC 落库,非明文;文本 hash 仅索引 | 设计 §3;验收 #9/#10             | **CLOSED**       |
| P5  | HMAC 缺失/过期不降级  | key 缺失/过期(`HMAC_KEY_MAX_AGE_MS`)/provider 失败 => 不写 shadow,**不降级**为无密钥 hash 或明文     | 设计 §6;验收 #11                | **CLOSED**       |
| P6  | 留存 TTL + 删除凭据   | `SHADOW_LOG_DEFAULT_TTL_MS`;过期清理有删除凭据 `verifyShadowReceipt`(HMAC 哈希链)                    | `shadow.ts`                     | **PASS**         |
| P7  | 告警脱敏              | 所有告警(含失败/drop)不带原文/明文 id                                                                | 设计 §6/§7                      | **PASS(设计层)** |
| P8  | 质量样本脱敏          | 延迟标注样本来自脱敏抽样队列;标注流程不泄漏原文到指标                                                | 设计 §7.2;验收 #18              | **PASS(设计层)** |

## 亲验记录(reviewer 对照真实代码)

- **P1 keyed HMAC = 真;但存在无密钥指纹经 `log_json` 泄漏的真实陷阱。** `shadow.ts` 的 `tenantFingerprint(text, tenantId, key)` 为 `HMAC-SHA256(secret, canonical(tenantId, text))`,返回 `hf_<keyId>_<mac>`,keyed、确定性、不截断——符合 §6。`replay.ts` 的 `fingerprintText` 为无密钥 FNV-1a,注释明示“仅离线/coarse,keyed 版延后至 P2”。**问题**:`types.ts` 的 `ShadowDecisionLog.inputFingerprint` 为**必填**字段,唯一现存日志构造器 `replay.evaluateTurn`/`evaluateTurnGated` 用 `fingerprintText(input.text)` 填充;而 `ShadowLogBook.append` 以 `JSON.stringify(input.log)` 落 `log_json`。若接线复用该构造器,则**无密钥指纹被写入生产影子库**,直接违反 §6“禁止 fingerprintText 作生产替代”。设计陈述了规则,但未与既有构造器/字段对齐关闭该陷阱。
- **P2/P4 = 设计要求正确,但现状为明文列。** 当前 `shadow.ts` 建表 `shadow_logs(… conversation_id TEXT, message_id TEXT …)` 落为**明文**,`idx_shadow_conv` 亦按明文 `conversation_id` 建索引;`append` 直接写明文。设计 §3 要求这些 id 列改为全宽 tenant-scoped HMAC(属未来实现,自评引用设计而非现状,诚实)。故 P2/P4 依赖尚未落地的 schema 变更。
- **P5 = 过期路径真、缺失路径未在 shadow.ts 强制。** `append` 在 `isHmacRotationDue(key, atMs)` 为真时抛 `ConversationTaskStoreError("hmac_key_expired")`,fail-closed 成立;`HMAC_KEY_MAX_AGE_MS=90d`。但 “key **缺失**” 依赖 `keyProvider` 抛错(类型签名返回 `TenantHmacKey`,无“缺失”哨兵),`shadow.ts` 自身未显式处理缺失态。
- **P6 = 真(强证据)。** `SHADOW_LOG_DEFAULT_TTL_MS=30d`;删除写入 HMAC keyed、哈希链(`prevDigest`→`digest`)删除凭据,`verifyShadowReceipt` 可校验未被伪造/重算。符合 §6 留存 + 删除凭据。
- **P3/P7/P8 = 设计层成立。** `ShadowDecisionLog` 只含 reasonCodes/signals/类别/布尔/计数,无原文/实体;指标/告警脱敏与延迟标注脱敏为设计承诺,须由实现与验收 #10/#18 强制。

## 附加条件 / 阻断项(独立 reviewer 填写)

- **[CONDITIONAL-P1 / C1(主须修)]** 生产 shadow-only 日志构造**不得持久化无密钥 `inputFingerprint`**。**条件**:接线的日志构造器须移除该字段,或将其改为 keyed `tenantFingerprint`(与列指纹一致);明确禁止在生产路径复用 `replay.fingerprintText`。验收 #10 须显式断言 `log_json` 内**不含** `fp_` 前缀(无密钥)指纹,仅允许 `hf_` keyed 指纹或结构化字段。
- **[CONDITIONAL-P2/P4 / C2]** shadow 落盘**不得含明文 id**。**条件**:`shadow_logs` 的 `conversation_id`/`message_id`(及任何索引)须改为全宽 tenant-scoped HMAC 列;复合 UNIQUE 亦建于 HMAC 列(与安全评审 S10 一致)。验收 #10 须断言磁盘上无明文 `tenantId`/`conversationId`/`messageId`,#9 断言 HMAC 复合 UNIQUE 并发唯一。并须(同 S10/C2)说明密钥轮转对指纹稳定性的影响(纪元内成立)。
- **[CONDITIONAL-P5 / C5]** “HMAC key 缺失不降级”须由**契约**保证:key provider 缺失时**必须抛错**(绝不返回空 secret/占位密钥);`append` 对缺失与过期一致 fail-closed。验收 #11 须覆盖**缺失**用例(不仅过期),断言缺失时不写 shadow、聊天正常、且不降级为无密钥 hash 或明文。

## 复核确认(C1–C7,2026-08-25,基线 `1e948ebf70`/#707)

- **P1 → CLOSED**:设计 §3.1 + §6 明确生产 shadow 记录构造器**必须**移除 `inputFingerprint` 或改为 keyed `tenantFingerprint`,并**禁止**任何无密钥 `fingerprintText` 进入 `log_json` 或任何落库/指标字段。验收 #10 强化断言 `log_json` 无 `fp_` 无密钥指纹。原“无密钥指纹经 `log_json` 落库”陷阱在设计层闭合。
- **P2 / P4 → CLOSED**:设计 §3.2 将 `conversationId`/`messageId` 改为全宽 tenant-scoped HMAC 列(取代现明文 `conversation_id`/`message_id`,已亲验现状为明文且无 UNIQUE),复合 UNIQUE 建于 HMAC 列;§6 禁止明文 id 进入日志/指标/落库列。验收 #9/#10 断言磁盘无明文 id + 并发唯一。
- **P5 → CLOSED**:设计 §6 规定 `TenantHmacKeyProvider` 契约——密钥**缺失必抛错**(绝不返回空/undefined secret);缺失(非仅过期)或 provider 失败 => 不写、不降级。验收 #11 覆盖**缺失**用例;§7.1 HMAC failure 指标显式含缺失 + 过期。
- P3/P6/P7/P8 初评即成立,复核维持 PASS。

## 独立签署

- Reviewer id: **`kiro-privacy-reviewer`**(≠ `kiro-conversation-task-runtime`) · 初评日期: **2026-08-25**(基线 `968b4b7`) · 复核日期: **2026-08-25**(基线 `1e948ebf70`/#707) · IDE/Loom session: `kiro` / `FBDD4864-0261-4D8F-BA68-3C6E627E7059`(reviewer 统一独立 session)
- 逐项结论: P6 = PASS(亲验);P3/P7/P8 = PASS(设计层);P1/P2/P4/P5 = **CLOSED**(复核后由 CONDITIONAL 解除)。
- 总结论: **条件通过 → CLOSED(2026-08-25 复核)**。keyed HMAC 指纹、过期 fail-closed、哈希链删除凭据初评已亲验;C1(无密钥 `inputFingerprint`)、C2(明文 id 列改 HMAC)、C5(缺失密钥契约级 fail-closed)三处缺口经 #707 设计整改后于设计层闭合,余下强制点委派给强化验收(#9/#10/#11)于编码门禁执行。**本项无剩余阻断条件。**
