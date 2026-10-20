# B2 设计：运行时影子接线（web_read shadow wiring）— LANDED

> **Checkpoint B2 · runtime wiring LANDED · ownership LANDED。** B1 `evaluateWebReadShadow` 已接到既有 choke-point（默认 OFF；未部署）。
> **Registry commit `3071ffea0031661d6d61ab8af2162e58e6287fb4` 已落地；sole lander `constitutional-governance-web-read-shadow:grok-bot`；五条 exact-file sharedPaths 已落地；无 competing lander。本整改不 push / 不开 PR / 不翻转旗标 / 不部署。**
> Baseline：`baseline-manifest.yaml`→`mainSha`=`origin/main` tip @ assessedAt。
> Agent: grok-bot · Task:`constitutional-governance-web-read-shadow`· Seal pass:`phase-b-b2-design-seal-ownership-2026-09-24` · Remediation:`phase-b-b2-drop-global-safe-debug-2026-09-24`

---

## 0. 非目标（本设计回合）

- 不写 B2 实现代码；不新建 task / architecture package。
- 不翻转 `ORCHESTRATION_LIVE_INVOKE`；不打开 Fabric；不调用 `web_search` / `web_fetch`。
- 不把 `getLastOrchShadowObservation()` 扩成生产多租户全局仓。
- 不把 `sessionKey` 涂成 Path 或授权边界（Phase A ADR-1）。
- **不在本回合改 B1 evaluator 源码**；§1 仅**文档记录**将来编码时的最小类型调整。
- **不冒充 `Agent: kiro-loom`**；本整改**不**再编辑 `.loom/registry.yaml`（registry 已由 kiro-loom 落地，见 §10）。

---

## 1. 冻结身份输入（nullable tenant / binding contract）

### 1.1 Profile × tenant 合同（冻结）

| Profile | `WebReadShadowProfile` | `SECURITY.md` / `SecurityProfileKind` | `tenantId` 合同                                                                                              |
| ------- | ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **A**   | `"A"`                  | `personal_local`                      | **`tenantId = null`**；**禁止伪造**企业 / 合成 tenant；Personal Local 不得被强行套用 Managed 身份语义        |
| **B**   | `"B"`                  | `managed_enterprise`                  | **`tenantId` MUST 为服务端非空字符串**（trim 后 length > 0）；缺值 → fail-closed（§2），**不**调用 predictor |

硬约束：

1. Profile **仅**来自服务端 `resolveSecurityProfile(cfg/env)`（`OPENBOT_SECURITY_PROFILE` / `gateway.security.profile` / 派生）；**禁止**客户端 query/body/header 选择 Profile。
2. **Prediction 输出回显可空 tenant binding as-is**（输入是什么就 echo 什么；含 `null`）。
3. **tenant echo 仍不是鉴权证明**（binding echo only；不得当 Path / ACL / auth boundary）。
4. `sessionKey` / `conversationId` **不是** Path，也 **不是** auth boundary。
5. `requesterId` / `messageId` / `caseId` 同样不得写入 safe sink（§4）；`caseId` 运行时可用稳定 `messageId` 或缺省请求内合成 id，**禁止**金标 corpus id 泄漏进生产路径。

### 1.2 权威身份表（B2 接线必须使用）

| 字段                             | 权威源                                                                                                             | 非权威 / 禁止                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `tenantId`                       | Profile A → 强制 `null`（adapter 内）；Profile B → **dispatch 从** `sourceContext.tenantId` **传入**（服务端非空） | 客户端自报 tenant；伪造 A 的 synthetic tenant；predictor 回显当 auth   |
| `messageId`                      | `MessageSid*`（由 dispatch 传入 adapter）                                                                          | 客户端可伪造 id 作授权                                                 |
| `utterance`                      | **dispatch-from-config** 内 first-trim-non-empty Body\*（§5）                                                      | URL / 工具参数原文当用户话；**禁止**把 raw ctx 传入 gateway-hook       |
| `profile`                        | §1.1 服务端判定 → `"A"` / `"B"`（**仅** gateway-hook 内 resolve）                                                  | 客户端 `profile=A\|B`；dispatch **不**解析 Profile                     |
| `cfg`                            | 服务端 OpenBot 配置对象（由 dispatch 传入）                                                                        | 客户端覆盖 security profile                                            |
| `sessionKey`                     | 会话路由                                                                                                           | **不是** Path；**不是** auth boundary；**禁止**传入 adapter            |
| `requesterId` / `conversationId` | 既有 orch observe 仍可用（legacy）                                                                                 | **禁止**传入 `observeWebReadShadowFromChat` / `WebReadShadowChatInput` |

