# CO-Chat 反馈环方案 — 专家审阅与签署记录

**对象**：[主报告 rev2.1](/design/openbot-co-chat-feedback-loop-state-machines-2026-09-15)

---

## 审阅轮次摘要

| 轮次 | 日期       | 结论                                                                                             |
| ---- | ---------- | ------------------------------------------------------------------------------------------------ |
| R1   | 2026-09-15 | 方向批准；不做 B1–B5 全量；先做三份 spec                                                         |
| R2   | 2026-09-15 | rev2 **部分通过**；P0 未收官；B1/B2 NOT YET                                                      |
| R3   | 2026-09-15 | rev2.1 阻断项补齐中；**仍不得编码**；待独立签署                                                  |
| R4   | 2026-09-16 | #1144 已合入主干；`evaluateCandidate` 规范侧落地；**未代签；P0 未 ACCEPTED；B1/B2 NOT APPROVED** |

**重要**：历史轮次的「专家反馈」≠ 签署。2026-09-16 操作人明示授权 `cursor-composer` 代理 `co-chat-security-reviewer` 与 `co-chat-runtime-reviewer`，对基线 `da79ee8774bb270f9a0c08f47e633326a8b5bfaf` 各写一份原文（R14）。P0 ACCEPTED **不等于** B1/B2 编码授权。

---

## R3 评分（2026-09-15）

| 项                       | 结果                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| 架构方向                 | PASS                                                                    |
| Completion Contract 设计 | PASS                                                                    |
| tenant / ACL 边界        | PASS                                                                    |
| B2 生命周期              | PASS                                                                    |
| B1 权限边界              | PASS                                                                    |
| JSON Schema + ≥20 向量   | **PASS** — schema 5/5 + 46 向量 + CI；干净 archive 75/75 @ `da79ee8774` |
| uiStatusProjection 规则  | **CONDITIONAL** → spec 已写，待 UI 方评审；**不受本次 P0 收官变更影响** |
| 独立安全/运行时评审      | **PASS @ `da79ee8774`（#1158 基线；R14 原文）**                         |
| P0 规范收官              | **ACCEPTED**（≠ B1/B2 编码授权）                                        |
| B1/B2 编码准入           | **NOT APPROVED**                                                        |

---

## 独立签署块（现行有效：A PASS / B PASS @ `da79ee8774`）

`90f12cb5`（#1153）双 PASS 已被 `#1154` 起的日历/payload 变更过期，仅作历史。现行有效签署见 R14 原文。

### A. 安全 reviewer

| 字段          | 值                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------- |
| reviewer 身份 | `co-chat-security-reviewer`                                                               |
| 签署 UTC      | 2026-09-16T06:54:21Z                                                                      |
| 基线 SHA      | `da79ee8774bb270f9a0c08f47e633326a8b5bfaf`                                                |
| 决策          | ☑ **PASS** ☐ CONDITIONAL ☐ FAIL                                                           |
| 附加条件      | （空）                                                                                    |
| 测试证据      | 干净 archive @ `da79ee8774`：schema 5/5；vitest **75/75**（17 + 58）；46 向量；无 runtime |
| 授权          | 操作人授权 `cursor-composer` 代理本身份写原文                                             |

**必审项**：BR-T1–T5、serverAttribution 前缀、fail-closed、跨 tenant、B1 不写 MCP SoT、B2 MCP SoT 冻结、PII/HMAC/原始身份。

### B. 运行时 reviewer

| 字段          | 值                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------- |
| reviewer 身份 | `co-chat-runtime-reviewer`                                                                |
| 签署 UTC      | 2026-09-16T06:54:20Z                                                                      |
| 基线 SHA      | `da79ee8774bb270f9a0c08f47e633326a8b5bfaf`                                                |
| 决策          | ☑ **PASS** ☐ CONDITIONAL ☐ FAIL                                                           |
| 附加条件      | （空）                                                                                    |
| 测试证据      | 干净 archive @ `da79ee8774`：schema 5/5；vitest **75/75**（17 + 58）；46 向量；无 runtime |
| 授权          | 操作人授权 `cursor-composer` 代理本身份写原文                                             |

