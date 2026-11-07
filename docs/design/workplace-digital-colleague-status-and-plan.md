# Workplace digital colleague: status and plan

**Scenario:** 岗位上有可协作的数字同事：进企微/飞书/钉钉，按职责拿数、办事、留痕，能力可随组织沉淀。

**Repo:** `flykingvip-cloud/openbot-vp` (`@upbeyond/openbot`)
**Baseline:** `main` at `658bb327` (merge of #247, 2026-11-05)
**Nature:** Code-grounded inventory and an ordered implementation plan. This document does not change runtime behavior.
**Date:** 2026-11-07

A digital coworker, in this scenario, is a seat-bound agent that shows up in WeCom, Feishu, or DingTalk, reads data inside its duty grants, acts through the governed enterprise-data bridge, leaves an operator-visible trail, and leaves a durable org-level capability behind. The five legs below are judged only against that path.

## How to read the evidence

Quotes are from the tree at the baseline SHA. Paths are repo-root relative. "Product IM" means WeCom, Feishu, and DingTalk. WebChat and the enterprise console are adjacent control surfaces, not substitutes for those three channels. Inherited consumer adapters (Telegram, Discord, Slack, WhatsApp, and the rest of `CHAT_CHANNEL_ORDER`) are noted only where they still shape product routing.

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

## 1. Enter WeCom, Feishu, and DingTalk

**Status: Partial.** Ingress, enterprise credential forms, and route-to-agent dispatch exist. The inbound turn is still a channel session, not a digital-employee seat. Package identity and the core channel order still treat product IM as an add-on beside leftover consumer adapters.

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

**Status: Partial.** Seat grants, semantic objects, and an authorization-aware planner exist for a signed-in employee session. An IM turn does not enter that session, so duty does not scope what the coworker reads.

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

Severity is for this scenario only. P0 means the scenario sentence is false until this moves. P1 means the scenario is visibly incomplete. P2 means identity or hygiene that misleads operators but does not by itself block a later slice.

| Leg | Status | Severity | Evidence | Gap |
| --- | --- | --- | --- | --- |
| Enter WeCom / Feishu / DingTalk | Partial | P1 | Extensions monitor to `resolveAgentRoute` to `dispatchReplyFromConfig`. Console writes `t_<tenant>_default`. | Message arrives and an agent replies. The turn has no seat. `CHAT_CHANNEL_ORDER` and `@openclaw/*` package ids still present product IM as secondary. DingTalk uses the compat SDK. No ownership check in `scripts/`. |
| Fetch by duty | Missing on the IM path. Partial as a console RPC. | P0 | Planner and `isCapabilityGrantedForSeat` require `resolveTrustedEnterpriseDataExecutionContext`. `get-reply-run.ts` only calls `resolveSeatTurnContext` with gateway employee ids. IM context has none. `resolveAgentRunEntitlementScope` is not called there. | No server-derived duty scope on the coworker turn. IM sender is not an employee. Preflight text points at knowledge search, not grants. |
| Do the work on the governed bridge | Missing for IM. Working for signed-in `enterprise-data.invoke`. | P0 | Data gateway applies grant, scope, approval, masking, audit. Agent tool invoke returns `knowledge-object-only`. Feishu tools call Feishu APIs directly. Sandbox mode defaults to `"off"`. Fabric default off does not change tool execution. | IM work is either a chat reply, an ungated Feishu API tool, or a normal agent tool. It is not a seat-scoped governed action. Opening connector invoke from the model would weaken the red line and is not the fix. |
| Leave a trail an operator can open | Missing for IM. Partial for console invoke. | P0 | `enterprise-data.audit.invocations.list` and `audit.trace.get` read data-gateway audits. IM dispatch never writes them. Fabric trace is opt-in. | After a WeCom/Feishu/DingTalk message, the operator can see channel connectivity and the chat transcript. They cannot open a governed action trace for that message. |
| Settle a capability into the org | Missing for this flow. Partial as a human lifecycle. | P1 | Skill visibility includes `enterprise`, defaulting to `reviewing`. Publish-draft-skill is human-gated and not auto-installed. Capability governance store is a view. | A successful coworker run leaves a session. It does not leave an org skill or a new granted capability. |

## Implementation plan

Do these in order. Each slice should be its own reviewable change. Do not start slice 2 until slice 1 has tests that fail when the IM turn is unbound or when a client tries to supply the seat.

### Slice 1 (do this first): stamp a server-derived seat on the product-IM turn, and audit that stamp

**Why this one.** Legs 2, 3, and 4 all stop at the same missing subject. The planner, the grant resolver, and the audit list already know what to do with a trusted seat. The IM monitors never produce one. `resolveAgentRunEntitlementScope` already implements the lookup the entitlement design reserved for external channel inbound, and it fail-closes to null. The reply path does not use it.

**Behavior.** After `resolveAgentRoute` for `wecom`, `feishu`, or `dingtalk` only:

1. Load the seat scope with `resolveAgentRunEntitlementScope({ agentId: route.agentId })`. Use the tenant-scoped seat store when the channel account id is the enterprise form `t_<tenant>_default` and shared tenant addressing is already enabled. Do not parse the IM sender id into an employee id.
2. If the lookup is null, or more than one active agent binding matches, leave the turn unbound. Reply still works. Write an audit row `seatBinding: "unresolved"` so the operator can see the miss.
3. If exactly one seat matches, attach server-derived `tenantId`, `seatId`, and `employeeId` (when the seat has `currentEmployeeId`) onto the reply context through the existing gateway-client fields `get-reply-run.ts` already reads. Do not accept those fields from the channel payload.
4. Write one enterprise-data invocation-audit-shaped row, or a sibling event the existing `enterprise-data.audit.invocations.list` can return, with channel, account id, agent id, seat id, and `seatBinding: "bound" | "unresolved"`. No payload from the user message beyond a hash or length. Fabric stays off.

**Files likely touched.**

- A small helper next to `src/gateway/model-entitlement/resolve-agent-run-scope.ts` or `src/plugin-sdk/inbound-reply-dispatch.ts` that product monitors call. Prefer one helper over three copies in the extensions.
- `extensions/wecom/src/monitor.ts`, `extensions/dingtalk/src/monitor.ts`, `extensions/feishu/src/bot.ts` to call it before dispatch. Keep Feishu dynamic-agent creation from inventing a seat.
- `src/auto-reply/reply/get-reply-run.ts` only if the helper's output is not already visible as `GatewayClientPlatformUserId` / tenant. Prefer feeding the existing `resolveSeatTurnContext` inputs over a second resolver.
- `src/gateway/enterprise-data/audit-runtime.ts` only if the current invocation event cannot represent a non-action binding record. Do not invent a second store if `recordInvocationAudit` can carry a distinct action key such as `product-im.seat.bind`.

**Tests.**

- Unit: unique agent binding stamps tenant and seat; missing binding leaves fields empty; two bindings leave fields empty.
- Unit: WeCom, Feishu, and DingTalk context builders include the stamp only from the helper, and a forged `seatId` on the inbound payload is ignored.
- Unit: the audit writer is called once per inbound with `bound` or `unresolved`, and `enterprise-data.audit.invocations.list` returns it for an enterprise admin.
- Regression: `data_capability` invoke still returns `knowledge-object-only`. `enterprise-data.invoke` still requires the trusted employee session and still rejects client identity fields.

**Risks.**

- A stamp that later slices treat as "the IM sender is this employee" would let any person who can message the bot act as the seat occupant. Slice 1 must record attribution for the agent that is already bound to the seat. It must not authorize connector actions, and it must not copy `SenderId` into `employeeId`.
- Ambiguous `defaultAgentAssetIds` across seats. Fail closed on more than one match.
- Using the global seat store in a multi-tenant process would attach the wrong tenant. Use the tenant from the enterprise account id only when that account id was produced by the console helper, and otherwise leave the turn unresolved rather than guessing.

**Out of scope for slice 1.** Opening `data_capability` invoke. Calling `enterprise-data.invoke` from the model. Enabling Fabric. Changing sandbox defaults. Reordering `CHAT_CHANNEL_ORDER`. Renaming `@openclaw/*` packages. Adding a DingTalk plugin-sdk slice. Editing `docs/zh-CN/**`. Telegram, Discord, and other inherited channels.

### Slice 2: duty-scoped read on that stamped turn

Call `planDataAccess` / `buildAgentContextPack` with the slice-1 seat context inside the product-IM reply, and pass the pack to the model as data the seat is allowed to know. Keep `executeDataPlan` and `data_capability` invoke on `knowledge-object-only`. Add a test that a capability the seat is not granted does not appear as readable, and that a granted capability still does not return connector rows.

Do this only after slice 1. Without the stamp, the planner returns `no-seat`.

### Slice 3: operator-visible trail for later governed acts

Point the enterprise data UI at the slice-1 binding events and, once any future act exists, at `enterprise-data.audit.trace.get`. Do not turn Fabric on to get this. The enterprise-data audit store is already the operator surface (`invocations.list`, admin `trace.get`).

### Slice 4: one sanctioned act, still not a free tool

If product requires the coworker to change an external system, add a single gateway entry that runs `invokeEnterpriseDataAction` under the slice-1 seat context, with the existing grant, scope, masking, and approval checks, and with a new trust attestation distinct from a raw tool argument. Keep `assertNoClientExecutionIdentity`. Do not flip `data_capability` invoke to call connectors in the same change. Feishu doc/drive tools stay out of this slice until they are either classified as channel delivery or routed through the same grant check.

### Slice 5: org sedimentation, human-gated

After a governed act succeeds, offer a draft skill or capability candidate through the existing `pattern-detection.publish-draft-skill` / skill lifecycle path. Enterprise visibility stays `reviewing` until a person approves. Do not auto-install on the robot. Do not write the candidate from the chat model.

### Parallel, not blocking

A channel-ownership check (product ids `wecom|feishu|dingtalk` versus `CHAT_CHANNEL_ORDER`, DingTalk SDK slice, freeze inherited `src/<channel>` feature adds) is the architecture P0 for product identity. It does not make the coworker duty-scoped. Schedule it beside slices 1-3, not instead of them.

## What remains intentionally unchanged

- Fabric default stays off until a deployment sets `OPENBOT_FABRIC_ENABLED` or `gateway.fabric.enabled`.
- Agent runtime does not request `ConnectorAction`.
- Sandbox default stays off. Managed Enterprise shared-process startup refusal stays fail-closed.
- IM sender ids are not employee ids.
- This document is the inventory and the plan. It does not implement any slice.