`gatewayClient` 由 `buildKnowledgeReplyGatewayClient(...)` 组装；`sourceContext` **不得**被请求体里的「自选 tenant / profile」覆盖。

### 1.3 最小 B1 evaluator 类型调整（**文档 only；本回合不编码**）

B1 现状（`web-read-shadow-eval.ts` @ tip）：`WebReadShadowEvalInput.tenantId: string` 与 `WebReadShadowPrediction.tenantId: string`（必填非空）。与 §1.1 Profile A `null` 合同冲突。

将来 B2 编码获批时，**最小**类型调整（仍属 B1 文件触碰，优先零行为回归）：

```ts
// design-only record — DO NOT implement this turn
export type WebReadShadowEvalInput = {
  caseId: string;
  profile: WebReadShadowProfile;
  /** Profile A: null. Profile B: non-empty server-side. Echoed as-is; NOT auth proof. */
  tenantId: string | null;
  utterance: string;
  availableSurfaces?: readonly string[];
};

export type WebReadShadowPrediction = {
  // ...
  tenantId: string | null; // echo binding as-is (nullable)
  // ...
};
```

配套（仍文档 only）：

- 单测 / fixture：Profile A 用例改用 `tenantId: null`；禁止再为 A 伪造 `tenant-A-*`。
- Profile B 缺 tenant：**不得**进入 `evaluateWebReadShadow`（由 runtime adapter fail-closed；§2）；evaluator 本身可不新增 B-missing-tenant 分支。
- 行为不变量：echo 精确、decision 不依赖 tenant 字符串内容。

---

## 2. 运行时 adapter（SEAL）

### 2.1 冻结 Adapter API（exact）

```ts
// design-only — frozen shape; DO NOT implement this turn
export type WebReadShadowChatInput = {
  cfg: /* OpenBot server config */;
  tenantId: string | null; // from dispatch sourceContext; Profile A forced null inside adapter
  messageId: string | null;
  utterance: string; // already selected by dispatch-from-config
};

export function observeWebReadShadowFromChat(
  input: WebReadShadowChatInput,
  sink?: (obs: SafeWebReadShadowObservation) => void,
): void;
```

**禁止**把下列对象 / 字段传入 gateway-hook adapter：

- 完整 `ctx` / reply context
- `sessionKey`
- `requesterId`
- `conversationId`

（上述身份字段可继续用于同文件的 legacy `observeOrchestrationConsider`；**不得**成为 web_read adapter 入参。）

| 项         | 冻结                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter 名 | **`observeWebReadShadowFromChat`**                                                                                                                       |
| 安放       | `src/task-orchestration/gateway-hook.ts`，与既有 **`observeOrchestrationConsider` 同文件并列**                                                           |
| 调用方     | `src/auto-reply/reply/dispatch-from-config.ts`：在现有 `observeOrchestrationConsider(...)` **之后**（或同 try 邻域）调用；仍同步、仍永不抛进 `chat.send` |
| 关系       | **不**替换 / **不**内嵌进 `observeOrchestrationConsider` 的 legacy `recall_memory` 探针；二者共存、权威不对等（§3）                                      |

### 2.2 责任边界（SEAL）

**`dispatch-from-config.ts`（唯一文本/租户采集点）**：

1. 从既有服务端 `sourceContext` 取 `tenantId`（与当前 `observeOrchestrationConsider` 同源）。
2. **first-trim-non-empty** utterance 选择：`BodyForCommands → CommandBody → RawBody → Body → ""`（§5；**本 seal 把选择搬到 dispatch**，纠正先前「仅 gateway 内 `selectShadowUtterance`」设计）。
3. 仅向 adapter 传入 **`cfg`, `tenantId`, `messageId`, `utterance`**（+ 可选 request-scoped sink）。
4. **不**在 dispatch 内 `resolveSecurityProfile`、**不**调用 predictor、**不**写 web_read sink。

**`gateway-hook.ts`（`observeWebReadShadowFromChat`）**：