**必审项**：`evaluateCandidate` 纯函数 + TC001–TC046、stale/cancel/replay、epoch 时间、uiStatusProjection 降级、force-off 目标合同。

### C. B1/B2 编码准入（单独发布）

| 字段     | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 批准人   | _pending_                                                     |
| 批准 UTC | _pending_                                                     |
| 前置条件 | A=PASS 且 B=PASS 且 P0 清单已收官；**另开准入，不得直接编码** |
| 决策     | **NOT APPROVED**                                              |

---

## P0 证据索引（rev2.1）

| 证据               | 路径                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| Schemas（5）       | `docs/design/schemas/*.schema.json`                                                |
| 测试向量（46）     | `docs/design/fixtures/completion-contract/test-vectors.json`                       |
| Schema CI          | `docs/design/scripts/completion-contract-p0-schema.test.ts`                        |
| evaluateCandidate  | `docs/design/scripts/evaluate-candidate.ts` + `evaluate-candidate-vectors.test.ts` |
| Schema 结构校验    | `./docs/design/scripts/validate-completion-contract-schemas.sh`                    |
| uiStatusProjection | `docs/design/ui-status-projection.md`                                              |
| B2 SoT 冻结        | `docs/design/bridge-mvp.md` §4.5                                                   |

---

## 变更记录

| 日期              | 变更                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-15        | R1/R2 记录                                                                                                                  |
| 2026-09-15 rev2.1 | R3 评分、独立签署模板、P0 证据索引；明确反馈≠签署                                                                           |
| 2026-09-16 R4     | #1144 merge `5d23e99db9`；祖先 12854b67e4 / efaf351690 = YES；主干复测 36/36；**签署块仍空，本记录不构成 PASS**             |
| 2026-09-16 R5     | 未知 evidence fail-closed + TC025 + 来源优先级表；#1145 分支修复，**尚未合入主干**；P0 仍 NOT YET                           |
| 2026-09-16 R6     | #1145 MERGED `540f868`；干净 archive 40/40；**签署块仍空，本记录不构成 PASS / ACCEPTED**                                    |
| 2026-09-16 R7     | 提名独立 reviewer 座位 + owner 证据索引；**决策仍空；P0 仍 NOT ACCEPTED；不代签**                                           |
| 2026-09-16 R8     | 安全/运行时独立评审均为 **CONDITIONAL**；附加条件未关闭；**P0 仍 NOT ACCEPTED；B1/B2 仍 NOT APPROVED**                      |
| 2026-09-16 R9     | owner 关闭 A/B 附加条件（规范+向量，未代签）；**P0 仍 NOT ACCEPTED；待独立重审 PASS**                                       |
| 2026-09-16 R10    | #1150 MERGED `c2852029`；干净 56/56；运行时 **PASS**；安全 **CONDITIONAL**（bindingScope / 嵌套 PII）；**不代签 ACCEPTED**  |
| 2026-09-16 R10+   | owner 关闭 A 剩余两项（TC036 + 递归 noPiiObject）；**关闭 ≠ A PASS / P0 ACCEPTED**                                          |
| 2026-09-16 R11    | #1151 MERGED `9c86a863`；主干 `01c8e326`；epoch 时间 + 敏感键别名（TC037–TC042）；**不代签 A/B 重审 / ACCEPTED**            |
| 2026-09-16 R12    | #1153 MERGED `90f12cb5`；严格日历 + 事件级 payload 边界（TC043–TC046）；**不承诺内容级 DLP；不代签**                        |
| 2026-09-16 R13    | 转载 #1153 双 PASS（A 03:47:48Z / B 03:46:10Z @ `90f12cb5`）；当前尖 `#1154` `0ed97921` **过期待重审**；**不代签 ACCEPTED** |
| 2026-09-16 R14    | 操作人授权代理双原文 PASS @ `da79ee8774`；P0 **ACCEPTED**；B1/B2 **NOT APPROVED**                                           |

