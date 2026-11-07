# Workplace digital colleague: status and plan

**Scenario:** The enterprise tenant opens a platform connection. An employee then logs in and authorizes through that connection, and delegates selected robots to participate in existing work inside that grant. Methods that survive review can settle into the organization. Enterprise public bots are a separate mode.

**Repo:** `flykingvip-cloud/openbot-vp` (`@upbeyond/openbot`)
**Baseline:** `main` at `658bb327` (merge of #247, 2026-11-05). Plan revised 2026-11-07. Employee binding is 个人设置「授权」. Per-robot use is 机器人「运营授权」. They share one identity id. No application code in this change.
**Nature:** Code-grounded inventory and an ordered implementation plan. This document does not change runtime behavior.
**Date:** 2026-11-07

## Product experience to deliver

Employees already have work identity, contacts, groups, and work resources in Feishu, DingTalk, and WeCom. The enterprise opens the platform first. The employee then logs in through that connection and delegates specific robots.

Example. An admin enables Feishu on the existing enterprise channel page. A tenant employee logs in and authorizes their Feishu account. They allow Project Assistant to handle one named project group, read related docs, draft progress, and send on their behalf. They allow Knowledge Assistant to organize docs and not to send messages. Each robot grant can be paused or revoked on its own. Disabling Feishu for the tenant stops every employee grant under that connection.

Spine:

```
Enterprise tenant opens platform connection
  -> employee logs in and authorizes through that enterprise connection
  -> bind to the employee identity inside the current OpenBot tenant
  -> employee delegates selected robot(s)
  -> robot participates within the grant
  -> auditable trail
  -> settle verified methods as org capability
```

The enterprise entry already exists. Do not add a second install path. System settings renders **企业通道** (`ui/src/ui/ports/enterprise/views/enterprise-message-channels-surface.ts`, nav label in `enterprise-access-control-surface.ts`, route `/enterprise/{tenant}/settings/channels`). The page shows WeCom, Feishu, and DingTalk cards and writes `channels.<id>.accounts.t_<tenant>_default`. A card may sit on Loading. Slice 1a reuses this page for app config, enterprise auth, scopes, and connection check. The employee never types App ID or App Secret.

| Layer | Product entry | Records |
| --- | --- | --- |
| Enterprise | Existing 企业通道: configure or install the platform app, enterprise auth, scopes, connection check | OpenBot tenant bound to the platform enterprise, app config, available capabilities, connection status |
| Employee | 个人设置「授权」 (`已绑定账户`). Not a system-settings page, and not a new page. An unopened platform may still appear here as 「企业尚未开通」, with login unavailable. Login and scope grant happen on that card only after 企业通道 has enabled the platform and the required scopes exist. | One identity id: this tenant employee, the platform user, user-granted scopes, status. 使用记录 is the same identity's audit. |
| Robot delegation | 机器人「运营授权」. Check that same identity and press 确认授权. No second catalog and no new screen. | A grant of that identity id to this robot. The checkbox does not create another identity. |
| Execution | The call uses that enterprise app plus that employee grant. Auth is checked, then the platform is called | Identity, delegation basis, targets, results |

The existing 个人设置「授权」 list may show a platform that 企业通道 has not opened, as 「企业尚未开通」, with login unavailable. If the platform is enabled but the required scopes are missing, that same row says 「等待管理员开通权限」. Those strings are states on this list. They are not a new page. Only identities that are already bound enter the robot’s 运营授权 selectable list. An unopened or not-yet-bound platform does not appear there as a checkbox.

Three steps stay separate in data and auth even when the screens feel continuous:

1. Employee login says who they are.
2. Employee authorization says what the app may do on their behalf.
3. Robot delegation says which robot may use those capabilities.

A platform login that only identifies the user is not a grant of personal message send or receive. Connecting an account does not open every scope to every robot. An enterprise job grant does not substitute for the employee authorization of their own work identity. The platform grant is on the enterprise app. OpenBot then delegates that employee connection to specific robots. A new robot does not require a fresh platform OAuth, and it does not require the employee to re-enter the app secret.

Effective permission is the intersection of:

```
enterprise connection still enabled
  ∩ platform scopes on that app
  ∩ employee authorization still active
  ∩ employee robot delegation
  ∩ enterprise duty policy
  ∩ resource and target constraints
```

### Two product modes

| Mode | Who the platform sees | What exists in this tree | Counts as employee identity proxy |
| --- | --- | --- | --- |
| Enterprise public bot | The app or the bot. Recipients see the bot or the app. | WeCom, Feishu, and DingTalk ingress, enterprise console credential forms, `resolveAgentRoute`, agent reply. | No. |
| Employee identity proxy | The employee, only where the platform API is called with that employee credential and the delegation allows the action. | Not implemented. `feishu-personal` is deferred and `registrationReady: false`. | This is the mode the closed loop must build. |

The inventory in sections 1 through 5 is the public-bot mode. It stays because that code is real. It must not be read as "employee identity proxy is already done."

## How to read the evidence

Quotes from this repo are from the tree at the baseline SHA. Paths are repo-root relative. "Product IM" in the inventory means the three public-bot plugins. WebChat and the enterprise console are adjacent control surfaces. Inherited consumer adapters (Telegram, Discord, Slack, WhatsApp, and the rest of `CHAT_CHANNEL_ORDER`) are noted only where they still shape product routing.

Platform cells use one status, and only when it is true:

- **Docs.** Official documentation describes the capability. That is not code, and it is not a measured pass in a target enterprise.
- **Code.** This repo already calls that capability. Bot ingress is not user OAuth, not user-identity read, and not send-as-self.
- **Measured.** A target enterprise has been observed to pass. None of the four user-proxy capabilities below have a measured pass. Prior Feishu user-permission notes and DingTalk Workspace CLI notes are investigation entry points only.

User OAuth login, user-identity read, send-as-self, and continuous inbound are four independent capabilities. Do not infer one from another. Do not claim that one QR scan gives full custody on all three platforms. WeCom full user-identity proxy is unconfirmed. Desktop automation and session takeover are not a default dependency. Prefer official auth and APIs.

## End-to-end path today

```
Enterprise console
  System settings -> Message channels
  writes channels.<id>.accounts.t_<tenant>_default
        |
        v
extensions/{wecom,feishu,dingtalk}
  long connection or webhook
  resolveAgentRoute(channel, accountId, peer) -> agentId + sessionKey
  dispatchReplyFromConfig -> Pi agent turn
        |
        +-- seat rules / data planner / enterprise-data.invoke
        |     require a signed-in employee gateway session
        |     IM payload does not create that session
        |
        +-- agent tools
              data_capability action=invoke is closed (knowledge-object-only)
              Feishu doc/wiki/drive/bitable/chat/perm tools call Feishu APIs directly
              sandbox mode defaults to off
```

The message path works. The duty, governed-act, audit, and sedimentation path does not start from that message.

## 1. Public bot mode: enter WeCom, Feishu, and DingTalk

**Status for public bots: Partial.** Ingress, enterprise credential forms, and route-to-agent dispatch exist. The inbound turn is a channel session for the app bot. It is not an employee work-account connection and it is not a robot delegation.

**Status for employee identity proxy: Missing.** Do not count this section as the proxy.

### What is wired

Enterprise operators configure the three channels from the console, not from a consumer onboarding wizard.

`docs/channels/enterprise-im.md` says the hub is **Enterprise console, System settings, Message channels**, and that the page writes `channels.<id>.accounts.t_<tenant>_default.*`. Long connection is the default: WeCom AIBot WebSocket, Feishu WebSocket, DingTalk Stream.

The form that performs that write is `ui/src/ui/ports/enterprise/views/enterprise-im-channel-form.ts`. Its header comment: "Writes to `channels.<id>.accounts.<accountId>.*`". The channel id union is `"wecom" | "feishu" | "dingtalk"`. `enterprise-im-channel-form.node.test.ts` expects `defaultEnterpriseImAccountId("001")` to be `t_001_default`. The surface that loads and saves it is `ui/src/ui/ports/enterprise/views/enterprise-message-channels-surface.ts`, which calls `channels.status({ tenantId, probe })`, tenant-scoped `config.get` / `config.set`, and `channels.logout({ tenantId })`.

Each product channel is an extension plugin:

| Channel | Register | Inbound dispatch | SDK slice |
| --- | --- | --- | --- |
| WeCom | `extensions/wecom/index.ts` calls `api.registerChannel` | `extensions/wecom/src/monitor.ts` | `openclaw/plugin-sdk/wecom` and `src/plugin-sdk/wecom.ts` |
| Feishu | `extensions/feishu/index.ts` registers the channel plus doc, chat, wiki, drive, perm, and bitable tools | `extensions/feishu/src/bot.ts` | `openclaw/plugin-sdk/feishu` and `src/plugin-sdk/feishu.ts` |
| DingTalk | `extensions/dingtalk/index.ts` calls `api.registerChannel` | `extensions/dingtalk/src/monitor.ts` | `openclaw/plugin-sdk/compat` only. No `src/plugin-sdk/dingtalk.ts` |

WeCom inbound (`extensions/wecom/src/monitor.ts`) builds a direct peer, calls `resolveInboundRouteEnvelopeBuilderWithRuntime` with `channel: CHANNEL_ID`, then `finalizeInboundContext` and `dispatchInboundReplyWithBase`. The context fields are channel, sender, session key, and command authorization. There is no `tenantId`, `seatId`, or `employeeId`.

DingTalk inbound (`extensions/dingtalk/src/monitor.ts`) does the same for direct and group peers. The context is `Provider: CHANNEL_ID`, `OriginatingChannel: CHANNEL_ID`, `SenderId`. No seat fields.

Feishu inbound (`extensions/feishu/src/bot.ts`) calls `core.channel.routing.resolveAgentRoute` with `channel: "feishu"`, account id, and peer. When `dynamicAgentCreation.enabled` and the route `matchedBy === "default"`, it may create a per-DM agent and resolve the route again. `buildCtxPayloadForAgent` then sets `From`, `SessionKey`, `AccountId`, `SenderId`, `OriginatingChannel: "feishu"`. No seat fields. Dispatch continues through `core.channel.reply.dispatchReplyFromConfig`.

Shared dispatch is `src/plugin-sdk/inbound-reply-dispatch.ts`: `dispatchInboundReplyWithBase` records the inbound session and calls `dispatchReplyWithBufferedBlockDispatcher`, which calls `dispatchReplyFromConfig`. WeCom and DingTalk reach that function through `extensions/{wecom,dingtalk}/src/dispatch.runtime.ts`, which re-exports `dispatchInboundReplyWithBase` from `openclaw/plugin-sdk/compat`.

Route resolution itself is `src/routing/resolve-route.ts`. `resolveAgentRoute` maps channel, account, peer, guild, team, and Discord role ids onto `agentId` + `sessionKey`. Match reasons are binding peer, parent, guild, team, account, channel, or `default`. A governance redirect may rewrite `agentId`. Nothing in that function reads a seat, a duty, or a tenant.

Plugins load when enabled. `src/plugins/loader.test.ts` covers two facts: bundled plugins are disabled by default, and a bundled channel plugin loads when `channels.<id>.enabled=true`. The enterprise page is what turns the product channels on.

### Product versus leftover adapters

`src/channels/registry.ts` defines `CHAT_CHANNEL_ORDER` as telegram, whatsapp, discord, irc, googlechat, slack, signal, imessage, line. WeCom, Feishu, and DingTalk are absent. `src/cli/channel-options.ts` builds the CLI list from that order first, then the plugin catalog.

Package and manifest identity:

- `extensions/wecom/package.json` name is `@openclaw/wecom`. Description: "OpenClaw WeCom channel plugin". Manifest key is `openclaw`. File on disk: `extensions/wecom/openclaw.plugin.json` only.
- `extensions/feishu/package.json` name is `@openclaw/feishu`. Description: "OpenClaw Feishu/Lark channel plugin (community maintained by @m1heng)". Manifest: `extensions/feishu/openclaw.plugin.json` only. The runtime plugin object in `extensions/feishu/index.ts` says "Feishu/Lark channel plugin".
- `extensions/dingtalk/package.json` name is still `@openclaw/dingtalk`, but the description is "OpenBot DingTalk channel plugin" and the package carries an `openbot` extension key. Both `extensions/dingtalk/openbot.plugin.json` and `extensions/dingtalk/openclaw.plugin.json` exist. The entry imports `OpenClawPluginApi` from `openclaw/plugin-sdk/compat`.

Inherited channel implementations remain in core (`src/telegram`, `src/discord`, `src/slack`, and siblings). Their extensions are registration shells. Product IM implementations live in `extensions/`. That split is real. It is not enforced by a channel-ownership check under `scripts/` (no script there names a product-channel allowlist). `CHAT_CHANNEL_ORDER` is still the core list operators and shared code see first.

### What this leg does not do

The enterprise account id `t_<tenant>_default` is a credential bucket. It is not a binding to a seat. `src/gateway/session-tenant-derivation.ts` can attribute a session to a tenant only when the tenant-config store lists `channels.*.accounts` as an array of `{ id }`. Its own comment says that until that index is populated, every session resolves to platform-global. The console write shape is an object map on OpenBot config (`accounts.t_<tenant>_default`), which is a different store shape. Do not treat the two as the same index.

Feishu dynamic agent creation, when enabled, makes a workspace per DM sender. That is the opposite of one organizational seat.

## 2. Fetch data according to duty

**Status: Partial for console data grants. Missing for employee work-identity proxy.** Seat grants, semantic objects, and an authorization-aware planner exist for a signed-in employee session. A public-bot turn does not enter that session. `resolveAgentRunEntitlementScope` is a first-match seat lookup for model entitlement. It is not a uniqueness proof, not an employee login, and not authorization to call Feishu, DingTalk, or WeCom as that employee. Sections 2 through 5 describe current code. They are not the proxy design.

### Seat, grant, and catalog

`src/gateway/model-entitlement/resolve-agent-run-scope.ts` documents the intended lookup for "followup / collaboration bots / cron / external channel inbound": `agentId` to an active `assetType="agent"` binding, else a seat whose `defaultAgentAssetIds` contains that agent. Result: `{ tenantId, seatId, employeeId? }`. If nothing matches, it returns `null`. The comment says callers must not kill the bot on null.

`src/gateway/billing/usage-attribution-context.ts` has a narrower lookup, `resolveOrgSeatIdForAgentInStore`, used to tag usage with `orgSeatId`. That is cost attribution, not a data grant.

Duty authorization for data is `src/gateway/enterprise-data/capability-grant-resolver.ts`. `isCapabilityGrantedForSeat` is true only when every `actionRef` on the capability has a direct seat action grant or a department/role policy-backed grant. A capability with no action refs is never granted. The file header says this contract is shared by the W5 invoke bridge and the Agent Data Planner.

The planner is `src/gateway/enterprise-data/agent-data-planner.ts`. `planDataAccess` grounds a task in the semantic-object catalog, the data-capability catalog, and seat grants, and returns what to fetch. It does not execute a connector. `buildAgentContextPack` bundles identity, plan, authorized capabilities, and knowledge projections. `executeDataPlan` delegates granted steps to `invokeDataCapabilityWithContext`.

Read RPCs live in `src/gateway/server-methods/enterprise-data-planner.ts`. The header says the handlers resolve the caller's own seat server-side and never accept a client-forged seat.

Trusted context is `src/gateway/enterprise-data/enterprise-data-seat-context.ts`. `resolveTrustedEnterpriseDataExecutionContext` requires `client.user` or `client.platformUserId`, requires trusted-proxy platform auth to be enabled, resolves the platform user, then requires an active seat binding for that employee. Missing identity throws `IDENTITY_CONTEXT_MISSING`. Client-supplied `tenantId`, `seatId`, and `employeeId` are forbidden (`assertNoClientExecutionIdentity`).

### Why IM does not get this context

`src/auto-reply/reply/get-reply-run.ts` resolves seat rules with:

```
resolveSeatTurnContext({
  tenantId: replyGatewayTenantId,
  employeeId: ctx.GatewayClientPlatformUserId ?? replyGatewayPlatformUserId,
  agentId,
})
```

`src/gateway/seat-rules/turn-context.ts` returns null unless `tenantId`, `agentId`, and `employeeId` are all present, and then only if that employee has a current seat. The same file says seat rules are guidance only and do not enter Fabric decide. Product IM monitors never set `GatewayClientPlatformUserId`. `get-reply-run.ts` does not call `resolveAgentRunEntitlementScope`.

So the agent-to-seat resolver that was written for external channel inbound is not on the reply path. Seat guidance, execution-identity refinement, and the planner all wait for a gateway employee session that an IM sender does not have.

`src/auto-reply/reply/task-data-preflight.ts` is the in-turn data hint that does run. For enterprise-feed wording it tells the model to answer from Knowledge Universe objects already in context, to call `knowledge_search` then `knowledge_get`, and not to call `data_capability` invoke because it returns no connector rows. That is a prompt, not a grant check.

### What "by duty" is missing

There is no duty object that says "this WeCom account, this seat, these semantic objects." Grants are seat action grants and department/role policies, evaluated only after a trusted employee context exists. The IM sender id (`wecom:<userId>`, Feishu open id, DingTalk sender) is not mapped to an employee. AOR (`packages/aor-core`) is an orchestration runtime, not that duty ontology. The constitutional packages state they do not attach to gateway chat, tool invoke, or AOR.

## 3. Get the work done

**Status: Partial.** The governed act bridge exists for a signed-in employee RPC. The IM agent does not take that bridge. Feishu workspace tools and ordinary agent tools run beside it. Sandbox defaults to off.

### Governed bridge

`src/gateway/server-methods/enterprise-data-m1.ts` exposes `enterprise-data.invoke`. The handler rejects client-supplied execution identity, resolves `resolveTrustedEnterpriseDataExecutionContext(client)`, then calls `invokeEnterpriseDataAction`.

`src/gateway/enterprise-data/data-gateway.ts` is that action. It checks a seat action grant (`NO_ACTION_GRANT` when missing), a registered runtime handler, a scope policy (`scope-self-default` when the grant names none), `evaluateScopePolicy`, approval (`checkApproval` / `consumeApprovalRequest`), and `applyClassificationMasking`. Denials and successes both go through `recordInvocationAudit`.

Agent-facing invoke is intentionally not that bridge. `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` says: "Agent Runtime consumes Knowledge Objects. It does not request ConnectorAction. Employee execution stays on enterprise-data.invoke." `invokeDataCapabilityWithContext` still checks seat, grant, and quota, then records an audit row with `reason: "knowledge-object-only"` and returns `ok: false`. `executeDataPlan` documents the same: granted steps come back knowledge-object-only.

`src/agents/tools/data-capability-tool.ts` matches that red line. `action=list` needs a signed-in enterprise session (`resolveKnowledgeToolGatewayClient`). `action=invoke` returns `knowledge-object-only` and does not call `invokeDataCapabilityForAgent`. The tool description tells the model not to invent enterprise data.

`resolveKnowledgeGatewayClientForAgentRun` (`src/gateway/knowledge/agent-run-gateway-client.ts`) can fall back to the bot seat employee after email, platform user, and owner lookups, and only when platform auth is enabled and that employee exists. That fallback is a knowledge-client resolution. It does not put the IM turn onto `enterprise-data.invoke`, and the tool still refuses connector invoke.

### What an IM turn actually does

The turn runs the normal agent (`dispatchReplyFromConfig` to the Pi runtime) with the channel tools that plugin registered.

Feishu registration (`extensions/feishu/index.ts`) adds doc, chat, wiki, drive, perm, and bitable tools on the same plugin as the channel. Those tools use the Feishu app credentials. They do not pass through `enterprise-data.invoke`, scope policy, masking, or seat grants.

WeCom and DingTalk monitors only deliver a text reply. They do not register an enterprise-data tool.

`src/agents/sandbox/config.ts` sets sandbox `mode` to `agentSandbox?.mode ?? agent?.mode ?? "off"`. Managed Enterprise (`src/gateway/security-profile.ts`) fail-closes startup when `data.mode=managed` is combined with a shared-process boundary, and it rejects a client-chosen profile. That gate is process isolation. It does not switch sandbox mode on, and it does not route IM tool calls through the data gateway.

Fabric does not close this gap. `src/fabric/feature.ts`: "Fabric is OFF by default. When off, the public methods are inert ... and nothing in the existing tool-execution path changes."

## 4. Leave a trail

**Status: Partial.** Enterprise-data invoke writes an audit the admin can list. An IM-originated agent turn does not write that audit. Fabric decision-trace is off unless explicitly enabled. The console does not show "this WeCom message caused this governed action."

### What is recorded when the governed bridge runs

`recordInvocationAudit` in `src/gateway/enterprise-data/audit-runtime.ts` stores invocation events on the enterprise-data store. `enterprise-data.audit.invocations.list` (`src/gateway/server-methods/enterprise-data-m1.ts`) returns them: an enterprise admin may filter by `seatId`; a non-admin is limited to their own trusted `employeeId`. `enterprise-data.audit.trace.get` is admin-only and loads one trace by `traceId`.

The data gateway stamps `traceId` on allow and deny. Capability-agent invoke writes a separate capability-invocation row (`recordCapabilityInvocation`) even for `knowledge-object-only`, but only when that function is called. The IM tool does not call it.

Supply lineage is a different store. `enterprise-data.audit-lineage.overview` and `enterprise-data.supply-audit.*` back the capability home tests in `ui/src/ui/ports/enterprise/views/enterprise-data-capability-home.browser.test.ts`. The governance center modal labeled "审批决策" (`enterprise-data-governance-center-surface.ts`) is the approval decision dialog, not an IM action log.

`get-reply-run.ts` can append a context-scope audit record for a knowledge turn, and it swallows audit errors so they never block chat. That record uses `groupOwner?.tenantId` and the gateway platform user. An IM payload has neither, so this audit does not describe the product-IM turn.

### Fabric

`isFabricEnabled` is true only when `OPENBOT_FABRIC_ENABLED` is `1|true|yes|on`, or `gateway.fabric.enabled === true`. Otherwise policy check and decision-trace handlers resolve no service. Seat-rule guidance is explicitly excluded from Fabric decide (`seat-rules/turn-context.ts`).

### What an operator can see after an IM message

Today, after someone messages the WeCom, Feishu, or DingTalk bot:

- Channel runtime status can show the account connected and the last inbound time (`channels.status` from the message-channels surface).
- The agent session transcript exists under the routed `sessionKey`.
- No `enterprise-data.audit.invocations.list` row is created by that message, because the turn never called `enterprise-data.invoke`.
- No Fabric decision-trace is created unless the deployment turned Fabric on, and even then the IM tool path is unchanged while Fabric is off.
- Feishu doc/drive/wiki tool calls are Feishu API calls. They are not enterprise-data traces.

Cost tags can still gain an `orgSeatId` later if usage attribution looks the agent up in the seat store (`usage-attribution-context.ts`). That is a billing tag, not an action trace.

## 5. Capabilities settle into the organization

**Status: Partial.** Org-level skill and capability records exist and are human-gated. A successful IM or governed run does not write them.

`src/gateway/skill-lifecycle-store.ts` defines visibility `private | group | enterprise` and lifecycle `draft | private | reviewing | approved | published | deprecated | rejected | retired`. Enterprise visibility defaults to `reviewing` when the caller does not pass an explicit lifecycle (`resolveInitialLifecycle`). Install is per robot: `robot-skills.install` in `src/gateway/server-methods/skill-lifecycle.ts`, and relations are `installed_on` edges from skill id to `agentId`. A published enterprise skill is not automatically installed on the agent that just handled an IM turn.

`src/gateway/server-methods/pattern-detection.ts` method `pattern-detection.publish-draft-skill` is commented "Human-gated: create draft executable skill from approved candidate (not auto-installed)." It requires an existing candidate for that `agentId` and an access check. Nothing in the WeCom, Feishu, or DingTalk dispatch path creates a candidate.

`src/gateway/enterprise-data/capability-governance-store.ts` builds a governance view: capability, source mappings, action mappings, projection specs, access policies, and active grants. It is a catalog view, not a sink that records "this run became a capability."

Collaboration learning (`src/gateway/collaboration-learning/`) persists group operating state, membership, and team deliverables for collaboration groups. That is org collaboration state. It is not fed by a product-IM turn, and it is not a skill publish.

Session transcripts and seat-rule guidance live with the session or the seat record. They do not become an enterprise-visible skill or a new data capability.

## 企业通道现状

This is the current enterprise-console channel page. Slice 1a extends this page. It does not replace it. Evidence is from the tree at the baseline SHA.

### 1. UI surface

Navigation is System settings, section id `channels`, label **企业通道**, hint "企业微信 / 飞书 / 钉钉 IM 通道接入" (`ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`). The route used in tests is `/enterprise/{tenant}/settings/channels`. The legacy path `settings/message-channels` resolves to the same section. The surface is `renderEnterpriseMessageChannelsSurface` in `enterprise-message-channels-surface.ts`. The form is `enterprise-im-channel-form.ts`. Cards render in order wecom, feishu, dingtalk.

Each card loads from two calls in parallel: `channels.status({ tenantId, probe })` and `config.get({ tenantId })`. Save calls `config.set({ tenantId, raw, baseHash })`. Clear-credentials calls `channels.logout({ channel, tenantId, accountId })`.

Card status is computed in `resolveCardStatus`:

| State | Label | When |
| --- | --- | --- |
| Page load | 加载中… | `state.loading` is true. The card is a skeleton. This is the Loading state on the screenshot. |
| No login | error text | `需要企业登录上下文` when client or tenantId is missing. |
| Load failure | error text | `state.error` from a thrown gateway call. Default copy: 通道状态加载失败，请重试。 |
| not_added | 未添加 | The channel key is absent from the tenant config form. CTA: 添加并配置. |
| draft | 待完善 | Channel is present and `describeTenantImCredentialGaps` reports missing fields. CTA: 继续配置. |
| ready | 已保存 | Credentials are complete and there is no explicit probe result yet. Probe is not run on load (`lastProbeByChannel` starts empty). |
| connected | 连通正常 | The last explicit 测试连通 returned `tone: "ok"`. |
| test_failed | 测试未通过 | The last explicit probe returned `tone: "fail"`, including unsaved edits and missing fields. |

Workspace actions, all against the tenant config view:

- 保存 writes the form after gap check and webhook-path fill.
- 启用 / 停用 flips `channels.<id>.enabled`. The confirm copy says this does not stop the global channel runtime. Saved secrets stay.
- 清除凭证 calls tenant `channels.logout`. The handler must return `scope: "tenant"` and `runtimeStopped: false` or the UI throws. It deletes secret fields, not the channel entry.
- 移除 deletes the channel key from the tenant override. It does not stop the global runtime.
- 测试连通 calls `channels.status` with `probe: true`.
- 同步为运营身份 calls `syncChannelToOperationalIdentity`, which creates a connector credential binding and opens the enterprise-identity register editor (`ui/src/ui/app.ts`). It is not employee OAuth.

### 2. Config write shape

Account id is `t_<slug>_default` from `defaultEnterpriseImAccountId`. The slug is the OpenBot tenant id lowercased, with non-alphanumeric runs turned into `_`. The write is an object map, not an array:

```
channels.<id>.enabled
channels.<id>.accounts.t_<tenant>_default.connectionMode
channels.<id>.accounts.t_<tenant>_default.<credential fields>
```

`config.set` stores that as a merge-patch in `openbot-tenant-config.json` (`src/gateway/tenant-config.ts`). It does not write the global `openbot.json`.

Fields the form and `missingFieldsForImAccount` actually require (`ui/src/ui/controllers/tenant-im-binding.ts`):

| Platform | Default mode | Required fields | Also stored in the other mode |
| --- | --- | --- | --- |
| WeCom | `connectionMode: "websocket"` | `botId`, `secret` | Callback: `corpId`, `agentId`, `secret`, `token`, `encodingAesKey` |
| Feishu | `connectionMode: "websocket"` | `appId`, `appSecret` | Webhook adds `verificationToken`. `encryptKey` is in the form and is not in the gap check. |
| DingTalk | `connectionMode: "stream"` | `clientId` or `appKey`, `clientSecret` or `appSecret` | Webhook uses the same credential fields. |

Callback modes also get `webhookPath` from `ensureImAccountWebhookPaths`, shaped `/{channel}/a/{accountId}`.

### 3. Runtime

`src/gateway/tenant-config.ts` states the runtime is still one global `channels` instance. Tenant overrides are a config merge only. Per-tenant channel processes are Phase 8 and are not built. `config.set` for a tenant does not restart the gateway (`tenant-config-service.ts`).

`channels.status` with `tenantId` (`src/gateway/server-methods/channels.ts`) loads `resolveConfigForTenant(platformDefault, tenantOverride)` so the account list and `probeAccount` use that tenant's credentials. The running flag, last inbound, and last outbound still come from `context.getRuntimeSnapshot()`, which is the global process. The comment in that handler says an account with no global instance reports not running, and that this is intentional so the platform runtime is not shown as the tenant's. The UI notice after a probed reload says the same: 租户配置视图；运行时仍为全局实例.

Plugins (WeCom AIBot websocket, Feishu websocket, DingTalk Stream) start from the global config the gateway process loaded. Saving 企业通道 does not by itself start that tenant's long connection.

### 4. Tenant bind

What is stored: the OpenBot `tenantId` on the config record, plus the account id slug derived from it. WeCom `corpId` is stored only in callback mode. Feishu has no `tenant_key` field. DingTalk has no `corpId` field. `tenant_key` appears on inbound Feishu event objects in `extensions/feishu/src/bot.ts`. It is not written back to the enterprise channel account.

What is missing: a checked bind from this OpenBot tenant to the platform enterprise (Feishu `tenant_key`, DingTalk `corpId`, WeCom `corpid`) that employee login can match. `session-tenant-derivation.ts` looks for `channels.*.accounts` as an array of `{ id }` inside the tenant-config store. 企业通道 writes an object map. That derivation index stays empty, so sessions stay platform-global. Do not treat `t_<tenant>_default` as the platform enterprise id.

### 5. Capability and status

The card does not report app scopes. 已保存 means the secret fields are non-empty. 连通正常 means the last bot credential probe succeeded. Neither says `im:message.send_as_user` or a user token exists.

`listAppScopes` in `extensions/feishu/src/docx.ts` calls `client.application.scope.list` with the app Lark client and returns granted versus pending scope names. It is a document tool for a configured Feishu account. It is not called by 企业通道, and it is not a user-granted scope list.

Enterprise operational identity refuses feishu, wecom, and dingtalk (`enterprise-operational-identity-providers.test.ts`, `ENTERPRISE_IDENTITY_PROVIDER_UNSUPPORTED` in `enterprise-operational-identity-store.ts`). 同步为运营身份 therefore cannot become the employee-authorization record.

### 6. Gaps for the approved spine

Server truth the employee UI can use now:

- 「企业尚未开通」 when the tenant override has no `channels.feishu` (or the channel `enabled` is false). That is the `not_added` card, or a disabled channel. Slice 1b shows that string on the 个人设置「授权」 row. It does not add a page.

Server truth the employee UI cannot use yet:

- 「等待管理员开通权限」 needs the scopes the published app actually has, compared with the scopes user proxy needs. That list is not on the channel account. A successful 测试连通 must not be shown as those scopes. Slice 1a has to record the checklist result on this page before 1b may show the second string.

Unsafe to reuse as employee proxy:

- 连通正常, 已保存, or a present `appSecret` as proof the employee may log in or send as themselves.
- 同步为运营身份 as employee OAuth. The provider is unsupported, and the flow registers an enterprise connector, not a user token.
- Tenant `config.set` as "the bot is now running for this tenant." The long connection still follows the global process.
- Global runtime health as this tenant's health.
- WeCom websocket mode as a stored `corpid`. It is not in that field set.
- Account id `t_<tenant>_default` as Feishu `tenant_key` or DingTalk `corpId`.
- App `tenant_access_token` as a fallback when a later user token is missing.

Safe to reuse: the page, the card list, the tenant-scoped secret store, `config.get` / `config.set` / tenant `channels.logout`, and the explicit probe as a bot-credential check. Employee login is a new record that points at this enterprise connection. It does not replace the card.

## 复用现有授权与运营授权

Employee digital-identity authorization already has two surfaces of one system. Do not add a third settings page, and do not call the binding page 系统设置「授权」.

| Surface | Where it is | What it does |
| --- | --- | --- |
| 个人设置「授权」 | Personal settings tab `authorization` in `workbench-personal-settings-page.ts`. Panel: `workbench-personal-authorization-panel.ts` and `renderOperationalIdentitySection` in `workbench-operational-identity-section.ts`. | The employee's own identity binding. 已绑定账户, with 编辑配置, 验证凭证, 重新认证, and 停用. Status pills include 已连接, 已过期, 需重新认证, 已停用. |
| 使用记录 | Same 个人设置「授权」 page. `renderOperationalIdentityUsageRecords` in `workbench-operational-identity-usage.ts`. | Columns 时间, 数字人, 身份, 动作, 任务, 结果. This is the audit of the same identities. Proxy actions append here. |
| 机器人「运营授权」 | Per-robot detail tab `auth` in `my-bot-workspace-panel.ts`. The robot list itself is the 我的机器人 workspace. | Which of those bound identities this digital colleague may act as. Checkboxes are 企业身份 and 个人身份. 确认授权. Owned robots show 确认后立即生效. |

企业通道 stays the enterprise gate. The 个人设置「授权」 list may show Feishu, WeCom, or DingTalk before that gate is open, as 「企业尚未开通」, with login unavailable. A bound 企业身份, and therefore a checkbox on 机器人「运营授权」, exists only after the platform is enabled and the employee has bound it. A login that only identifies the user still does not grant send or receive. 连通正常, a saved app secret, and `t_<tenant>_default` are still not an employee authorization and not a platform enterprise id.

### 个人授权与运营授权：统一接口

The two screens are two ends of one authorization model. They are not two stacks.

「统一接口」 means one authoritative record for the new workplace identity, and both UIs plus execution read the same grant. It does not mean merging every historical identity store before Feishu can onboard. v1 may adapt the existing stores behind one API and typed ownership refs. Full migration of every historical provider is not a prerequisite.

Today personal grants go through `onApplyRobotIdentityGrants` into the user operational-identity store (`user-operational-identity-types.ts`, its own `identityId`). Enterprise checks go through `onApplyRobotEnterpriseIdentities` into `enterpriseAccessByAgent` and the enterprise operational-identity store (`enterprise-operational-identity-types.ts`, a separate `identityId`). Slice 1b must not add a third store for Feishu. The new Feishu identity has one `identityId`. Both screens and the execution entry use the grant for that id. Older providers keep their current stores until a separate change says otherwise.

What both surfaces and the execution entry must share:

- One `identityId` for a bound account. 运营授权 checkboxes and 使用记录 rows use that id. They do not mint a screen-local id.
- The same employee id and the same OpenBot tenant id.
- Provider, platform user id, and status (`active`, expired, reauth required, revoked).
- A credential handle. The secret stays in the vault. Neither screen displays it.
- One grant shape: `identityId` + robot `agentId` + allowed actions + grant version. 确认授权 writes that grant. The execution entry reads that grant. It does not read a copy kept only on one screen.
- One usage event shape: `identityId` + `agentId` + action + result. 使用记录 and the later proxy audit are the same events.

What is allowed to differ by surface:

- 个人设置「授权」 creates, verifies, reauthorizes, and deactivates the identity, and shows usage across robots. It does not choose this robot's checkbox set.
- 机器人「运营授权」 only lists identities that are already bound, for one `agentId`, and writes the grant. It does not start OAuth and it does not collect an app secret.
- 企业身份 versus 个人身份 is a kind on that same identity. 企业身份 additionally requires the matching 企业通道 connection to be enabled. It is not a second catalog.

Feishu, WeCom, and DingTalk employee identities enter through that aligned model. `feishu-personal` is `registrationReady: false`. The enterprise catalog test excludes `feishu`, `wecom`, and `dingtalk`. That is why 运营授权 today shows AI数字替身 / 微信公众号 and 腾讯会议（企业）, and not those three platforms. Extending the shared identity list is the work. A parallel Feishu catalog is not.

## Gap table

Severity is for the employee-identity proxy. Public-bot ingress is listed so it is not mistaken for that proxy. P0 means the closed loop is false until this moves. P1 means the loop is visibly incomplete. P2 is hygiene that does not unblock the loop.

| Leg | Status | Severity | Evidence | Gap |
| --- | --- | --- | --- | --- |
| Enterprise public bot ingress | Partial, and it is a separate mode | P2 for the proxy. Do not treat it as P0 progress on the proxy. | Extensions monitor to `resolveAgentRoute` to `dispatchReplyFromConfig`. Console writes `t_<tenant>_default`. | A bot can reply. The platform identity is the app. `CHAT_CHANNEL_ORDER` and `@openclaw/*` package ids still present product IM as secondary. DingTalk uses the compat SDK. |
| Enterprise platform connection | Partial | P0 for the proxy chain. The page exists. Employee authorization on top of it does not. | 企业通道 at `/enterprise/{tenant}/settings/channels` writes bot credentials to `t_<tenant>_default` (`enterprise-message-channels-surface.ts`). That is app config for the public bot, not a recorded OpenBot-tenant to platform-enterprise bind used by employee login. | Reuse this page. Do not add a parallel install wizard. Slice 1a must show capability status on the same cards. |
| Employee login and authorization through that connection | Partial UI, missing these three platforms | P0 | 个人设置「授权」 already lists 已绑定账户 and 使用记录. `feishu-personal` is `registrationReady: false`. The enterprise identity store is a second `identityId` space and excludes `feishu`, `wecom`, and `dingtalk`. | Do not add a settings page or a third store. The 授权 list may show the platform as 「企业尚未开通」 with login unavailable. Bind is allowed only after 企业通道 is enabled and required scopes exist. 运营授权 lists only that bound identity id. |
| Robot delegation | Partial UI, missing these platforms | P0 | 机器人「运营授权」 already checks 企业身份 and 个人身份 and saves with 确认授权, through two apply calls. The lists do not include Feishu, WeCom, or DingTalk employee identities. | Same identity id as 个人设置「授权」. Do not add a delegation screen or a Feishu-only grant table. A second robot still cannot borrow a grant it was not given. |
| Controlled read and send in an existing work scene | Missing for user identity. Public bot tools are a different identity. | P0 | `data_capability` invoke stays `knowledge-object-only`. Feishu doc/wiki/drive tools use the app client. WeCom and DingTalk monitors send the bot reply. | No server entry that loads a user credential, checks delegation, and calls the platform as that employee. Group text must not widen grants. |
| Trail of a proxy action | Missing | P0 | `enterprise-data.audit.invocations.list` records data-gateway invokes for a signed-in console session. Public-bot turns do not write it. Fabric is default off. | A proxy action must trace employee, robot, connection, delegation version, trigger, target, confirm record, and external result. "Bind success" is not business complete. That trace does not exist. |
| Settle a method into the org | Missing for this flow. Partial as a human skill lifecycle. | P1 | Skill visibility includes `enterprise` and defaults to `reviewing`. `pattern-detection.publish-draft-skill` is human-gated and not auto-installed. | A verified project follow-up can later become a reviewable method. Personal tokens, private conversation content, and personal delegations must not publish with it. Nothing extracts that method today. |
| Duty policy as a joint gate | Partial as console policy. Missing as a proxy gate. | P1 | Seat action grants and department/role policies exist for `enterprise-data.invoke`. Seat rules are guidance and do not enter Fabric decide. | Enterprise duty and employee delegation must both pass. Duty alone must not authorize use of the employee work identity. The minimal enterprise door is slice 2 and is enforced before the first read or send in slices 3 and 4. Slice 6 enriches duty. It is not the first attachment of enterprise authorization. |

## Identity and authorization

Keep the enterprise connection, the employee authorization, and the robot delegation as separate records. Do not collapse them into `GatewayClientPlatformUserId`. Login is not scopes. Scopes are not a robot delegation.

### Enterprise connection

The enterprise record is the 企业通道 configuration for one OpenBot tenant and one platform: app config, the platform enterprise id the admin connection check observed, the scopes the app actually has, and connection status. Employees do not submit that enterprise id and do not submit the app secret.

### Employee authorization

An employee connection always references one enterprise connection. The server checks that the platform enterprise on the token matches the enterprise connection already stored for this OpenBot tenant. A platform enterprise id supplied only by the employee is not enough to create the bind.

The employee record is a trusted bind among:

- that enterprise connection
- the platform user (Feishu `open_id` / `user_id`, DingTalk `unionId` / `userId`, WeCom `userid`)
- the OpenBot employee (platform-auth user already bound to a membership in this tenant)
- the user-granted scopes actually returned (`scope` on Feishu refresh; admin-published scopes plus what this user consented)

Login and authorization stay two steps. A completed login without the scopes for send or receive is shown as identity only. It is not shown as permission to send or read personal messages.

The employee confirms authorization through the platform OAuth or the platform equivalent, started from OpenBot after the enterprise connection is enabled. Admin install or publish of the app is the enterprise step. It is not the employee consent.

Access and refresh tokens live in the server credential vault. They do not go into the model context, prompts, skill files, or ordinary logs. The existing split between operational-identity metadata and a secrets file (`docs/design/openbot-saas-tenant-data-architecture.md` describes `openbot-user-operational-identity.json` versus `openbot-user-operational-identity-secrets.json`) is the pattern to reuse. `feishu-personal` is not that implementation. It is a deferred catalog row.

### Robot delegation

A delegation names:

- which connection
- which robot (`agentId`)
- which actions (read, draft, send, and any narrower verb)
- which resources (named group, doc, calendar)
- the mode: read-only, draft-then-confirm, or limited auto
- when employee confirm is required
- when the delegation expires, and the delegation version

One connection can have many delegations. Pausing or revoking Project Assistant leaves Knowledge Assistant intact. Adding a robot does not start a new platform OAuth.

### Single execution context

Every controlled call carries one context, resolved on the server at the execution entry:

- who triggered (employee action, inbound event, or queued task)
- who authorized (OpenBot employee id)
- which robot
- which connection and which platform identity
- which resource and which targets
- where the result goes (draft back to the employee, or a platform message id)

This context is not a forged gateway login. Do not copy `seat.currentEmployeeId` into `GatewayClientPlatformUserId` or `GatewayClientUser`. A robot that belongs to a seat is not an employee login and is not an employee authorization. `get-reply-run.ts` treats those fields as the signed-in employee. Stuffing them would make later code believe a user session exists.

`resolveAgentRunEntitlementScope` uses `Array.find` on agent asset bindings, then falls back to the first seat whose `defaultAgentAssetIds` contains the agent. That first match is not a uniqueness proof and it is not action authorization. The function returns null when nothing matches, and its comment says callers must not kill the bot on null. If a later slice reuses it for duty lookup, it must add a tenant constraint, reject more than one match, and check expiry. It still does not authorize a platform call.

`assertNoClientExecutionIdentity` in `enterprise-data-seat-context.ts` already rejects client-supplied `tenantId`, `seatId`, and `employeeId`. Proxy execution keeps that rule. The server builds the context from the connection and the delegation. The model does not pass the token or the employee id.

### Joint gate

A call is allowed only when all of these hold at call time, not only when the task was created:

1. The platform grant is still valid (token, scopes, user still in the app availability range, admin has not removed the app).
2. The employee delegation for this robot, action, and resource is active and unexpired.
3. Enterprise seat and duty policy allow this robot to perform this class of work for this employee.
4. The concrete target is inside the delegation (this group, these docs, these recipients). Message text cannot add a group, a doc, or a recipient.

Enterprise job grants do not replace (1) or (2). Employee delegation does not replace (3).

**When item 3 attaches.** It does not wait for slice 6.

- Slice 2 establishes one authorization decision entry. Every later proxy call uses it. The entry returns a distinct outcome when enterprise policy is missing, the seat is missing, or the seat binding is ambiguous. Those outcomes are denials. They are not an implicit allow.
- Slices 3 and 4 call that entry before the first real read or write. The gate there is minimal: in enterprise mode the OpenBot employee resolves to exactly one seat in the tenant, and a minimal enterprise policy allows this robot to do this class of work for that employee. A full duty ontology is not required yet. The enterprise door is not skipped.
- Slice 6 enriches that same entry with duty detail and adds org sedimentation. It is not the first attachment of enterprise authorization.

This scope is the enterprise tenant only. There is no standalone personal-use mode and no second path that skips the enterprise connection. A missing seat, a missing policy, or an ambiguous binding is a deny. It is not treated as passed.

### Rejected first slice

Do not implement the earlier recommendation that stamped `resolveAgentRunEntitlementScope(...).employeeId` into `GatewayClientPlatformUserId` after `resolveAgentRoute`. That fabricated a trusted user session from a seat occupant. It is withdrawn.

## Platform capability matrix

Checked 2026-11-07 against the cited official pages. No target-enterprise measurement was run for this revision. "Docs" means the cited page describes the capability. It does not mean OpenBot calls it, and it does not mean a customer tenant has passed.

First closed loop is Feishu, self-built app. DingTalk and WeCom stay in the matrix so the gap is explicit. If Feishu send-as-user is unavailable in the target tenant (scope not approved, bot not in the group, or the API rejects user token), the product must say the send will appear as the bot, or must stop at employee confirm-to-send. It must not report success as the employee.

### Feishu

| Question | Status | What the citation actually says |
| --- | --- | --- |
| Employee authorization, and account to enterprise to employee | Docs | [获取访问凭证](https://open.feishu.cn/document/server-docs/api-call-guide/calling-process/get-access-token) distinguishes `tenant_access_token` (app, no user consent) from `user_access_token` (user consent; data range is the user). Obtaining a user token is the OAuth code flow for both self-built and store apps: configure redirect URL, take `code`, exchange, optionally refresh. The user must be allowed to use the app. Admin publish is required before new scopes and event subscriptions take effect ([添加事件](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/subscription-event-case)). |
| Work resources as the user | Docs | The same access-token page: a user token reads and writes what that user can read and write (example: a bitable created with a user token is owned by that user). App token is a different data range. Doc and calendar event subscription can be user-identity; calendar events are user-identity only ([事件概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)). This is not a measurement that every doc, task, and chat is available. |
| Send as self | Docs | [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create) (updated 2026-04-10) accepts `user_access_token` for user identity and `tenant_access_token` for app identity. User identity requires both `im:message` and `im:message.send_as_user`. The same page still requires the app to have bot capability, the recipient to be inside the bot availability range, and, for a group, the bot to be in the group with permission to speak. Those prerequisites apply before identity is chosen. The IM overview table still lists several sibling APIs (reply, history, forward) as `tenant_access_token` only ([消息概述](https://open.feishu.cn/document/server-docs/im-v1/introduction)). v1 send is `messages.create` as the user. Do not assume reply-as-user. `uuid` dedupes identical sends for one hour. |
| Continuous inbound on approved conversations | Code for bot-addressed events only. Docs for a different user-event mechanism. Not the employee mailbox. | This repo already runs the Feishu bot websocket and dispatches those events (`extensions/feishu/src/bot.ts`). That stream is messages the bot receives. [使用长连接接收事件](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case) is self-built apps only, cluster delivery to one of up to 50 connections, 3 second handling, at-least-once retry. It does not mean every new message in the employee chats is delivered. User-identity subscriptions cover resources such as docs and calendar, not a proven full chat mirror. |
| Renew, revoke, disable | Docs | [刷新 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token): user token lifetime is on the order of two hours (`expires_in`, do not hard-code). `refresh_token` needs `offline_access` in the authorize `scope`, is single use, and must be stored again. After 365 days of authorization, refresh fails with 20037 and the user must authorize again. Error 20010 means the user no longer has permission to use the app. [撤销用户授权事件](https://open.feishu.cn/document/authentication-management/auth-v4/revoked) pushes `auth.user_access_token.revoked_v4` when the user token or refresh token is revoked (Webhook in that page). OpenBot must treat revoke, refresh failure, and loss of app availability as "stop new calls". |
| Deploy fit | Docs, aligned with current bot deploy, not with user proxy | Self-built app fits a gateway that can reach the public internet: long connection needs no public callback URL. Store apps cannot use that long-connection mode. Admin must approve the published version. Current code is the bot half only. |

Feishu user OAuth, user-identity read, send-as-self, and continuous inbound of the employee mailbox are not four checked boxes. OAuth, user-scoped read, and send-as-user are Docs. Bot inbound is Code. None are Measured.

### DingTalk

| Question | Status | What the citation actually says |
| --- | --- | --- |
| Employee authorization, and account to enterprise to employee | Docs | [授权概述](https://open.dingtalk.com/document/development/authorization-overview) separates user access tokens (delegated, user must consent) from app access tokens (admin grant at install, no user login). [获取用户token](https://open.dingtalk.com/document/development/obtain-user-token) supports internal, third-party org, and third-party personal apps. The response includes `corpId`, `accessToken` (about 7200 seconds), and `refreshToken` (30 days). Third-party org apps need the org authorization suite to obtain `authCode`. Internal apps are created under the org. That is admin possession of the app, plus a separate user consent for a user token. |
| Work resources as the user | Docs for some APIs. Not a general user-identity workspace. | The authorization overview gives personal calendar and mobile as examples of user-token data. [创建日程](https://open.dingtalk.com/document/personalapp-server/create-schedule) says an internal app and a third-party org app pass the app `accessToken`, while a third-party personal app passes the user token. Do not treat "DingTalk has a user token" as "an internal app can read the employee docs and calendar as that user." No target measurement. |
| Send as self | Gap in the cited current APIs | [企业机器人发送单聊消息](https://open.dingtalk.com/document/development/the-application-robot-in-the-enterprise-sends-a-single-chat) sends with the app token and `robotCode`. Recipients see the robot. Group receive is @bot or a message to the robot ([机器人接收消息](https://open.dingtalk.com/document/dingstart/robot-receive-message)). [发送普通消息](https://open.dingtalk.com/document/orgapp/send-normal-messages) describes an employee-looking send via a one-time `cid` from a JSAPI picker, uses the app `access_token`, and says new apps could no longer onboard after 2022-09-23. That is not a supported send-as-self for this product. If the closed loop ever runs on DingTalk before a cited user-send API exists, the UI must say the message will appear as the robot. |
| Continuous inbound on approved conversations | Code for robot callbacks only | `extensions/dingtalk/src/monitor.ts` is the bot stream path. Official Stream topic is `/v1.0/im/bot/messages/get`. That is not the employee conversation stream. |
| Renew, revoke, disable | Docs for token lifetime only | User `refreshToken` is documented at 30 days. This pass did not find a cited DingTalk equivalent of Feishu `auth.user_access_token.revoked_v4` and does not claim one. Loss of org authorization or a failed refresh must still stop calls. Behavior after employee leave is not measured. |
| Deploy fit | Docs plus Code for the robot | Internal app plus Stream matches the current plugin (`clientId` / `clientSecret`, no public callback). Third-party org apps need the authorization suite. Neither is a measured user-proxy deploy. DingTalk is not the first closed loop. |

### WeCom

| Question | Status | What the citation actually says |
| --- | --- | --- |
| Employee authorization, and account to enterprise to employee | Docs for identity lookup. Not a user API token. | [开始开发](https://developer.work.weixin.qq.com/document/path/91335) and [构造网页授权链接](https://developer.work.weixin.qq.com/document/path/91120): OAuth `snsapi_base` silently returns the member `userid` inside the corp; `snsapi_privateinfo` asks the member before sensitive profile fields. Redirect domain must be the app trusted domain. This binds "which employee opened the page." It does not issue a token that calls arbitrary APIs as that employee. |
| Work resources as the user | Gap for interactive proxy | [会话存档](https://developer.work.weixin.qq.com/document/path/91361) and [获取会话记录](https://developer.work.weixin.qq.com/document/path/99824) let an enterprise pull archived chats after an admin turns the feature on, employees are informed, and a key pair is configured. The sync API cited here returns at most 5 days and requires the data-zone permission. That is compliance archive, not the employee granting a robot to act as them. Do not use it as the proxy. |
| Send as self | Gap | [发送应用消息](https://developer.work.weixin.qq.com/document/path/96458) sends with the corp `access_token` and `agentid`. Recipients see the application. `msgid` is returned. `enable_duplicate_check` can suppress identical payloads inside an interval. [智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463) replies with `aibot_respond_msg` or pushes with `aibot_send_msg` as the bot. No cited API sends a group message as the employee. |
| Continuous inbound on approved conversations | Code for the intelligent robot only | `extensions/wecom/src/monitor.ts` is the AIBot websocket. Official callbacks are `aibot_msg_callback` when the user @mentions the bot in a group or DMs the bot (`msgid` is the dedupe key). One bot, one live connection; a new subscribe kicks the old one. That is not the employee mailbox. |
| Renew, revoke, disable | Not a user-token lifecycle | App secret and bot secret are admin credentials. Member disable removes the user from app visibility (app messages then report `invaliduser`). There is no cited per-employee refresh token to revoke. Full user-identity proxy remains unconfirmed. |
| Deploy fit | Code for the public bot | Self-built corp app plus AIBot long connection matches the enterprise console (Bot ID + Secret, no public URL). It is the right deploy for public-bot mode. It is not evidence of employee proxy. WeCom is not the first closed loop. |

### What OpenBot calls today

| Capability | Feishu | DingTalk | WeCom |
| --- | --- | --- | --- |
| User OAuth login | Not in code. Catalog row is deferred. | Not in code. Plugin uses app `accessToken`. | Not in code. Webpage userid OAuth is not implemented here. |
| User-identity read | Not in code. Doc/wiki/drive tools use `getClient` from app id and app secret. | Not in code. | Not in code. |
| Send as self | Not in code. Bot reply and `tenant_access_token` (`extensions/feishu/src/streaming-card.ts` calls `/auth/v3/tenant_access_token/internal`). | Not in code. `sendDingtalkMessage` uses the app token. | Not in code. Monitor sends as the bot. |
| Continuous inbound | Code for events the Feishu bot receives. | Code for the robot Stream callback. | Code for AIBot `aibot_msg_callback`. |

If a Feishu tool is later pointed at a user credential and that credential is missing, expired, or revoked, the tool must fail. It must not silently retry with the app `tenant_access_token`. The app token is a broader identity. The current tools have no user credential to fall back from. The rule applies the moment user auth is added.

## Credentials and checks on every call

- Resolve connection plus delegation at the execution entry of each read, write, and send. Checking only when the task is created is not enough.
- Revoking one robot delegation does not revoke another robot on the same employee connection.
- The enterprise disabling the platform connection blocks new execution for every employee connection under it, and for every robot that depended on those grants.
- An employee disconnect or revoke stops only that employee and the robots that depend on that employee grant. Other employees on the same enterprise connection keep working.
- Calls already accepted by Feishu, DingTalk, or WeCom need a final-status read (`message_id`, `msgid`, or an error callback). Do not promise that in-flight platform operations can be recalled.
- Employee leave, loss of OpenBot membership, platform scope removal, and Feishu errors 20010 and 20037 invalidate execution that depended on that connection.
- Tokens stay in the server vault. Logs may store connection id, delegation version, and platform result id. They do not store access tokens, refresh tokens, or app secrets.

**Concurrent refresh.** Several robots may use one connection. Refresh for that connection is serialized. The token update is atomic. A slower refresh must not overwrite a newer token with an older one.

**Unknown send outcome.** A timeout or a lost response moves that confirm to `outcome unknown`. Reconcile against the platform result first (returned message id, or the platform idempotency key if the platform can show whether that key was consumed). If it stays unreconciled, block a blind resend and ask the employee to handle it. Do not store the attempt as a simple failure and retry it.

**Durable confirm.** A platform idempotency window does not replace OpenBot confirm and send records. Feishu `uuid` dedupes for about one hour and is not the OpenBot record. The OpenBot record is keyed by tenant, connection, delegation, and task, plus the confirm id, and it survives process restart.

**Revoke versus send.** The final checkpoint is the server execution entry immediately before the platform call. Once revoke is recorded, that entry accepts no new execution. A request the platform has already accepted is stored as accepted and reconciled. Revoke does not promise recall of that request.

**Disconnect is not platform revoke.** Employee disconnect disables that employee connection inside OpenBot: new calls for that employee stop, their queued work is cancelled or revalidated, and their local access and refresh tokens are deleted after in-flight reconciliations finish or time out. That action does not by itself revoke the authorization on Feishu, and it does not disable the enterprise app. Platform revoke is a separate employee or admin action on Feishu, or an explicit control added later that calls Feishu. The event `auth.user_access_token.revoked_v4` disables that employee connection and deletes that employee local tokens. The status UI names which of the two happened. Disabling the enterprise connection is a third switch: it blocks every employee under that platform, and it is not the same record as one employee disconnect.

## Multi-robot coordination in v1

The employee can authorize one robot or several. The design is not a single-robot path with extra robots bolted on later.

Default for one inbound platform event: one primary handling robot, chosen by the employee session division or by an explicit task assignment. Other authorized robots may contribute drafts into that task. Only the primary calls the platform send.

Also required in the design, and in tests once the loop exists:

- Dedupe platform deliveries. Feishu events can repeat (`event_id` on v2, `uuid` on v1). WeCom AIBot repeats on `msgid`. DingTalk Stream can redeliver. A duplicate callback is not a second task.
- Claim. The primary claim is single-winner. A second robot that sees the same event attaches as a contributor or stops.
- Send idempotency. Feishu `uuid` is necessary and not sufficient. OpenBot also stores the confirm id and refuses a second external send for that confirm.
- Echo. A message the proxy just sent must not be ingested as a new employee request. Match platform message id and sender identity (employee versus app versus this robot).
- Human takeover. The employee can mark the task taken. Further automatic send on that task stops.
- Revoke while work is pending. Pending tasks for the revoked robot or the revoked connection do not send. Another robot delegation stays in force only for its own scope.

The same external message must not produce two external replies. An employee-authored message and a proxy-sent message stay distinct in the trail and in the echo check.

### Several employees in one group

One employee with several robots is not the same problem as several OpenBot employees who have each connected an account that can see the same project group. One platform event can match more than one connection and more than one delegation. Picking a primary robot does not choose whose work identity acts.

- An employee-triggered task uses only the connection that employee explicitly chose and is entitled to delegate. The server checks that entitlement. The client does not name someone else connection.
- A continuous or event-driven task uses a delegation that was assigned in advance to that conversation or that task. The person who spoke in the event does not become the authorizer.
- When more than one delegation matches, the system requires an explicit assignment or it stops automatic send. It does not take the first connection.
- A request from one employee in the group does not invoke a different employee work identity unless a pre-defined proxy rule names that pair, that action, and that resource.
- Session, draft, task, and idempotency records are keyed by tenant, connection, delegation, and task. Chat id alone, or agent id alone, is not the key.

## Implementation order

Acceptance scene, once the slice 1a checklist has Measured both the chosen read API and the send API: an admin enables Feishu on the existing 企业通道 page, a tenant employee logs in and authorizes, and Project Assistant works inside the grant. If group history is not readable and named docs are, the scene shrinks to "draft and send progress from designated docs." Do not promise the group-progress loop before both measurements pass. Feishu is first. DingTalk and WeCom use the same four layers, adapted to what those platforms actually support. They do not get a second install page.

The first development target inside that scene is one enterprise connection, one employee authorization on it, and one explicit robot delegation. The same model must be unable to borrow another employee authorization or another robot delegation.

Each slice is its own change. Basic audit is part of slices 1 through 5, not a final UI project. `data_capability` action `invoke` stays `knowledge-object-only`. New platform actions go through an explicit server entry that holds the proxy execution context. They do not go through `enterprise-data.invoke` by opening generic connector calls, and they do not go through the current Feishu app-credential tools.

### Slice 1a. Enterprise channel

Reuse 企业通道 as inventoried in 「企业通道现状」. Do not add a parallel enterprise install path. Do not treat 连通正常, a saved app secret, or 同步为运营身份 as employee authorization. On that page, for Feishu first, verify or complete the app config the card already edits, record the platform enterprise the connection check observed, and show capability status (which of the checklist rows the installed app can attempt). Employee UI reads this status. It does not collect App ID or App Secret.

If the card is still Loading, fix that loading state on this surface rather than starting a new screen.

Audit admin enable, disable, scope change, and connection check. Disabling the enterprise connection blocks new execution for every employee connection under it.

Implemented on this page for Feishu, still not employee authorization: a connection check writes `channels.feishu.accounts.<id>.platformEnterpriseId` (Feishu `tenant_key`) and `capabilityStatus` rows `projectGroupRead`, `projectDocs`, `sendAsUser`, `newMessageTrigger`. `channels.feishu.connectionAudit` records enable, disable, scope change, and connection check. `readFeishuEnterpriseChannelContract` is what slice 1b reads. `childExecutionBlocked` is true when the Feishu channel is missing or `enabled: false`, and the same flag is copied onto `channels.status` as `enterpriseImChildExecutionBlocked`. The status payload also carries `platformEnterpriseId`, `enterpriseImCapability`, and `enterpriseImEmployeeUiHint` (`enterprise_not_open`, `waiting_admin_scopes`, `app_can_attempt`). `session-tenant-derivation` indexes both the account object map and `platformEnterpriseId`. `t_<tenant>_default` is not that id. `app_can_attempt` means the app scopes are present. It is not a Measured pass and not an employee login. New execution for a later employee connection must refuse while `childExecutionBlocked` is true.

### Slice 1b. Employee login and authorization

Only after 1a shows the platform enabled. Do not add an employee-auth settings page. Put Feishu on 个人设置「授权」 (`workbench-personal-authorization-panel.ts` / 已绑定账户). If 企业通道 has not enabled Feishu, that row says 「企业尚未开通」 and login is disabled. If the app is on but the checklist scopes are missing, the row says 「等待管理员开通权限」. When both are true, the employee uses the existing card actions (bind, 重新认证, 停用) to complete Feishu user authorization (`user_access_token`, including `offline_access` when refresh is required).

The new identity uses the aligned `identityId` from 「个人授权与运营授权：统一接口」. Do not create a Feishu-only store beside the user store and the enterprise store. The server binds that platform user to the current tenant employee and stores the employee connection as a child of the enterprise connection. The platform enterprise on the token must match the enterprise connection. An enterprise id posted by the employee alone is rejected. Successful bind, reauth, and revoke append to the existing 使用记录 events for that `identityId`. They do not create a second audit list.

Store tokens in the vault. Support refresh, employee disconnect, and status (identity only, authorized, needs reauth, revoked, 「企业尚未开通」, 「等待管理员开通权限」). Employee disconnect follows the rule above: it deletes that employee local credentials and does not claim a Feishu-side revoke unless one was performed. Login without the send or receive scopes stays identity-only on the status line.

Implemented for Feishu on the existing user operational-identity store. `identityId` is `feishu-employee.<tenantId>.<ownerId>.<openId>`. The record's `enterpriseIm` points at the 企业通道 account and the token's `tenant_key`. Access and refresh tokens are `oauth_token` secrets in `openbot-user-operational-identity-secrets.json`, keyed by the credential handle. 个人设置「授权」 displays `enterpriseIm.statusLabel` and `feishuEmployeeChannel.statusLabel` from `user-operational-identity.list`. It does not import the server credential module. The list projection uses the tenant override's `t_<tenant>_default` account only. A platform-default account is not selected. Login stays disabled for 「企业尚未开通」 and 「等待管理员开通权限」. A bound row uses that same gate before 需重新认证, 已过期, or 已授权. Credential use refuses `reauth_required`, `expired`, and a past `expiresAt`. Refresh is `POST /open-apis/authen/v2/oauth/token` with `grant_type=refresh_token`, under the identity and secret store write locks (`user-operational-identity.feishu-employee.refresh`). Bind does not write a robot grant and does not call the auto-create grant branch. A Feishu runtime execute returns before that branch. User-granted scope names are stored on the identity; that is not a Measured checklist pass.

Audit each login, authorization, refresh, failure, and employee disconnect. A successful bind is not the closed loop.

The validation deliverable is a filled checklist, owned by 1a for what the app can do and confirmed in 1b for what this user was actually granted. Generic "a user token reads what the user can read" does not fill it. The IM overview still lists history, reply, and forward as `tenant_access_token` only. That uncertainty stays until a row below is Measured.

| Checklist row | What must be recorded |
| --- | --- |
| Project-group context | Concrete message-read API or APIs. Token type (`user_access_token` or `tenant_access_token`). Permission names actually granted. Time window. Which messages are visible: full group history, bot-visible messages, or @bot only. |
| Project docs | Which resource type v1 will read (docx, wiki, drive file, or bitable). How a delegation allowlist is checked against that object id. What happens to a link inside an in-scope doc that points outside the allowlist: not fetched, cited in the draft as unreadable. |
| Send as self | Concrete API (`POST /open-apis/im/v1/messages` unless measurement names another). Scopes present on the token in this tenant (`im:message` and `im:message.send_as_user`, or the absence of either). What the recipient actually saw: the employee, or the bot. |
| New-message trigger | Which events arrived in the target tenant. Whether @bot was required. Any other official fetch, including incremental polling, with its permission, rate limit, and observed latency. This row feeds slice 5. It does not by itself turn continuous work on. |

Only when the chosen read row and the send row are both Measured may the product promise a project-group progress closed loop. If the group-history row fails and the docs row passes, the scene is "draft and send progress from designated docs."

Tests: token values never appear in tool results or prompt builders. Refresh replaces the stored refresh token and is safe under the concurrent-refresh rule. Employee disconnect makes that employee next read fail, leaves another employee on the same enterprise connection able to read, and the status says local credentials were deleted, not that Feishu revoked the grant, unless a platform revoke was recorded. Disabling the enterprise connection makes every child employee connection fail new calls. A token whose platform enterprise does not match the stored enterprise connection is rejected. The employee form has no App ID or App Secret fields.

Out of scope: robot send, a second install wizard, DingTalk and WeCom user authorization until Feishu 1a and 1b are in place (they reuse the same layers later), Fabric flag, sandbox default, `CHAT_CHANNEL_ORDER`.

### Slice 2. Robot delegation and the authorization entry

Do not add a delegation screen. On 机器人「运营授权」, the Feishu identity from slice 1b appears under 企业身份 only when 企业通道 has enabled Feishu and 个人设置「授权」 has bound that same `identityId`. An unbound or unopened platform is not a checkbox on this screen. The employee checks it for this robot and presses 确认授权. The grant is the shared shape (`identityId` + `agentId` + actions + version). Checking the box does not widen platform scopes and does not skip the enterprise connection.

页面要求确认，不代表执行端不会自动生成授权. A confirm control on the screen is not enough. The execution path must refuse when that confirmed grant is absent, and it must not write a grant while refusing.

企业 IM 员工身份代理仅接受员工明确确认的有效机器人授权。自有机器人不因所有权自动获得授权；访问解析不得调用既有自动创建 grant 的分支，也不得把旧的自动授权视作本场景的确认授权。首次 resolve／execute 在授权缺失时返回拒绝，不写入新 grant。企业严格检查不得沿用既有缺少席位或策略时的兼容放行结果。其他身份提供方维持既有行为，除非另行评估修改。

The auto-create branch is `resolveUserOperationalIdentity` in `src/gateway/user-operational-identity-access.ts`. When no grant matches and `isAgentScopeAllowedByDefault` is true, it writes a new active grant with `grantMode: "auto"`. `isAgentScopeAllowedByDefault` in `user-operational-identity-agent-scope.ts` is true only for `agentScope === "owned"`. The enterprise IM proxy path must not enter that branch. An older auto grant is not a confirm for this scenario.

The compatibility allow is `resolveEmployeeOperationalAuthorization` in `user-operational-identity-enterprise-authorization.ts`. Its header says an employee with no seat binding is left on owner-plus-grant behavior, and the test "allows an enterprise employee with no seat binding (no false deny)" expects `decision: "allow"` with no `seatId`. The enterprise IM proxy path must not reuse that allow. Missing seat or missing enterprise policy is a deny.

For this workplace identity, both screens write the grant through one API. That does not require migrating every historical provider onto one store in the same change. Other providers keep their current resolve behavior until a separate evaluation changes them.

The same slice establishes the authorization decision entry from the joint-gate section. Callers in slices 3 and 4 use this entry. Distinct outcomes include allow, deny because the enterprise connection is disabled, deny because enterprise policy is missing, deny because the seat is missing, deny because the seat binding is ambiguous, and deny because the delegation is missing, expired, or does not include the action. There is no personal-use outcome. A missing grant is a deny that does not insert a row.

Tests:

1. An owned robot with no employee confirm: the first resolve and the first execute both refuse, and the grant count does not change.
2. After the employee confirms that robot: only that robot may perform the allowed actions.
3. After revoke: a later resolve does not auto-create a grant.
4. Missing seat or missing enterprise policy: the call does not pass through the legacy compatibility allow.
5. Project Assistant and Knowledge Assistant can hold different action sets on one connection. Revoking one does not revoke the other. A robot with no delegation cannot read through a sibling grant. Expired delegations fail. Two delegations that match one conversation do not resolve by first match.

### Slice 3. Controlled read and draft

Before the first read, call the slice 2 decision entry. The minimal enterprise gate must already pass. Do not wait for slice 6.

The robot reads only the APIs and resource types the slice 1a checklist marked Measured, using the connection the triggering employee explicitly chose. It drafts progress with sources and update times. This slice is employee-triggered. Continuous acquisition is slice 5.

If the checklist shrunk the scene to designated docs, this slice does not call a group-history API.

Audit the read (employee, robot, connection, delegation version, resource ids, time). No send.

Tests: a doc or group outside the delegation is refused. Text inside a group message does not add a resource. An out-of-scope link inside an in-scope doc is not fetched. App-token fallback does not run when the user token is invalid. A missing enterprise seat denies the read.

### Slice 4. Execute as the employee

Before send, call the slice 2 decision entry again. Do not reuse a decision cached when the draft was written.

The employee confirms the exact content and the exact recipients. The robot then calls the send API the slice 1a checklist Measured, with the user token, only when that checklist recorded `im:message.send_as_user` on the token and the recipient-observed identity was the employee. The call returns the platform message id, or a visible error. The confirm record is bound to that content and those targets and is stored as in the durable-confirm rule. A retry, a timeout, or a duplicate callback must not send a second message. Timeout becomes `outcome unknown` until reconciliation or human handling. Changing content or targets after confirm requires a new confirm.

If the checklist did not Measure send-as-self, stop and tell the employee the message would go out as the bot, or require them to send it themselves. Do not report a bot send as send-as-self.

Audit the confirm and the platform result id, including `outcome unknown` and the reconciliation result.

Tests: recipient mismatch fails. Cross-tenant connection fails. Two deliveries of the same confirm produce one platform send. A restart still finds the confirm and does not blind-resend. Knowledge Assistant with send disabled cannot call this entry. Revoke recorded before the execution entry blocks the send. A send the platform already accepted is reconciled after revoke and is not launched again.

### Slice 5. Continuous work and multi-employee coordination

Continuous work starts only after slice 1a has verified a continuous message acquisition mechanism. That mechanism may be platform push, or an official incremental poll that meets the permission, rate limit, and latency written on the checklist. Do not bind this slice to push alone, and do not rule polling out before the checklist.

The event speaker is not the authorizer. The task uses the delegation assigned in advance to that conversation. If more than one delegation matches, stop automatic send until a person assigns one. Implement primary robot selection inside that chosen delegation, dedupe, claim, echo suppression, and human takeover. Draft-then-confirm stays the default until the employee explicitly chooses limited auto on that delegation.

If the verified mechanism only returns @bot messages, the status UI says that. It does not describe a full employee inbox.

Tests from the acceptance list for two robots, two employees in one group, double reply, takeover, and revoke of pending work land here.

### Slice 6. Duty enrichment and org sedimentation

Enrich the authorization entry from slice 2 with duty detail: role, classification, and any duty object the enterprise already stores. This is not the first time enterprise authorization is consulted. Slices 3 and 4 already deny when the minimal enterprise gate fails.

From tasks that completed with a platform result, a person may extract a reviewable, versioned process candidate (steps, template, verification case) through the existing human-gated skill path (`pattern-detection.publish-draft-skill` and skill lifecycle `reviewing`).

What the org may keep: the method, the template, the steps, and the verification cases for project follow-up.

What the org does not keep: the employee access token, the refresh token, private conversation content, and the personal delegation. Another employee who installs the same skill still connects their own work account and creates their own grants. Publish does not copy those.

## Acceptance criteria for the first closed loop

The loop is Feishu and Project Assistant, on the scene the slice 1a checklist allowed. All of these must hold before the loop is called done:

- An admin enables Feishu on the existing 企业通道 page. The same employee then sees Feishu on 个人设置「授权」, not on a new page and not under a label 系统设置「授权」, and authorizes without typing the app secret. On 机器人「运营授权」 they check that same identity id for Project Assistant and press 确认授权. After a later content confirm, send uses the employee identity the checklist Measured. Disabling Feishu on 企业通道 stops new execution for every employee under that connection and removes it as a usable 企业身份. Revoking that employee on 个人设置「授权」 stops only their grants. Unchecking one robot on 运营授权 leaves the other robot. The grant the robot screen wrote is the grant the execution entry reads.
- Employee A authorizes robot R1. R1 can work inside the scoped project. Robot R2, which was not delegated that connection, cannot borrow it.
- The same account can authorize two robots with different read, write, and send limits. One inbound message never produces two external replies.
- Employees A and B are both connected and both can see the same project group. Work does not run twice. A request from B does not use A identity. A private context does not appear in a reply sent for B. Records for the two tasks differ by connection and delegation, not only by chat id.
- The identity recipients see matches the product display. If send-as-self is refused by Feishu, the product says so and does not report success as the employee.
- Groups, docs, and recipients outside the delegation are refused. A connection for another Feishu tenant is refused. Text inside a group message cannot widen the grant. The read uses only APIs the checklist marked Measured.
- A missing enterprise connection, a missing seat, a missing enterprise policy, or an ambiguous seat binding denies the read and the send. There is no personal-use bypass, and there is no compatibility allow for a missing seat or a missing policy.
- An owned robot with no confirm is refused on the first resolve and the first execute, and no grant row is written. After revoke, the next resolve does not auto-create a grant. Pressing 确认授权 on the screen is not a substitute for that execution check. Other identity providers keep their current auto-grant behavior until a separate evaluation changes them.
- Actions in draft-then-confirm mode wait for the employee confirm of that content and those targets. Retries, timeouts, and duplicate callbacks do not double-send. A timeout stays `outcome unknown` until reconciliation or human handling. The confirm record is still there after a process restart.
- Two robots refreshing one connection do not overwrite each other token.
- After revoke, an invalid token, or loss of membership, the execution entry accepts no new call. A request the platform already accepted is recorded and reconciled, not recalled by promise. OpenBot disconnect deletes local credentials and does not claim Feishu revoked the grant unless a platform revoke happened. Restore is a new connect or a new delegation, not a replay of the cancelled queue.
- Every action traces to the employee, the robot, the connection, the delegation version, the trigger message, the target, the confirm record, and the external result. A successful bind screen is not a completed business action.

## What remains intentionally unchanged

- Fabric stays off unless a deployment sets `OPENBOT_FABRIC_ENABLED` or `gateway.fabric.enabled`.
- `data_capability` invoke stays knowledge-object-only. Agent runtime does not request `ConnectorAction`.
- Sandbox default stays off. Managed Enterprise shared-process startup refusal stays fail-closed.
- Public-bot ingress stays the app identity. It is not rewritten into a fake employee session.
- DingTalk and WeCom are not given a user-proxy send path in this plan.
- Desktop automation is not a dependency.
- This document does not implement any slice. Access order starts at 企业通道. Employee binding is 个人设置「授权」. Per-robot use is 机器人「运营授权」. The new workplace identity has one grant. Historical providers are not all migrated first. The enterprise IM path does not auto-create grants. No product code until the owner green-lights it.