1. 读父/子旗（`ORCH_SHADOW` ∧ `WEB_READ_SHADOW`）。
2. `resolveSecurityProfile(cfg, env)` → map Profile A/B。
3. 校验 Profile B tenant（缺值 → fail-closed observation；**不**调 predictor）。
4. Profile A：强制 `tenantId = null`（忽略传入的非 null，禁止伪造语义残留）。
5. 调用 `evaluateWebReadShadow`（恰好一次，当且仅当组合门控通过且非 B-missing-tenant）。
6. 映射为 `SafeWebReadShadowObservation`。
7. 调用 injected sink **或** 内部 safe debug sink（§4）。
8. **吞掉**一切 shadow 错误（predictor / sink / 映射）；永不失败 chat。

### 2.3 Fail-closed reason codes（SEAL — ONLY）

Profile B 缺 tenant（及其他本切片 fail-closed 观察）**仅**允许使用既有：

- `ORCH_REASON.FAIL_CLOSED`（`"orch_fail_closed"`）
- `ORCH_REASON.HUMAN_GATE`（`"orch_human_gate"`）

**禁止**新增 reason code；**禁止**自造 `"…fail_closed_missing_tenant…"` 字符串。缺 tenant 场景典型组合：`[ORCH_REASON.FAIL_CLOSED, ORCH_REASON.HUMAN_GATE]`（或至少包含 `FAIL_CLOSED`；`HUMAN_GATE` 用于「需人闸 / 不可自动推进」语义对齐既有 orch 约定）。

### 2.4 伪代码（冻结）

```text
// --- dispatch-from-config.ts ---
tenantId = sourceContext.tenantId   // server-derived; may be null/undefined
utterance = firstTrimNonEmpty(
  BodyForCommands, CommandBody, RawBody, Body
)   // → "" if all empty
messageId = MessageSid* or null

observeWebReadShadowFromChat(
  { cfg, tenantId, messageId, utterance },
  requestScopedSink?   // tests / request scope only
)

// --- gateway-hook.ts ---
function observeWebReadShadowFromChat(input, sink?):
  try:
    orchOn = readOrchestrationFlags().shadowEnabled
      // OPENBOT_CONVERSATION_TASK_ORCH_SHADOW
    webReadOn = isWebReadShadowEnabled()
      // OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW (default OFF)

    if not (orchOn && webReadOn):
      return   // predictor calls = 0; no web_read sink write

    profile = mapSecurityProfileToWebRead(
      resolveSecurityProfile(input.cfg, process.env)   // server only
    )   // → "A" | "B"

    tenantId =
      if profile == "A": null
      else: input.tenantId

    effectiveSink = sink ?? internalSafeDebugSink
      // internalSafeDebugSink(obs: SafeWebReadShadowObservation) only
      // debuglog("openbot:web-read-shadow") with whitelist fields
      // NEVER full prediction; NEVER text/url/ids

    if profile == "B" and isMissingTenant(tenantId):
      effectiveSink({
        ...safeFailClosedFields,
        profileLabel: "B",
        kind: "reject",
        reasonCodes: [ORCH_REASON.FAIL_CLOSED, ORCH_REASON.HUMAN_GATE],
        predictorCalled: false,
        // NO ids/text/urls
      })
      return   // predictor calls = 0

    prediction = evaluateWebReadShadow({
      caseId: stableCaseIdFrom(input.messageId) or requestScopedSyntheticId,
      profile,
      tenantId,          // string | null — echoed as-is; NOT auth proof
      utterance: input.utterance,
    })   // exactly once

    effectiveSink(toSafeWebReadShadowObservation(prediction, profile))
    // full `prediction` MUST NOT be passed to debuglog / debug sink
  catch:
    // swallow — never fail chat

isMissingTenant(t) := t == null || trim(t) === ""
```

---

## 3. 独立默认 OFF 子旗 + 组合门控

### 3.1 冻结名称

| 项                            | 冻结值                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Canonical env 名**          | **`OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW`**                                                                                 |
| 文档短别名（仅散文）          | `WEB_READ_SHADOW`（**不是**第二 env 名）                                                                                        |
| 默认                          | **OFF**（unset / `0` / `false` / `no` / `off` → false；仅 `1`/`true`/`yes`/`on` → true；与 `feature.ts` `envEnabled` 风格一致） |
| 配置键（合同名；不接 schema） | `conversationTask.orchestration.webReadShadowEnabled`（建议；与 `ORCHESTRATION_FLAG_NAMES` 并列）                               |
| 读取助手（设计名）            | `isWebReadShadowEnabled(env?)`（已落在 `feature.ts`；**LANDED**）                                                               |

父旗（既有，不改语义）：

