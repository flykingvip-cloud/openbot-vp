# P2.5 专项评审 — Gateway 集成

> 被评审设计: `./p2-5-production-integration.md`(§1、§2、§4、§9)、`./p2-5-admission-package.md`
> 实施 owner: `kiro-conversation-task-runtime` · 独立 reviewer: `kiro-gateway-reviewer`(**≠ 实施 owner**)
> 关注点: 不越层、单点接入、被动性、不改 `chat.send`、全渠道一致性、异步资源边界。
> 状态: **独立评审已签署;经 C1–C7 复核(2026-08-25,基线 `1e948ebf70`/#707)后 CONDITIONAL 已解除 → CLOSED。** 治理: 实施 owner 不得切角色代签。
> 评审基线: v1 初评 `origin/main` = `968b4b739f`;C1–C7 复核基线 = `origin/main` = `1e948ebf70`(#707 设计整改)。所有判据均对照相应 SHA 的真实代码亲验。

## 评审清单(逐项 decision 由独立 reviewer 填写)

| #   | 评审项               | 判据                                                                                                                                    | 实施自评(证据)           | 独立 decision    |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------- |
| G1  | 唯一调用点           | 仅在 `dispatchReplyFromConfig`(`dispatch-from-config.ts:114`)单点接入                                                                   | 设计 §1.2                | **PASS**         |
| G2  | 被动 fire-and-forget | 镜像既有 `message_received` 钩子,不 `await` 进主回复时序                                                                                | 设计 §2                  | **PASS**         |
| G3  | 不改 chat.send       | 不触碰 `dispatcher`/`routeReply`、不修改 `ctx`(同引用传入 `getReplyFromConfig` `:426`)                                                  | 设计 §2                  | **PASS(设计层)** |
| G4  | 错误隔离             | 钩子自带 try/catch,异常不冒泡进管线 rethrow;不触发 `recordProcessed("error")`                                                           | 设计 §2、§8.1            | **PASS(设计层)** |
| G5  | 全渠道一致           | 内置(telegram/discord/slack/signal/imessage/web/line)+ 扩展(`extensions/*` 经 `runtime-channel.ts`)同一边界                             | 设计 §1.2;验收 #17       | **PASS**         |
| G6  | 输入映射             | `MsgContext`(`templating.ts`)→ `ConversationTurnInput` 只读副本,不改原对象                                                              | 设计 §2                  | **CLOSED**       |
| G7  | 两种调用风格         | 兼容 `void` 与 `await` 两种 dispatch,均不受钩子影响                                                                                     | 设计 §1.2/§2             | **PASS**         |
| G8  | 不依赖排序           | 钩子在 `getReplyFromConfig`(`:426`)之外旁路,自行解析租户,不依赖钩子后计算的 `effectiveCfg`                                              | 设计 §1.1/§1.4           | **PASS**         |
| G9  | **不越层**           | 运行链在 `bounded metrics emission -> stop` 结束;从不 `runActivationGate`、从不 `openTaskStore`、不写 Candidate/Task/Ledger、不启 Agent | 设计 §0、§1.1;验收 #1/#2 | **PASS(设计层)** |
| G10 | 异步资源边界         | 单例 + 有界队列 + 最大并发 + 唯一 drop 策略 + 单项超时 + shutdown drain 上限;不无限 Promise/队列、不每消息新建连接                      | 设计 §4;验收 #12/#13/#15 | **CLOSED**       |

## 亲验记录(reviewer 对照真实代码)

- **G1/G5 单点收敛 = 已核实为真(强证据)。** `dispatchReplyFromConfig` 定义于 `src/auto-reply/reply/dispatch-from-config.ts:114`。全部内置渠道均经两族封装最终汇入该函数:
  - `telegram`(`bot-message-dispatch.ts`、`bot-native-commands.ts`)、`web`(`web/auto-reply/monitor/process-message.ts`)、`line`(`line/monitor.ts`)、`discord`(`native-command.ts`/`agent-components.ts`)→ `provider-dispatcher.ts` 的 `dispatchReplyWithBufferedBlockDispatcher`/`dispatchReplyWithDispatcher` → `dispatchInboundMessageWith*`(`auto-reply/dispatch.ts`)→ `dispatchReplyFromConfig`;
  - `discord`/`slack`/`imessage`/`signal` 与 `chat.send`(`gateway/server-methods/chat.ts:2636` `await`、`:3950` `void`)→ `dispatchInboundMessage`(`auto-reply/dispatch.ts`)→ `dispatchReplyFromConfig`;
  - 扩展渠道 `runtime-channel.ts:138` 与 plugin-SDK(msteams/matrix,`plugin-sdk/inbound-reply-dispatch.ts`)同样注入并调用 `dispatchReplyFromConfig`。
    单点接入使全部渠道共享同一安全边界的论断成立。
- **G2 被动先例 = 真。** `dispatch-from-config.ts:207-227` 存在既有 `message_received` fire-and-forget 钩子:`getGlobalHookRunner()` + `fireAndForgetHook(...)`(导入自 `../../hooks/fire-and-forget.js`),`deriveInboundMessageHookContext(ctx, …)` 只读派生上下文,不 `await`、不改 `ctx`、不触碰 dispatcher。可作为新 shadow 钩子的镜像先例。设计引用 `:197-227`,现状为 `:207-227`(行漂移,语义一致)。
- **G3/G8 = 设计层成立。** `getReplyFromConfig` 在 `:426` 调用;`effectiveCfg` 在其之前由 `resolveKnowledgeSourceContext(gatewayClient)` 派生。旁路钩子自解析租户、不依赖回复计算,论断自洽;字节级不变需由验收 #14 强制。
- **G9 不越层 = 设计层成立、可测。** `runActivationGate`(`activation.ts`)、`openTaskStore`(`store.ts`)确为真实导出符号(`index.ts`),设计明令禁止 P2.5 调用;验收 #1/#2 应以静态(接线模块不 import 这些符号)+ 运行时 spy 双重断言。
- **greenfield = 真。** 全仓 `src/**`(排除测试)对 `conversation-task` 目录零引用,接入为 greenfield。

## 附加条件 / 阻断项(独立 reviewer 填写)

- **[CONDITIONAL-G6 / 交叉引用 隐私 P1]** `ShadowDecisionLog.inputFingerprint` 为必填字段,唯一现存的日志构造器 `replay.evaluateTurn`/`evaluateTurnGated` 以**无密钥** `fingerprintText`(FNV-1a)填充它;`ShadowLogBook.append` 通过 `JSON.stringify(input.log)` 落 `log_json`。若 shadow-only 接线复用该构造器(最自然路径),将把无密钥指纹持久化到生产影子库,违反设计 §6。**条件**:接线的生产日志构造器必须**不落**无密钥 `inputFingerprint`(移除该字段或改为 keyed `tenantFingerprint`);验收 #10 须显式断言 `log_json` 内无 `fp_` 无密钥指纹。
- **[CONDITIONAL-G10 / 交叉引用 运维 O7、C4]** §4 异步合同在纸面完整,但模块内**当前无任何 runner/有界队列代码**。**条件**:验收 #12(队列满不阻塞)、#13(shutdown drain 有界、无 unhandled rejection)、#15(慢 SQLite 不拖慢)须为**真实并发/关停**用例(参照 `store-crossproc.test.ts` 的跨进程范式),不得为单进程桩;并须证明单例复用**单一** tenant-scoped 连接、多渠道共享同一 runner。
- **[CONDITIONAL-C3 / 交叉引用 运维 O9]** 检测/资格 flag 现为**纯环境变量**(`feature.ts` 注释明示 “env-only … config wiring deferred to P2”;`flag-cache.ts` 默认 reader 读 `process.env`)。运行中的 gateway 无法在不重启的前提下热改进程环境变量,且环境变量不满足设计对 §5 allowlist 要求的“多实例一致 + 热更新”。据此,设计 §2“TTL 3s 热读”与 §9“回滚不需重新部署”对 flag **当前不成立**。**条件**:detection/qualification flag 必须改为从**运行时可热加载、多实例一致**的配置源读取(与 §5 allowlist 同等严格),而非 `process.env`;验收 #16 须针对该真实 flag 源证明“回滚即停写、无需重新部署”。
- **[条件-C6 行号漂移(建议)]** 设计/清单多处锚点因 main 推进而漂移,建议在开工前刷新到 `968b4b7`:`chat.ts` `await`/`void` dispatch `:2615/:3824` → `:2636/:3950`;`ChatSendParamsSchema`/`resolveKnowledgeSourceContext`/`MsgContext` 见安全/隐私评审注记。语义均已亲验一致,不作阻断项,但设计作为“记录基准”应准确。

## 复核确认(C1–C7,2026-08-25,基线 `1e948ebf70`/#707)

实施 owner 在 #707(docs-only)对 C1–C7 做设计层整改。独立 reviewer 对照修订设计 + 真实代码复核:

- **G6 → CLOSED**:设计 §2 明确 `MsgContext → ConversationTurnInput` 只读副本;§3.1 强制生产 shadow 记录**不得**复用无密钥 `fingerprintText`(移除 `inputFingerprint` 或改 keyed `tenantFingerprint`),验收 #10 断言 `log_json` 无 `fp_` 无密钥指纹。原 G6/C1 输入映射泄漏陷阱在设计层闭合。
- **G10 → CLOSED(设计规定 + 验收强制)**:设计 §4 给出完整异步资源合同(单例 + 单连接复用 + 有界队列 + 最大并发 + 唯一 drop 策略 + `queue_dropped` 指标/告警 + 单项超时 + 统一 rejection 捕获 + 有界 shutdown drain);验收 #12/#13 要求真实并发/关停用例(参照 `store-crossproc.test.ts`),不得桩。
- **C3 → CLOSED**:设计 §2 冻结 detection/qualification flag 改用与 §5 allowlist 同源的服务端持久、可热加载、多实例一致配置源(env 仅离线回退),TTL + invalidate;验收 #16 要求针对真实配置源证明“回滚即停写、无需重新部署”。
- **C6 → CLOSED**:全文锚点符号化 + 符号优先约定;§1 锚点已校准(`dispatchReplyFromConfig`≈:114、`message_received`≈:208-227、`getReplyFromConfig`≈:426、`chat.ts` 身份注入 ≈:2593-2595/≈:3919-3921 取代原错误引用 `:3793-3799`,均已亲验为真符号)。残留提示(非阻断):`replay.ts` `fingerprintText` 标注 ≈:75、实际 :44,符号优先约定已覆盖。

## 独立签署

- Reviewer id: **`kiro-gateway-reviewer`**(≠ `kiro-conversation-task-runtime`) · 初评日期: **2026-08-25**(基线 `968b4b7`) · 复核日期: **2026-08-25**(基线 `1e948ebf70`/#707) · IDE/Loom session: `kiro` / `FBDD4864-0261-4D8F-BA68-3C6E627E7059`
- 逐项结论: G1/G2/G5/G7/G8 = PASS;G3/G4/G9 = PASS(设计层,须由验收强制);G6/G10 = **CLOSED**(复核后由 CONDITIONAL 解除)。
- 总结论: **条件通过 → CLOSED(2026-08-25 复核)**。Gateway 架构核心论断(唯一收敛点、被动 fire-and-forget、不越层、greenfield)初评已亲验成立;C3/C6 及 G6/C1、G10/C4 相关条件经 #707 设计整改后于设计层闭合,余下强制点已委派给强化验收(#10/#12/#13/#16)于编码门禁执行。**本项无剩余阻断条件。** 全四项闭合后 §5 方可提交专家书面准入;在获书面准入前仍不得动 gateway 代码。
