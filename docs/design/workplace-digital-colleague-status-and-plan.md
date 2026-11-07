# Workplace digital colleague: status and plan

**Scenario:** An employee connects a work account they already have in Feishu, DingTalk, or WeCom, then authorizes one or more selected robots to participate in existing work inside that grant, using the employee work identity. Methods that survive review can settle into the organization. Enterprise public bots are a separate mode.

**Repo:** `flykingvip-cloud/openbot-vp` (`@upbeyond/openbot`)
**Baseline:** `main` at `658bb327` (merge of #247, 2026-11-05). Plan revised 2026-11-07 on the same evidence plus official platform docs cited below.
**Nature:** Code-grounded inventory and an ordered implementation plan. This document does not change runtime behavior.
**Date:** 2026-11-07

## Product experience to deliver

Employees already have work identity, contacts, groups, and work resources in Feishu, DingTalk, and WeCom. OpenBot lets an employee connect that work account, then authorize specific robots to act inside the grant.

Example. An employee connects Feishu. They allow Project Assistant to handle one named project group, read related docs, draft progress, and send on their behalf. They allow Knowledge Assistant to organize docs and not to send messages. Each grant can be paused or revoked on its own.

Spine:

```
Connect employee work account
  -> grant proxy authority to specific robot(s)
  -> controlled execution in existing work scenes
  -> auditable trail
  -> settle verified methods as org capability
```

Effective permission is the intersection of four gates:

```
platform grant
  ∩ employee active delegation
  ∩ enterprise duty policy
  ∩ resource and target constraints
```

Connecting an account does not open every scope to every robot. An enterprise job grant does not substitute for the employee proxy of their own work identity. Platform OAuth typically grants the app. OpenBot then delegates that connection to specific robots. A new robot does not require a fresh platform OAuth.

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

## Gap table

Severity is for the employee-identity proxy. Public-bot ingress is listed so it is not mistaken for that proxy. P0 means the closed loop is false until this moves. P1 means the loop is visibly incomplete. P2 is hygiene that does not unblock the loop.

| Leg | Status | Severity | Evidence | Gap |
| --- | --- | --- | --- | --- |
| Enterprise public bot ingress | Partial, and it is a separate mode | P2 for the proxy. Do not treat it as P0 progress on the proxy. | Extensions monitor to `resolveAgentRoute` to `dispatchReplyFromConfig`. Console writes `t_<tenant>_default`. | A bot can reply. The platform identity is the app. `CHAT_CHANNEL_ORDER` and `@openclaw/*` package ids still present product IM as secondary. DingTalk uses the compat SDK. |
| Connect employee work account | Missing | P0 | `user-operational-identity-providers.ts` lists `feishu-personal` as `rolloutTier: "deferred"`, `registrationReady: false`, empty actions, hint "当前仅支持企业 Bot/App 连接". Enterprise operational-identity catalog test excludes `feishu`, `wecom`, and `dingtalk`. Feishu client is `appId` + `appSecret` (`extensions/feishu/src/client.ts`). DingTalk token call is `POST /v1.0/oauth2/accessToken` with `appKey`/`appSecret` (`extensions/dingtalk/src/api.ts`), which is the app token, not `userAccessToken`. | No trusted bind of platform enterprise + platform user + OpenBot employee + granted scopes. No status UI for connect, renew, or disconnect of a user credential. |
| Robot delegation | Missing | P0 | Seat asset bindings and `resolveAgentRunEntitlementScope` map an agent to a seat. They do not record which robot may use which employee connection, which actions, which resources, or when the grant expires. | Authorizing Project Assistant does not exist as data. A second robot can neither be granted a narrower scope nor be proven unable to borrow the first grant. |
| Controlled read and send in an existing work scene | Missing for user identity. Public bot tools are a different identity. | P0 | `data_capability` invoke stays `knowledge-object-only`. Feishu doc/wiki/drive tools use the app client. WeCom and DingTalk monitors send the bot reply. | No server entry that loads a user credential, checks delegation, and calls the platform as that employee. Group text must not widen grants. |
| Trail of a proxy action | Missing | P0 | `enterprise-data.audit.invocations.list` records data-gateway invokes for a signed-in console session. Public-bot turns do not write it. Fabric is default off. | A proxy action must trace employee, robot, connection, delegation version, trigger, target, confirm record, and external result. "Bind success" is not business complete. That trace does not exist. |
| Settle a method into the org | Missing for this flow. Partial as a human skill lifecycle. | P1 | Skill visibility includes `enterprise` and defaults to `reviewing`. `pattern-detection.publish-draft-skill` is human-gated and not auto-installed. | A verified project follow-up can later become a reviewable method. Personal tokens, private conversation content, and personal delegations must not publish with it. Nothing extracts that method today. |
| Duty policy as a joint gate | Partial as console policy. Missing as a proxy gate. | P1 | Seat action grants and department/role policies exist for `enterprise-data.invoke`. Seat rules are guidance and do not enter Fabric decide. | Enterprise duty and employee delegation must both pass. Duty alone must not authorize use of the employee work identity. |

## Identity and authorization

Keep account connection and robot delegation as two records. Do not collapse them into `GatewayClientPlatformUserId`.

### Work account connection

A connection is a trusted bind among:

- the platform (Feishu, DingTalk, or WeCom)
- the platform enterprise (Feishu tenant, DingTalk `corpId`, WeCom `corpid`)
- the platform user (Feishu `open_id` / `user_id`, DingTalk `unionId` / `userId`, WeCom `userid`)
- the OpenBot employee (platform-auth user already bound to a membership)
- the platform-granted app scopes actually returned on the token (`scope` on Feishu refresh; the scopes the admin published plus the scopes the user consented)

The employee confirms this bind through the platform OAuth or the platform equivalent. An admin install or publish of the OpenBot app is a prerequisite on these platforms. It is not the employee consent, and employee consent is not admin install.

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
- Revoking one robot delegation does not revoke another robot on the same connection.
- Revoking or disconnecting the account blocks new calls and cancels or revalidates queued work for every robot on that connection. Calls already accepted by Feishu, DingTalk, or WeCom need a final-status read (`message_id`, `msgid`, or an error callback). Do not promise that in-flight platform operations can be recalled.
- Employee leave, loss of OpenBot membership, platform scope removal, and Feishu errors 20010 and 20037 invalidate execution that depended on that connection.
- Tokens stay in the server vault. Logs may store connection id, delegation version, and platform result id. They do not store access tokens, refresh tokens, or app secrets.

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

## Implementation order

Acceptance scene: "Project Assistant handles a named project group." Platform for this loop: Feishu self-built app. DingTalk and WeCom wait until their matrix row for the needed capability is Docs or better, and the product copy tells the truth about identity.

Each slice is its own change. Basic audit is part of slices 1 through 5, not a final UI project. `data_capability` action `invoke` stays `knowledge-object-only`. New platform actions go through an explicit server entry that holds the proxy execution context. They do not go through `enterprise-data.invoke` by opening generic connector calls, and they do not go through the current Feishu app-credential tools.

### Slice 1. Capability validation and connection

Confirm, in a target Feishu enterprise, the scopes the published self-built app can actually receive. Implement employee OAuth for `user_access_token`, including `offline_access` when refresh is required. Bind platform tenant, platform user, and OpenBot employee. Store tokens in the vault. Support refresh, disconnect, and a status UI (connected, needs reauth, revoked, admin publish missing).

Audit each connect, refresh, failure, and disconnect. Binding success is not the closed loop.

Tests: token values never appear in tool results or prompt builders. Refresh replaces the stored refresh token. Disconnect makes the next read fail. A second employee cannot attach their OpenBot user to someone else token.

Out of scope: robot send, DingTalk, WeCom user proxy, Fabric flag, sandbox default, `CHAT_CHANNEL_ORDER`.

### Slice 2. Robot delegation

The employee picks a robot, a conversation and resource scope, allowed actions, and a mode (read-only, draft-then-confirm, limited auto). The server stores a versioned delegation. Enforcement is on the server, not in the prompt.

Tests: Project Assistant and Knowledge Assistant can hold different action sets on one connection. Revoking one does not revoke the other. A robot with no delegation cannot read through a sibling grant. Expired delegations fail.

### Slice 3. Controlled read and draft

The authorized robot reads the approved project context with the user credential and produces a progress draft that cites sources and update times. v1 of this slice is employee-triggered. Continuous inbound is slice 5, and only after a measured answer to which Feishu events arrive for that named group.

Audit the read (employee, robot, connection, delegation version, resource ids, time). No send.

Tests: a doc or group outside the delegation is refused. Text inside a group message does not add a resource. App-token fallback does not run when the user token is invalid.

### Slice 4. Execute as the employee

The employee confirms the exact content and the exact recipients. The robot then calls Feishu `messages.create` with the user token when `im:message.send_as_user` is granted and the bot-in-group prerequisites on that page are met. The call returns the platform message id, or a visible error. The confirm record is bound to that content and those targets. A retry, a timeout, or a duplicate callback must not send a second message. Changing content or targets after confirm requires a new confirm.

If the target tenant cannot send as the user, stop and tell the employee the message would go out as the bot, or require them to send it themselves. Do not report a bot send as send-as-self.

Audit the confirm and the platform result id.

Tests: recipient mismatch fails. Cross-tenant connection fails. Two deliveries of the same confirm produce one platform send. Knowledge Assistant with send disabled cannot call this entry.

### Slice 5. Continuous work and multi-robot coordination

Only if the slice 1 measurement shows Feishu will keep delivering events for the approved project group. Implement primary selection, dedupe, claim, echo suppression, human takeover, and limited auto inside the delegation. Send remains the primary robot, and draft-then-confirm stays the default mode until the employee explicitly chooses limited auto for that delegation.

If the measurement says only @bot messages arrive, the status UI says that. It does not describe a full employee inbox.

Tests from the acceptance list below that cover two robots, double reply, takeover, and revoke of pending work land here.

### Slice 6. Duty and org sedimentation

Wire the proxy entry so enterprise seat and duty policy is a joint gate with the employee delegation. From tasks that completed with a platform result, a person may extract a reviewable, versioned process candidate (steps, template, verification case) through the existing human-gated skill path (`pattern-detection.publish-draft-skill` and skill lifecycle `reviewing`).

What the org may keep: the method, the template, the steps, and the verification cases for project follow-up.

What the org does not keep: the employee access token, the refresh token, private conversation content, and the personal delegation. Another employee who installs the same skill still connects their own work account and creates their own grants. Publish does not copy those.

## Acceptance criteria for the first closed loop

The loop is Feishu, named project group, Project Assistant. All of these must hold before the loop is called done:

- Employee A connects their Feishu account and authorizes robot R1. R1 can work inside the scoped project. Robot R2, which was not delegated that connection, cannot borrow it.
- The same account can authorize two robots with different read, write, and send limits. One inbound message never produces two external replies.
- The identity recipients see matches the product display. If send-as-self is refused by Feishu, the product says so and does not report success as the employee.
- Groups, docs, and recipients outside the delegation are refused. A connection for another Feishu tenant is refused. Text inside a group message cannot widen the grant.
- Actions in draft-then-confirm mode wait for the employee confirm of that content and those targets. Retries, timeouts, and duplicate callbacks do not double-send.
- After revoke, an invalid token, or loss of membership, further execution stops. Restore is a new connect or a new delegation, not a replay of the cancelled queue.
- Every action traces to the employee, the robot, the connection, the delegation version, the trigger message, the target, the confirm record, and the external result. A successful bind screen is not a completed business action.

## What remains intentionally unchanged

- Fabric stays off unless a deployment sets `OPENBOT_FABRIC_ENABLED` or `gateway.fabric.enabled`.
- `data_capability` invoke stays knowledge-object-only. Agent runtime does not request `ConnectorAction`.
- Sandbox default stays off. Managed Enterprise shared-process startup refusal stays fail-closed.
- Public-bot ingress stays the app identity. It is not rewritten into a fake employee session.
- DingTalk and WeCom are not given a user-proxy send path in this plan.
- Desktop automation is not a dependency.
- This document does not implement any slice.