- Env：`OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`
- 助手：`readOrchestrationFlags().shadowEnabled` / 测试用 `shadowOrchestrationFlags()`
- 文档短别名：`ORCH_SHADOW`

### 3.2 组合门控（冻结）

```text
web_read predictor path runs  iff  ORCH_SHADOW && WEB_READ_SHADOW
```

| ORCH_SHADOW | WEB_READ_SHADOW | legacy Gate C `recall_memory` probe | `evaluateWebReadShadow` 调用 |
| ----------- | --------------- | ----------------------------------- | ---------------------------- |
| OFF         | OFF             | 0                                   | 0                            |
| OFF         | ON              | 0                                   | **0**（子旗 alone 不够）     |
| ON          | OFF             | **仍运行**（既有 Gate C）           | **0**                        |
| ON          | ON              | 仍运行（探针）                      | **恰好 1**                   |

**显式冻结**：关闭 `WEB_READ_SHADOW` **不影响** legacy Gate C `recall_memory` 探针。

Kill switch：关子旗停 web_read；关父旗停 legacy + web_read。Rollback **禁止**翻转 `ORCHESTRATION_LIVE_INVOKE`。

---

## 4. Safe Observation Sink（SEAL）

### 4.1 TypeScript 形状（白名单字段 only）

设计声明位置（编码时）：`src/task-orchestration/gateway-hook.ts`（与 adapter 同文件）或紧邻拆分文件（优先同文件直至评审要求拆分）。**本回合不建文件。**

```ts
// design-only — whitelist fields; NO ids / text / urls
export type SafeWebReadShadowObservation = {
  schemaVersion: 1;
  profileLabel: "A" | "B";
  decisionClass: "web_read" | "not_web_read" | "clarify";
  kind: "selected" | "clarify" | "noop" | "reject";
  reasonCodes: string[]; // OrchReasonCode[] — fail-closed uses ONLY FAIL_CLOSED / HUMAN_GATE
  policyGap: boolean;
  evidenceGap: boolean;
  humanGate: "yes" | "no" | "unknown";
  predictorCalled: boolean;
  latencyBucketMs: 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100;
  invoke: false;
  enqueue: false;
  wroteLedger: false;
  invokedTool: false;
  tenantPresent: boolean; // flag only — NOT the id
  utteranceEmpty: boolean; // flag only — NOT the text
};

export type WebReadShadowObservationSink = (obs: SafeWebReadShadowObservation) => void;
```

### 4.2 Sink 默认行为（SEAL）

| 项              | 冻结                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **有注入 sink** | **test / request-scoped only**；caller（dispatch 或测试夹具）注入；不得挂模块级全局 last\*                                  |
| **无注入 sink** | 使用 **内部 safe debug sink**（`debuglog("openbot:web-read-shadow")`）；**不是**静默 no-op 到「丢弃观测」——仍发出白名单字段 |
| debug sink 参数 | **MUST** 为 `SafeWebReadShadowObservation` only                                                                             |
| 完整 prediction | **MUST NOT** 进入 debuglog / debug sink / 任何日志通道                                                                      |
| sink throw      | **吞掉**；**永不**失败 chat                                                                                                 |
| predictor throw | **吞掉**；**永不**失败 chat                                                                                                 |
| 禁止扩仓        | **禁止**扩展 `getLastOrchShadowObservation()` / 模块级 `lastShadowObservation` 为生产多租户仓                               |

### 4.3 硬禁止（sink payload / logs）

**绝对不得出现**：raw utterance / 任意用户正文、URL、`tenantId`、`requesterId`、`conversationId`、`sessionKey`、`messageId`、`caseId`、其他身份或会话 id、完整 `WebReadShadowPrediction` 对象。

允许：reason codes（含仅 `FAIL_CLOSED` / `HUMAN_GATE` 用于缺 tenant）、decision class、kind、profile label A/B、policyGap / evidenceGap、桶化 timings、`predictorCalled`、`tenantPresent` / `utteranceEmpty`、恒 `false` 的 invoke/enqueue/ledger/tool 旗。

---

## 5. 冻结文本选择（搬到 dispatch）

### 5.1 统一顺序（SEAL）

```text
first trim-non-empty of:
  BodyForCommands → CommandBody → RawBody → Body → ""
```

与 CTR activation / `observeConversationTaskReplyCompleted` 的 `.find(trim !== "")` 策略对齐；**纠正** CTR shadow 仅用 `BodyForCommands ?? Body` 的窄路径——B2 **不得**因空 `BodyForCommands` 掩盖非空 `RawBody`/`Body`。