---

## R4 主干合入回执（记录，非签署）

| 项           | 值                                                                                    |
| ------------ | ------------------------------------------------------------------------------------- |
| PR           | [#1144](https://github.com/gmood2008/openbot/pull/1144) MERGED 2026-09-15T19:02:52Z   |
| merge        | `5d23e99db93e8d375cbcc22445dfc9b4e3c94791`                                            |
| 祖先证明     | `12854b67e43587376eac1cd7414fbcb31cf98566` YES；`efaf351690` YES                      |
| 复测         | `validate-completion-contract-schemas.sh` 5/5；vitest 36/36（schema 11 + vectors 25） |
| 记录人       | cursor-composer（规范实施 owner）                                                     |
| 安全签署 A   | **仍 pending** — 记录人 ≠ 签署人，本文不代签                                          |
| 运行时签署 B | **仍 pending** — 同上                                                                 |
| P0           | **NOT ACCEPTED**                                                                      |
| B1/B2        | **NOT APPROVED**                                                                      |

---

## R6 #1145 主干合入回执（记录，非签署）

| 项           | 值                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| PR           | [#1145](https://github.com/gmood2008/openbot/pull/1145) MERGED 2026-09-15T19:56:26Z                          |
| merge        | `540f868505a988752a001a0f017bb913fddd50bf`                                                                   |
| 祖先         | `cbb8a285` YES；`aefda338` YES；`5d23e99`（#1144） YES                                                       |
| 主干文件     | `docs/design/scripts/evaluate-candidate.ts` 与 `evaluate-candidate-vectors.test.ts` 已存在；向量 TC001–TC025 |
| 干净复测     | `git archive origin/main` @ `540f868`：schema 5/5；vitest 40/40                                              |
| fail-closed  | 未知 evidence ref → `RC_EVIDENCE_NOT_FOUND`（已在主干）                                                      |
| 记录人       | cursor-composer（规范实施 owner）                                                                            |
| 安全签署 A   | **仍 pending** — 不代签                                                                                      |
| 运行时签署 B | **仍 pending** — 不代签                                                                                      |
| P0           | **NOT ACCEPTED**                                                                                             |
| B1/B2        | **NOT APPROVED**                                                                                             |

---

## R7 owner 证据索引（2026-09-16，不是签署）

**记录人**：`cursor-composer`（规范实施 owner）。  
**效力**：只供独立 reviewer 核对；**不得**视为 A/B PASS，**不得**把 P0 改为 ACCEPTED。

**主干复测（签署前）**

| 项                                                                | 值                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `origin/main`                                                     | `072973c3590a981b1ae87349d5e612413600f704`                                              |
| `072973c` 祖先                                                    | YES                                                                                     |
| schema                                                            | 5/5（`docs/design/scripts/validate-completion-contract-schemas.sh`）                    |
| vitest                                                            | **40/40**（schema 11 + evaluateCandidate 29；`git archive origin/main`）                |
| 指令中的 `scripts/delivery/validate-...`                          | **路径已退役**；真源是 `docs/design/scripts/`                                           |
| 无 config 的 `pnpm exec vitest run docs/design/scripts/*.test.ts` | 被根 `include` 过滤，**找不到文件**；须 `--config docs/design/scripts/vitest.config.ts` |

### 安全清单（owner 指向，待独立确认）

| #   | 项                                                          | owner 指向的证据                                                              | owner 不得裁定                       |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| 1   | BR-T1–T5                                                    | `event-mapping.md` §10.1                                                      | 待 A                                 |
| 2   | group_tenant 须服务端可信 tenantId                          | envelope `oneOf` 强制 `tenantId`；TC007                                       | 待 A                                 |
| 3   | 禁止 requesterId 推导 tenant                                | BR-T2；禁止调用 `resolveActivationTenantId` fallback                          | 待 A                                 |
| 4   | tenant 缺失 fail-closed                                     | BR-T3；`envelope-invalid-no-tenant.json` schema 拒                            | 待 A                                 |
| 5   | 跨 tenant 硬拒                                              | BR-T5；TC008 / TC022                                                          | 待 A                                 |
| 6   | serverAttribution 不可客户端伪造                            | 模式 `^(gateway:\|mcp-server:)`；`envelope-invalid-client-attribution.json`   | 待 A                                 |
| 7   | B1 不写 MCP Flow/TaskCard SoT                               | `bridge-mvp.md` §2 / §3.1                                                     | 待 A                                 |
| 8   | B2 MCP Primary + Gateway derived index                      | `bridge-mvp.md` §4.5                                                          | 待 A                                 |
| 9   | schema 拒缺 tenant / 伪造 attribution / 孤立 bindingVersion | P0 schema 测试 3 条 invalid fixtures                                          | 待 A                                 |
| 10  | PII / HMAC / 原始身份不进 bridge 或审计                     | envelope `additionalProperties: false`；**无 HMAC 字段、无显式 PII 拒绝名单** | **须 A 独立判断；owner 不代评 PASS** |

### 运行时清单（owner 指向，待独立确认）

| #   | 项                                              | owner 指向的证据                                                          | owner 不得裁定 |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------- | -------------- |
| 1   | evaluateCandidate 纯函数                        | `docs/design/scripts/evaluate-candidate.ts` 无 I/O                        | 待 B           |
| 2   | TC001–TC025 通过                                | 干净主干 29 evaluateCandidate tests                                       | 待 B           |
| 3   | 证据缺失 / 不存在 / 过期 fail-closed            | TC012 / TC025 / TC013                                                     | 待 B           |
| 4   | stale run、binding 过期、cancel race、force-off | TC005 / TC006 / TC003–TC004 / TC020                                       | 待 B           |
| 5   | duplicate replay 不重复 accepted                | TC001 / TC021 `flowUpdates=1`                                             | 待 B           |
| 6   | 来源优先级符合合同                              | `COMPLETION_SOURCE_RANK`；TC014                                           | 待 B           |
| 7   | Flow done ≠ task completed                      | TC024；`ui-status-projection.md` §3                                       | 待 B           |
| 8   | 读取失败不猜测完成                              | `projectUiAggregateStatus({readFailed})` → `unknown`                      | 待 B           |
| 9   | projection phase ≠ uiStatusProjection           | `event-mapping.md` §2；`ui-status-projection.md` 开篇                     | 待 B           |
| 10  | force-off 是目标合同                            | `completion-contract.md` §14；`event-mapping.md` `force.off` = 未统一实现 | 待 B           |

### 收官门槛（仍未满足）

| 条件                      | 状态                                        |
| ------------------------- | ------------------------------------------- |
| #1146 在 main             | YES（`072973c`）                            |
| evaluateCandidate 在 main | YES                                         |
| TC001–TC025 在 main       | YES                                         |
| schema 5/5 + 56 tests     | YES（干净 archive @ `c2852029`）            |
| 安全 reviewer = PASS      | **NO**（CONDITIONAL，2026-09-16T02:11:58Z） |
| 运行时 reviewer = PASS    | **YES**（2026-09-16T02:11:01Z）             |
| 无未关闭附加条件          | **NO**（A：bindingScope / 嵌套 PII）        |
| P0                        | **NOT ACCEPTED**                            |
| B1/B2                     | **NOT APPROVED**                            |

---

## R8 独立评审回执（CONDITIONAL，非收官）

记录人 `cursor-composer` 只转载评审结论，**不改写决策、不代签 PASS**。

### A `co-chat-security-reviewer` — 2026-09-16T00:05:16Z — CONDITIONAL

基线：`origin/main` `313deba3`。逐项：BR-T1–T5 文档化 **CONDITIONAL**；group_tenant 可信 tenant **CONDITIONAL**；禁止 requester 推导 **PASS**；缺 tenant fail-closed **PASS**；跨 tenant 硬拒 **CONDITIONAL**（`bindingTenantId` 缺省跳过）；attribution 不可伪造 **CONDITIONAL**（前缀可被假造 `gateway:`）；B1 不写 MCP SoT **PASS**；B2 MCP+派生索引 **PASS**；schema 三条否定 fixture **PASS**；PII/HMAC **CONDITIONAL**（`payload` 无约束）。

### B `co-chat-runtime-reviewer` — 2026-09-16T00:03:56Z — CONDITIONAL

干净 archive @ `313deba3`：schema 5/5，vitest 40/40。逐项：纯函数 **PASS**；TC001–TC025 **PASS**；证据 fail-closed **CONDITIONAL**（空 refs / 默认 TTL 无向量）；stale/cancel/force-off **PASS**；replay **PASS**；来源优先级 **CONDITIONAL**（缺 `RC_SOURCE_CONFLICT` / `recordedAt`）；Flow done ≠ 完成 **PASS**；读取失败不猜完成 **CONDITIONAL**（无 `readFailed` 向量）；术语分离 **PASS**；force-off 目标合同 **PASS**。另：TC007 绕过 `evaluateCandidate`。

**结论**：双评审均非 PASS → P0 保持 **NOT ACCEPTED**；B1/B2 保持 **NOT APPROVED**。关闭附加条件并再次得到明确 PASS 之前，禁止运行时桥接编码。

---

## R9 owner 关闭附加条件（2026-09-16，不是签署）

记录人 `cursor-composer`。下列只说明条件对应的规范/测试已补上；**A/B 决策仍是 CONDITIONAL，不得视为 PASS / ACCEPTED**。

| 来源 | 附加条件                                           | owner 落地                                                                                                 |
| ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A①   | BR-T2/T4/T5 否定测试；缺省 binding 不得跳过        | `resolveBridgeTenantId` 忽略 requesterId；TC028/TC030/TC035；`bindingTenantId` 缺省 → `RC_TENANT_MISMATCH` |
| A②   | tenantId/attribution 服务端签发（前缀 ≠ 不可伪造） | `event-mapping.md` §11；`attributionVerified !== true` fail-closed（TC034）                                |
| A③   | PII/HMAC 拒绝名单 + 收紧 payload                   | schema `propertyNames` 拒绝名单；`envelope-invalid-payload-pii.json`                                       |
| B①   | TC007 必须调用 `evaluateCandidate`                 | harness 已改为真调用                                                                                       |
| B②   | 空 refs / 默认 TTL 向量                            | TC026 / TC027 + `EVIDENCE_DEFAULT_TTL_MS`                                                                  |
| B③   | `recordedAt` 决胜 + `RC_SOURCE_CONFLICT`           | `pickWinningCandidate`；TC029 / TC031                                                                      |
| B④   | `readFailed` / `aclDenied` 向量                    | TC032 / TC033                                                                                              |

**P0 = NOT ACCEPTED。B1/B2 = NOT APPROVED。下一步：独立 reviewer 对关闭后的主干重审。**

---

## R10 #1150 主干合入 + 重审回执（转载，非代签）

| 项       | 值                                                                                        |
| -------- | ----------------------------------------------------------------------------------------- |
| PR       | [#1150](https://github.com/gmood2008/openbot/pull/1150) MERGED 2026-09-16T02:04:11Z       |
| merge    | `c285202921edad7ec8e1b9ff024bbdaaef9616b2`                                                |
| 祖先     | `07405856` YES；`6261037d` YES；`b447f180`（#1149） YES                                   |
| 干净复测 | `git archive origin/main`：schema 5/5；vitest **56/56**                                   |
| 运行时 B | **PASS** — `co-chat-runtime-reviewer` 2026-09-16T02:11:01Z                                |
| 安全 A   | **CONDITIONAL** — `co-chat-security-reviewer` 2026-09-16T02:11:58Z                        |
| A 剩余   | ① `bindingScope` 缺省跳过（须 fail-closed + TC036）。② payload 嵌套 `email`/`hmac` 未拒。 |
| 记录人   | cursor-composer（只转载；不改写 B=PASS 以外的决策）                                       |
| P0       | **NOT ACCEPTED**（须 A 也 PASS）                                                          |
| B1/B2    | **NOT APPROVED**                                                                          |

owner 在本 follow-up 关闭 A 剩余两项（`bindingScope` fail-closed、`$defs.noPiiObject` 递归），**关闭 ≠ 安全 PASS**，须 A 再次重审。

---

## R11 #1151 合入后剩余缺陷（owner 关闭，非签署）

| 项     | 值                                                                          |
| ------ | --------------------------------------------------------------------------- |
| 主干   | `01c8e326`（#1151 `9c86a863` 的子提交）                                     |
| B 既有 | **PASS**（2026-09-16T02:11:01Z）；时间改为 epoch 后须运行时复核             |
| A 既有 | **CONDITIONAL**；大小写/snake 别名 + 嵌套数组 fixture 已补，**关闭 ≠ PASS** |
| 向量   | TC037–TC042                                                                 |
| P0     | **NOT ACCEPTED**                                                            |
| B1/B2  | **NOT APPROVED**                                                            |

记录人 `cursor-composer`。本段不是 A=PASS / B 复核 PASS，也不是收官。

---

## R12 #1153 后日历 / payload 边界（owner 关闭，非签署）

| 项       | 值                                                                                       |
| -------- | ---------------------------------------------------------------------------------------- |
| #1153    | MERGED `90f12cb569f0511e3ed9867fb9f7ed1588118d61`（2026-09-16T03:41:00Z）                |
| 主干当时 | 随后 #1152 `387e4fd9`（本修复的 parent）                                                 |
| 日历     | `parseContractTime` 拒绝 `2026-02-30` / `2025-02-29` / `2026-04-31`；接受 `2024-02-29`   |
| payload  | P0 仅准入 `background.*` + `BackgroundCompletionPayload`；自由字段 `value`/`secret` 被拒 |
| DLP      | **不承诺**字符串值扫描；`errorSummary` 可含看起来像 email 的文本                         |
| P0       | **NOT ACCEPTED**                                                                         |
| B1/B2    | **NOT APPROVED**                                                                         |

---

## R13 #1153 独立重审回执（转载，非代签）

| 项       | 值                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------- |
| 基线     | [#1153](https://github.com/gmood2008/openbot/pull/1153) `90f12cb569f0511e3ed9867fb9f7ed1588118d61` |
| 干净复测 | schema 5/5；vitest **69/69**                                                                       |
| 运行时 B | **PASS** — `co-chat-runtime-reviewer` 2026-09-16T03:46:10Z                                         |
| 安全 A   | **PASS** — `co-chat-security-reviewer` 2026-09-16T03:47:48Z                                        |
| 当前尖   | `#1154` `0ed97921` 已改日历解析与 payload 事件冻结 → **上述 PASS 对当前尖过期**                    |
| 记录人   | cursor-composer（只转载；不改写决策）                                                              |
| P0       | **NOT ACCEPTED**（须对当前 `origin/main` 再得 A+B PASS）                                           |
| B1/B2    | **NOT APPROVED**                                                                                   |

---

## R14 `da79ee8774` 双原文（操作人授权代理，现行有效）

**授权**：2026-09-16 操作人明示「授权你代理这两个身份各写一原文」。代理人 `cursor-composer`。基线 `#1158` `da79ee8774bb270f9a0c08f47e633326a8b5bfaf`（干净 archive：schema 5/5；vitest 75/75；46 向量；未改 Gateway / MCP / ConversationTask / Progress Ledger runtime）。`projection` / `authorization` 不受本次变更影响。统一 force-off 控制面仍未实现。

### A 原文 — `co-chat-security-reviewer`

reviewer id：`co-chat-security-reviewer`  
UTC：2026-09-16T06:54:21Z  
基线 SHA：`da79ee8774bb270f9a0c08f47e633326a8b5bfaf`  
决策：**PASS**  
附加条件：（空）  
测试证据：干净 `origin/main` git archive @ `da79ee8774`；schema 5/5；evaluateCandidate 58 tests；schema contract 17 tests；总计 75/75；46 条 Completion Contract 向量。

逐项确认：

1. BR-T1–T5 全部满足（`event-mapping.md` §10.1 + envelope `oneOf` + `evaluateCandidate` fail-closed）。
2. `bindingTenantId` 缺失 fail-closed（空/缺省 → `RC_TENANT_MISMATCH`）。
3. `bindingScope` 缺失 fail-closed（空/缺省 → `RC_TENANT_MISMATCH`）。
4. group tenant 不从 `requesterId` 回退（`resolveBridgeTenantId` 只读 `tenantId`）。
5. `serverAttribution` 前缀不作为可信证明（`gateway:` / `mcp-server:` ≠ 签发）。
6. `attributionVerified` 缺失或 false 时拒绝（`group_tenant && !== true` → `RC_TENANT_MISMATCH`）。
7. 跨 tenant / personal-group scope 混用拒绝。
8. payload 仅允许冻结的 `background.completed` / `background.failed`。
9. payload 递归拒绝对象和数组内敏感键（`$defs.noPiiObject` / `noPiiValue`）。
10. 大小写、camelCase、snake_case、kebab-case 别名拒绝（`deniedPayloadName` + `isDeniedPayloadName`）。
11. B1 不写 MCP Flow/TaskCard SoT（规范侧 only）。
12. B2 Primary SoT 保持在 MCP，Gateway 只持可重建索引（`bridge-mvp.md` §4.5）。

本 PASS 覆盖 `da79ee8774`。不批准 B1/B2 运行时编码。

### B 原文 — `co-chat-runtime-reviewer`

reviewer id：`co-chat-runtime-reviewer`  
UTC：2026-09-16T06:54:20Z  
基线 SHA：`da79ee8774bb270f9a0c08f47e633326a8b5bfaf`  
决策：**PASS**  
附加条件：（空）  
测试证据：干净 `origin/main` git archive @ `da79ee8774`；schema 5/5；evaluateCandidate 58 tests；schema contract 17 tests；总计 75/75；46 条 Completion Contract 向量。

逐项确认：

1. `evaluateCandidate` 保持纯函数（无 I/O）。
2. TC001–TC046 全部经过真实入口（`evaluateCandidate` / `pickWinningCandidate` / `projectUiAggregateStatus`）。
3. evidence 缺失/不存在/过期 fail-closed（`RC_EVIDENCE_MISSING` / `NOT_FOUND` / `EXPIRED`）。
4. retry/stale/cancel/force-off/replay 正确（`RC_RUN_STALE` / `BINDING_STALE` / `RACE_LOST_TO_CANCEL` / `FORCE_OFF` / `DUPLICATE_REPLAY`）。
5. `recordedAt`、`validUntil`、`cancelEffectiveAt`、`clock` 均使用 epoch（`parseContractTime`）。
6. 非法日期和非法时间直接拒绝（`RC_CONTRACT_VERSION`）。
7. 相同 epoch 使用 `candidateId` 确定性裁定。
8. Flow done 不等于 task completed（`flow_step_done` → `RC_SOURCE_NOT_ALLOWED`；UI `step_done`）。
9. `readFailed` / ACL denied 不猜测完成（`unknown` / `blocked`，`showTaskCompleted: false`）。
10. force-off 仍只是目标合同，未误称已实现（`completion-contract.md` §14）。

本 PASS 覆盖 `da79ee8774`。不批准 B1/B2 运行时编码。

### 收官状态

| 项                           | 值               |
| ---------------------------- | ---------------- |
| P0                           | **ACCEPTED**     |
| Completion Contract          | **ACCEPTED**     |
| Event Mapping                | **ACCEPTED**     |
| Bridge MVP specification     | **ACCEPTED**     |
| B1/B2 runtime coding         | **NOT APPROVED** |
| P0 ACCEPTED ≠ B1/B2 编码授权 | **保留**         |
| projection / authorization   | **不受本次影响** |
| 统一 force-off 控制面        | **仍未实现**     |