### 5.2 安放（SEAL — 相对先前设计的变更）

| 项             | 先前设计（已废止）                                | **本 SEAL**                                                      |
| -------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| 选择位置       | `gateway-hook.ts` 内 `selectShadowUtterance(ctx)` | **`dispatch-from-config.ts`**（调用 adapter 之前）               |
| 传入 adapter   | 完整 `ctx`                                        | **仅**已选 `utterance: string`                                   |
| 助手名（可选） | `selectShadowUtterance`                           | 可保留为 dispatch 私有 helper，或内联 `.find`；**不**导出到 hook |

```ts
// design-only — lives in dispatch-from-config.ts (NOT gateway-hook)
function selectShadowUtterance(ctx: {
  BodyForCommands?: unknown;
  CommandBody?: unknown;
  RawBody?: unknown;
  Body?: unknown;
}): string {
  for (const candidate of [ctx.BodyForCommands, ctx.CommandBody, ctx.RawBody, ctx.Body]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return "";
}
```

---

## 6. 已核实的真实调用链（`origin/main` tip）

### 6.1 链

```text
src/auto-reply/reply/dispatch-from-config.ts
  → observeOrchestrationConsider({ tenantId, requesterId, conversationId, messageId })
       // src/task-orchestration/gateway-hook.ts  (legacy)
  → considerDispatchFromEnv({ intent: "recall_memory", ... })
       // Gate C shadow probe — NOT web_read authority

  // B2 设计新增（编码获批后）：
  → utterance = firstTrimNonEmpty(BodyForCommands→CommandBody→RawBody→Body)
  → observeWebReadShadowFromChat({ cfg, tenantId, messageId, utterance }, sink?)
       // 同文件 gateway-hook.ts；组合门控 ORCH_SHADOW && WEB_READ_SHADOW
       // 禁止传入 ctx / sessionKey / requesterId / conversationId
```

同文件内、Orchestration 调用之上，已有并行 CTR 观察（对照身份/文本源，**不是** B2 web_read 决策权威）：

- `observeInboundTurnShadow({ …, text: ctx.BodyForCommands ?? ctx.Body ?? "" })` ← 窄路径；B2 **不**复制此窄路径
- `observeInboundTurnActivation({ …, text: first trim-non-empty Body\* })` ← B2 utterance 选择与此对齐，但选择发生在 **dispatch**

### 6.2 Flag / 助手名（准确符号）

| 符号                                                 | 位置                                             | 语义                                                          |
| ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`              | `feature.ts` → `ORCHESTRATION_ENV.shadowEnabled` | 主机 env；默认 OFF；legacy Gate C + 组合门控左操作数          |
| `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW`          | **B2 冻结新增**（`feature.ts` 旁）               | 子旗；默认 OFF；组合门控右操作数                              |
| `readOrchestrationFlags()`                           | `feature.ts`                                     | 读四旗；不含 web_read 子旗（子旗独立读取）                    |
| `ORCH_REASON.FAIL_CLOSED` / `ORCH_REASON.HUMAN_GATE` | `reason-codes.ts`                                | **唯一**允许的 fail-closed reason codes                       |
| `ORCHESTRATION_LIVE_INVOKE`                          | `types.ts`                                       | 编译期常量 `false`；不得为回滚而翻转                          |
| `getLastOrchShadowObservation()`                     | `dispatch.ts`                                    | **测试 helper**；**禁止**扩成生产多租户 sink                  |
| `debuglog("openbot:web-read-shadow")`                | **B2 内部 safe debug sink**                      | 仅 `SafeWebReadShadowObservation`；无 prediction/text/url/ids |
| `evaluateWebReadShadow`                              | `web-read-shadow-eval.ts`                        | B1 纯函数 predictor（已合入 main via PR #14）                 |
| `WebReadShadowChatInput`                             | **B2 SEAL**（§2.1）                              | `{ cfg, tenantId, messageId, utterance }`                     |
| `observeWebReadShadowFromChat`                       | **B2 adapter**（§2）                             | runtime 接线入口                                              |
| `SafeWebReadShadowObservation`                       | **B2 SEAL**（§4）                                | sink / debuglog 唯一载荷类型                                  |
| `resolveSecurityProfile`                             | `gateway/security-profile.ts`                    | 服务端 Profile 权威（**仅** gateway-hook 调用）               |

---

## 7. 选定接线层 + 权威关系

### 7.1 选定层

**权威 web_read 入口：`observeWebReadShadowFromChat`（`gateway-hook.ts`）**，由 `dispatch-from-config.ts` 单点调用并完成 utterance / tenantId 采集。

**并行保留：`observeOrchestrationConsider`** → legacy Gate C `recall_memory` 探针（不受 `WEB_READ_SHADOW` OFF 影响）。

**不选**：在 `considerDispatch` / `routeStep` 内部偷偷替换 `recall_memory` 语义；不在 `attempt.ts` / Fabric / 新 gateway method 另开第五入口。

### 7.2 禁止双权威

| 路径                                                                                      | 角色                                 | 可否当作 web_read 决策真值 |
| ----------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------- |
| `considerDispatchFromEnv({ intent: "recall_memory" })` + `getLastOrchShadowObservation()` | **Legacy Gate C orch-plane probe**   | **否**                     |
| `evaluateWebReadShadow` → safe sink                                                       | **B2 web_read 切片唯一权威影子决策** | **是**                     |

---

## 8. 零副作用不变量

| 不变量                                               | 要求                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| 观察门控                                             | **仅** `ORCH_SHADOW && WEB_READ_SHADOW` 时跑 predictor                        |
| 子旗 OFF                                             | `evaluateWebReadShadow` **调用次数 = 0**；legacy probe **不受影响**           |
| 父旗 OFF                                             | predictor = 0 **且** legacy probe = 0                                         |
| `invoke` / `enqueue` / `wroteLedger` / `invokedTool` | 恒 `false`                                                                    |
| 工具                                                 | 无 `web_search` / `web_fetch`                                                 |
| 用户可见输出                                         | 与影子路径 OFF 零差异                                                         |
| Adapter 入参面                                       | **仅** `WebReadShadowChatInput`；无 ctx/sessionKey/requesterId/conversationId |
| Fail-closed codes                                    | **仅** `ORCH_REASON.FAIL_CLOSED` + `ORCH_REASON.HUMAN_GATE`                   |
| Debug sink                                           | **仅** `SafeWebReadShadowObservation`；无 full prediction / text / url / ids  |

---

## 9. 错误、性能、Kill switch

| 主题              | 合同                                                              |
| ----------------- | ----------------------------------------------------------------- |
| predictor throw   | 吞掉；chat 继续                                                   |
| sink throw        | 吞掉；chat 继续                                                   |
| shadow 失败       | **不得**重试；**不得** fallback 工具                              |
| 同步预算          | p95 附加延迟目标 ≤ 10ms；超预算记成本反证，不靠异步补跑           |
| Kill switch（细） | `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW=0/unset`               |
| Kill switch（主） | `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW=0/unset`                   |
| Rollback          | **只**关影子接线 / 旗标；**禁止**翻转 `ORCHESTRATION_LIVE_INVOKE` |

---

## 10. 路径准入（ownership admission）— LANDED

> **Registry 已落地（本整改不再编辑 `.loom/registry.yaml`）。** Registry commit：`3071ffea0031661d6d61ab8af2162e58e6287fb4`。
> **Ownership LANDED：** sole lander `constitutional-governance-web-read-shadow:grok-bot`；下列五条 exact-file `sharedPaths` 已落地；**无** competing lander。

### 10.1 落地前所有者快照（historical；核实自当时 `origin/main` `.loom/registry.yaml`）

| 精确路径                                            | 当前声明                                                                                                           | 冲突摘要                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/task-orchestration/gateway-hook.ts`            | CTR `conversation-task-runtime:kiro-conversation-task-runtime` via `src/task-orchestration/**`                     | CTR exclusive glob                                              |
| `src/task-orchestration/gateway-hook.test.ts`       | 同上 CTR                                                                                                           | CTR exclusive glob                                              |
| `src/task-orchestration/feature.ts`                 | 同上 CTR                                                                                                           | CTR exclusive glob                                              |
| `src/auto-reply/reply/dispatch-from-config.ts`      | CTA `conversation-task-activate:cursor-grok` paths；CTR paths 亦列此文件；top-level `sharedPaths` lander = **CTR** | 需新增 Phase B exact sharedPath（或经 CTR release 后改 lander） |
| `src/auto-reply/reply/dispatch-from-config.test.ts` | 无专属 task path；仅被宽 `pi-sdk-family-migration-v3:cursor` `src/**` 覆盖                                         | 需 exact sharedPath                                             |

既有 B1（**不变**，勿改）：

- `sharedPaths` glob `src/task-orchestration/web-read-shadow-eval.ts` / `.test.ts` → lander = `constitutional-governance-web-read-shadow:grok-bot`
- Task `constitutional-governance-web-read-shadow:grok-bot` paths：specs + 上述两 eval 文件

宽覆盖噪音：`pi-sdk-family-migration-v3:cursor` `src/**` — exact-file sharedPath 按既有惯例化解，**不** transfer 该 glob。

### 10.2 exact sharedPaths（historical proposal, already applied）

`landerTask`（已应用）：`constitutional-governance-web-read-shadow:grok-bot`。下列 YAML 为 **historical proposal, already applied**（registry commit `3071ffea0031661d6d61ab8af2162e58e6287fb4`）。

```yaml
# historical proposal, already applied — registryCommitSha 3071ffea0031661d6d61ab8af2162e58e6287fb4
# Appended under top-level sharedPaths: (exact files only; no globs)
- glob: src/task-orchestration/gateway-hook.ts
  landerTask: constitutional-governance-web-read-shadow:grok-bot
  reason: >-
    Phase B B2 runtime shadow wiring adapter observeWebReadShadowFromChat.
    Exact-file land. Resolves CTR src/task-orchestration/** and pi-sdk src/** overlap.
    Does not transfer those globs. SharedPath LANDED.
- glob: src/task-orchestration/gateway-hook.test.ts
  landerTask: constitutional-governance-web-read-shadow:grok-bot
  reason: >-
    Companion tests for B2 gateway-hook web_read shadow adapter. Exact-file land.
- glob: src/task-orchestration/feature.ts
  landerTask: constitutional-governance-web-read-shadow:grok-bot
  reason: >-
    Register OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW + isWebReadShadowEnabled. Exact-file land.
- glob: src/auto-reply/reply/dispatch-from-config.ts
  landerTask: constitutional-governance-web-read-shadow:grok-bot
  reason: >-
    B2: select utterance + pass WebReadShadowChatInput into observeWebReadShadowFromChat.
    Exact-file land. Coordinates with existing CTR lander sharedPath for this file;
    operator must reconcile single landerTask (replace or dual-authorize) before coding.
- glob: src/auto-reply/reply/dispatch-from-config.test.ts
  landerTask: constitutional-governance-web-read-shadow:grok-bot
  reason: >-
    Companion dispatch wiring tests for B2 web_read shadow. Exact-file land.
```

**协调结果（LANDED）**：五条 exact-file sharedPaths 的 sole lander 均为 `constitutional-governance-web-read-shadow:grok-bot`；与 CTR / pi-sdk 宽 glob 的冲突已按 exact-file 惯例化解；**无** competing lander。

### 10.3 状态 — LANDED

| 项                       | 值                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Registry 本整改是否编辑  | **否**（已落地；本整改不改 `.loom/registry.yaml`）                                        |
| Ownership / registry SHA | **LANDED** `3071ffea0031661d6d61ab8af2162e58e6287fb4`                                     |
| Sole lander              | `constitutional-governance-web-read-shadow:grok-bot`                                      |
| Five exact sharedPaths   | gateway-hook.ts / .test.ts / feature.ts / dispatch-from-config.ts / .test.ts — **LANDED** |
| Competing lander         | **无**                                                                                    |
| B1 registry land（历史） | `bfb0324397d02e40a810b63cbd6494bcce52c67c`（eval exact paths；保持）                      |
| 编码前 blocker           | **已解除**（五条 exact sharedPath 已合入）                                                |

---

## 11. B2 测试矩阵（SEAL）

| #   | 用例                                          | 期望                                                                            |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | ORCH OFF / child OFF                          | predictor **0**；legacy probe **0**                                             |
| 2   | **ORCH ON / child OFF**                       | legacy probe **继续**；predictor **0**                                          |
| 3   | **ORCH ON / child ON**                        | predictor **恰好 1**；legacy probe 仍可跑（非 web_read 权威）                   |
| 4   | **ORCH OFF / child ON**                       | predictor **0**（组合门控）                                                     |
| 5   | **Profile A + tenant null**                   | 正常观察；echo `tenantId: null`；**不**伪造 tenant                              |
| 6   | **Profile B + tenant null/empty**             | safe reject；reasonCodes **仅**含 `FAIL_CLOSED` / `HUMAN_GATE`；predictor **0** |
| 7   | Profile 不可被客户端覆盖                      | 注入伪造 client profile/tenant → 仍用服务端判定                                 |
| 8   | **empty BodyForCommands 不掩盖 RawBody/Body** | **dispatch** 选择落到首个 trim-non-empty 后续字段                               |
| 9   | adapter 入参面                                | 无 ctx/sessionKey/requesterId/conversationId 传入 hook                          |
| 10  | predictor throw                               | chat 继续；无工具；无 ledger；无输出差分                                        |
| 11  | **sink throw 不影响 chat**                    | 吞掉；用户可见零差分                                                            |
| 12  | **无注入 sink → debuglog only（无全局仓）**   | 不抛；predictor 恰 1；无 tool/ledger；**无** module-level last-observation API  |
| 13  | **sink / debuglog 字段白名单**                | 硬禁止 ids/text/urls/prediction                                                 |
| 14  | 无工具 / 无 ledger / 无输出 diff              | `invokedTool=false`，`wroteLedger=false`                                        |
| 15  | 交错 A/B 请求（含无注入 sink）                | **无共享可变状态**；**无** readable module-level last-observation API           |
| 16  | p95                                           | 附加延迟目标 ≤10ms                                                              |
| 17  | kill switch（子/父旗）                        | 关子旗停 predictor；关父旗回基线                                                |
| 18  | legacy `recall_memory` shadow                 | 既有 Gate C 无意外回归                                                          |
| 19  | 无新增 reason code                            | fail-closed 断言集合 ⊆ `{FAIL_CLOSED, HUMAN_GATE}`                              |

---

## 12. 回滚计划

1. 关闭 `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW`（细粒度；保留 Gate C 探针）。
2. 关闭 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`（主 kill switch）。
3. 若已合并接线：revert / 卸掉 `observeWebReadShadowFromChat` 调用与 dispatch 新增传参。
4. **禁止**翻转 `ORCHESTRATION_LIVE_INVOKE`、禁止改 Fabric 默认、禁止用「打开 dispatch」当回滚。
5. 回滚后：用户可见输出、工具集、ledger、ConversationTask activation 与接线前基线一致。

详见既有 `rollback.md`。

---

## 13. 编码准入状态 — LANDED（等待 Codex 最终验收）

- §10 exact sharedPaths：**LANDED**（registry `3071ffea0031661d6d61ab8af2162e58e6287fb4`；sole lander `constitutional-governance-web-read-shadow:grok-bot`）。
- B2 runtime wiring（adapter / child flag / dispatch call site / nullable tenant）：**LANDED**（默认 OFF）。
- 本整改：删除生产全局 `lastSafeDebugObservation` / `__testing` last-observation API；`internalSafeDebugSink` **仅** debuglog 白名单字段。
- Manifest `mainSha` 随 rebase 按规则刷新（authorized docs only）。
- **仍不** push / 开 PR / 翻转旗标 / 部署；等待 Codex 最终验收。

---

## 14. Ancestry / worktree 状态 — LANDED（整改记录）

| 项                           | 值（Asia/Shanghai）                                                       |
| ---------------------------- | ------------------------------------------------------------------------- |
| Seal pass（historical）      | `phase-b-b2-design-seal-ownership-2026-09-24`                             |
| Remediation pass             | `phase-b-b2-drop-global-safe-debug-2026-09-24`                            |
| Ownership / registry commit  | **LANDED** `3071ffea0031661d6d61ab8af2162e58e6287fb4`                     |
| Sole lander                  | `constitutional-governance-web-read-shadow:grok-bot`                      |
| Five exact sharedPaths       | **LANDED**（无 competing lander）                                         |
| B1 registry land（历史）     | `bfb0324397d02e40a810b63cbd6494bcce52c67c`                                |
| 生产全局 observation 仓      | **已删除** `lastSafeDebugObservation` + `__testing` last-observation APIs |
| `internalSafeDebugSink`      | **仅** debuglog 白名单字段（无 Map / array / cache / AsyncLocalStorage）  |
| 旗标 / 部署                  | 默认 **OFF**；**未**部署；**未** push / **未**开 PR                       |
| `.loom/registry.yaml` 本整改 | **未编辑**（已落地；冲突则 STOP）                                         |

**Historical note（seal-era，already superseded）**：早期 seal 记录曾标记 ownership PENDING、registry 未编辑、rebase STOPPED on `.loom/registry.yaml`；该状态已被 registry commit `3071ffea…` 与后续 B2 编码批次取代。

— Agent: grok-bot
