# Platform Pricing / Gateway Instability Case Report

## Summary

This document summarizes the current investigation into the local control-plane instability observed on `127.0.0.1:18789`, especially when opening the platform pricing surface.

Observed user-visible symptoms:

- Browser console resource failures:
  - `index-Dk4qHmtQ.css:1 Failed to load resource: net::ERR_CONNECTION_RESET`
  - `index-*.js:1 Failed to load resource: net::ERR_CONNECTION_RESET`
  - `favicon.svg/.ico/.png` alternating between `ERR_CONNECTION_RESET` and `ERR_CONNECTION_REFUSED`
- Enterprise / platform surfaces intermittently show load failures or require manual refresh
- Local gateway restarts frequently and becomes unavailable during short windows

Current diagnosis:

1. There were two overlapping failures:
   - a broken recovery LaunchAgent (`ai.openbot.gateway.recovery`) in endless restart failure
   - the main gateway (`ai.openbot.gateway`) repeatedly crashing with Node OOM
2. The recovery LaunchAgent issue has been resolved.
3. The main unresolved issue is a request storm on `platform-plan-bundle.overview`, most likely from a browser-side runtime loop tied to the platform pricing experience.
4. Multiple mitigation layers were added, and the dominant request source is now identified as `platformPricing.loadPlans`.
5. The system has progressed from unprotected crash behavior into a gateway-protected mitigation phase, but the root trigger has not yet been fully eliminated.

## Primary Symptoms

### Browser-side symptoms

- Static assets on `18789` fail intermittently
- The same host alternates between:
  - serving assets normally
  - closing connections mid-flight
  - refusing connections entirely

### Launchd/runtime symptoms

`launchctl print gui/$UID/ai.openbot.gateway` showed:

- `successive crashes = 324` and later higher
- `last terminating signal = Abort trap: 6`

`launchctl print gui/$UID/ai.openbot.gateway.recovery` showed:

- extremely high run count
- `last exit code = 1`

This matched the alternating browser errors:

- `ERR_CONNECTION_RESET`: process dies during response
- `ERR_CONNECTION_REFUSED`: restart gap with nothing listening

## Root Cause Timeline

### Root Cause A: broken recovery LaunchAgent

The recovery LaunchAgent plist at:

- `~/Library/LaunchAgents/ai.openbot.gateway.recovery.plist`

used:

```xml
/usr/local/bin/node --import tsx /Users/daniel/AI项目/openbot/src/entry.ts gateway --port 18789
```

But runtime logs repeatedly showed:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from /
```

Meaning:

- the recovery agent could never actually start
- launchd `KeepAlive` kept relaunching it
- it generated endless noise and did not provide real recovery

### Root Cause B: main gateway OOM

The main gateway repeatedly crashed with OOM.

Earlier crash evidence:

- `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
- initial stacks strongly involved repeated string/buffer work while responding

Later, after mitigation work narrowed the issue, crash stacks converged on:

- `JsonStringify`
- `Utf8Length`
- `SlowByteLengthUtf8`
- string flattening / serialization paths

This shifted confidence from:

- "construction of overview objects is too expensive"

to:

- "the same large overview response is being requested and serialized repeatedly in a short window"

## Confirmed High-Signal Evidence

### 1. Same connection, many repeated identical RPCs

Gateway logs repeatedly showed the same connection ID issuing a large number of:

- `platform-plan-bundle.overview`

within a very short time span.

Examples observed:

- dozens of `platform-plan-bundle.overview` responses within ~200ms
- later, after server-side dedupe, many responses sharing almost identical latency (~1s, ~2.7s, ~3.1s)

Interpretation:

- requests are repeated from one active browser connection
- many of them are waiting on the same shared underlying work
- but the request source keeps firing instead of stopping after one load

### 2. Browser-side changes alone did not fully stop the storm

Client-side mitigations were added in:

- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/capability/platform-plan-bundle/gateway-client.ts`

but logs still showed repeated `overview` calls on a single connection.

Interpretation:

- the source may be broader than one local function
- or already-open/stale browser pages continue running old logic
- or another control surface is also calling the same RPC

### 3. Server-side shared build worked, but did not solve everything

Server-side dedupe was added to:

- `src/gateway/server-methods/platform-plan-bundle.ts`

This appears to have worked because large batches of repeated `overview` responses later showed near-identical duration.

Interpretation:

- repeated requests no longer each rebuild the full overview
- but they still each incur response work
- repeated serialization/response emission remains expensive enough to crash the process

## Remediation Attempts Already Performed

### A. Removed broken recovery LaunchAgent

Actions taken:

- booted out `ai.openbot.gateway.recovery`
- removed `~/Library/LaunchAgents/ai.openbot.gateway.recovery.plist`

Follow-up code changes:

- `src/daemon/launchd.ts`
- `src/daemon/launchd.test.ts`

Effect:

- broken recovery loop removed
- launchd recovery noise reduced
- this issue is considered resolved

### B. Platform pricing page load controls

Changes in:

- `ui/src/ui/ports/platform/pricing/page.ts`

Mitigations added:

- `loadPlans()` single-flight guard
- reconnect-trigger dedupe
- prevent plan detail version loading when the plan has not yet resolved
- rerender behavior adjusted to avoid unnecessary navigation/event loops where possible

Effect:

- reduced confidence that the page is blindly self-triggering in some local cases
- did not fully eliminate observed `overview` request storm in live runtime

### C. Browser-side overview request cache

Changes in:

- `ui/src/ui/capability/platform-plan-bundle/gateway-client.ts`

Mitigations added:

- per-`GatewayBrowserClient` in-flight reuse
- short TTL cache for `platform-plan-bundle.overview`

Effect:

- should suppress repeated calls from the same client within a short interval
- logs still show continued repeated requests, suggesting either:
  - requests are not actually going through the same expected path only
  - or stale/open browser code is still active
  - or another mounted component/source continues requesting

### D. Server-side shared overview construction

Changes in:

- `src/gateway/server-methods/platform-plan-bundle.ts`

Mitigations added:

- shared in-flight overview computation
- shared serialized overview payload preparation

Effect:

- repeated calls seem to align on shared latency
- repeated response activity still remains high

### E. Attempted raw-response fast path

Changes were started in:

- `src/gateway/server/ws-connection.ts`
- `src/gateway/server/ws-connection/message-handler.ts`

Goal:

- avoid repeated generic `JSON.stringify({ type:\"res\", ... payload ... })` for oversized repeated responses

Status:

- wiring was partially added
- a runtime miswire produced `sendRaw is not defined` on one restart cycle
- later source inspection showed the parameter wiring was corrected in source
- however this optimization path should still be treated as incomplete and needing expert review

### F. `loadPlans(force)` semantics and reconnect narrowing

Additional front-end control-surface hardening was added in:

- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/app-gateway.ts`
- `ui/src/ui/app-settings.ts`

Mitigations added:

- `loadPlans(client, { force })` contract introduced
- already-loaded short-circuit when the same client/epoch is still valid
- `packages` subtab no longer unconditionally reloads pricing data
- reconnect-triggered refresh removed from generic `refreshActiveTab()`
- reconnect refresh now routes through `onHello`
- reconnect debounce and in-flight / loading guard

Effect:

- reduces legitimate re-entry paths into `platformPricing.loadPlans`
- preserves explicit refresh semantics for reconnect/manual/business mutations

### G. Gateway-side per-connection suppressor

Additional gateway protection was added in:

- `src/gateway/server-methods/platform-plan-bundle.ts`

Mitigations added:

- per-connection short-window request counting for `platform-plan-bundle.overview`
- lightweight `UNAVAILABLE` response when repeated calls exceed threshold
- `retryable + retryAfterMs` on suppress responses
- per-connection in-flight suppression to avoid multiple simultaneous heavy responses

Effect:

- repeated `overview` storms are now actively suppressed
- the gateway no longer needs to serialize/send full payloads for every repeated request in a burst
- this is the core reason the incident can now be classified as mitigated rather than active/unbounded

### H. Browser-side soft failure handling for rate limiting

Additional browser retry behavior was updated in:

- `ui/src/ui/ports/platform/pricing/gateway-load-retry.ts`
- `ui/src/ui/ports/platform/pricing/page.ts`

Mitigations added:

- pricing treats gateway rate-limit responses as transient rather than hard terminal failure
- `retryAfterMs` is surfaced to the UI as a soft backoff notice
- reconnect refresh is blocked while soft retry cooldown is active

Effect:

- avoids immediate "hard failure" UX when the gateway is intentionally suppressing repeated reads
- keeps the system in a softer degraded mode rather than oscillating between retry and red-error states

## Current State Assessment

### Resolved

- broken recovery LaunchAgent loop

### Partially mitigated

- repeated overview construction
- some pricing-page local reload loops
- some same-client repeated request patterns
- browser-side attribution now identifies the dominant source as `platformPricing.loadPlans`
- `loadPlansInFlight` race window has been closed by assigning the in-flight lease before rerender
- pricing reconnect refresh has been narrowed from generic `refreshActiveTab()` to `onHello` only
- `ensureLoaded()` now respects both `loadPlansInFlight` and transient-retry state
- `loadPlans(force)` semantics now distinguish ordinary loads from explicit refreshes
- pricing-side retry handling now treats gateway rate limiting as soft/transient
- gateway-side per-connection suppressor is active and observable in runtime logs

### Current Incident Phase

Current expert-aligned phase classification:

- **Mitigated (gateway-protected) — root cause open**

Interpretation:

- root trigger still exists in some runtime/session paths
- but the gateway now has active suppression and retry semantics that materially reduce blast radius
- the incident should not be considered closed until fresh-session validation proves the trigger is effectively eliminated

### Not resolved

- single-connection `platform-plan-bundle.overview` request storm
- formal proof that fresh single-tab pricing no longer reproduces the storm
- stable serving of `18789` under platform pricing traffic

## Files Touched During Investigation

Code changes directly related to this incident:

- `src/daemon/launchd.ts`
- `src/daemon/launchd.test.ts`
- `src/gateway/server-methods/platform-plan-bundle.ts`
- `src/gateway/server-methods/platform-plan-bundle.test.ts`
- `src/gateway/server/ws-connection.ts`
- `src/gateway/server/ws-connection/message-handler.ts`
- `ui/src/ui/capability/platform-plan-bundle/gateway-client.ts`
- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/views/platform-plan-model-binding-section.browser.test.ts`

## High-Confidence Current Hypotheses

### Updated Root Attribution

Browser-side debug instrumentation now shows the primary request source is:

- `platformPricing.loadPlans`

Secondary sources observed:

- `platformPricing.loadVersions`
- `platformPricing.togglePlanModelBinding`

The secondary paths already show `cache-hit` behavior in browser-side tracing, so the dominant residual issue is repeated `loadPlans()` entry.

### Updated Runtime Interpretation

The remaining storm is no longer best explained by hidden components.

Current best explanation:

- a single live pricing connection repeatedly re-enters `platformPricing.loadPlans`
- server-side shared build helps equalize latency
- browser-side cache suppresses many `loadVersions` / mutation-follow-up paths
- but the main `loadPlans` source still fires often enough to keep pressure on the gateway

Latest runtime evidence shows a more nuanced state:

- old/live pricing connections can still burst `platform-plan-bundle.overview`
- gateway-side suppression now activates and returns lightweight `UNAVAILABLE` responses with `retryAfterMs`
- newer/fresher post-restart sessions often show healthy RPC startup sequences without immediately reproducing the same unbounded burst pattern

This indicates:

- residual root-cause paths remain open
- but the system is no longer in the earlier "unbounded crash amplification" phase

### Hypothesis 1: `platformPricing.loadPlans` still lacks final runtime entry containment

Observed/confirmed risk factors:

- reconnect path historically re-entered pricing loading too broadly
- `packages` subtab previously reloaded unconditionally
- `ensureLoaded()` and `loadPlans()` needed stronger inflight / loaded guards
- direct `loadPlans()` callers still need explicit `force` semantics

### Hypothesis 2: old/stale open tabs may still amplify the issue, but are no longer required to explain it

This remains possible operationally, but the incident no longer depends on that hypothesis. The current code and attribution evidence are sufficient to explain the storm inside the pricing runtime itself.

## Recommended Expert Review Focus

### 1. Finalize `loadPlans` semantics

Recommended actions:

- ensure `loadPlans(client, { force })` is the only supported contract
- short-circuit when `loaded && lastClient === client` unless `force === true`
- restrict force callers to explicit refresh / reconnect only
- stop unconditional `packages` subtab reload once already loaded for the same client

Target question:

- does any non-force path still re-enter `loadPlans()` after successful load?

### 2. Keep reconnect refresh isolated from ordinary render/route sync

Focus areas:

- `ui/src/ui/app-settings.ts`
- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/app-gateway.ts`

Target question:

- can reconnect-triggered pricing refresh occur anywhere except `onHello`?

Current implementation status:

- generic `refreshActiveTab(platformPricing)` path removed
- reconnect now routes through `app-gateway.ts` `onHello`
- additional hardening now present:
  - `loadPlansInFlight || state.loading` guard
  - short reconnect debounce
  - soft retry cooldown guard via `retryAfterMs`

### 3. Add stronger server-side protection for large repeated read RPCs

Even before root cause is fully removed, the gateway should not die from a repeated read endpoint.

Potential protective measures:

- short TTL response cache for `platform-plan-bundle.overview`
- per-connection identical-RPC rate suppression
- payload size / serialization diagnostics
- circuit breaker when the same connection requests the same read method excessively within a short window

Current implementation status:

- shared overview construction is in place
- shared serialized payload preparation is in place
- per-connection short-window suppression is now in place
- per-connection in-flight suppression is now in place
- remaining recommendation: add explicit lifecycle cleanup / observability polish for long-running windows

## Validation Performed

Passing targeted validations:

- `pnpm exec vitest run src/daemon/launchd.test.ts`
- `pnpm exec vitest run src/gateway/server-methods/platform-plan-bundle.test.ts`
- `pnpm exec vitest run ui/src/ui/views/platform-plan-model-binding-section.browser.test.ts`

Additional diagnostic validation:

- browser-side debug attribution in `platform-plan-bundle` gateway client confirms dominant source = `platformPricing.loadPlans`
- `platformPricing.loadVersions` / `togglePlanModelBinding` are observed as cache-hit candidates and are no longer primary suspects
- recent code review confirms the following high-value fixes are present in source:
  - `loadPlansInFlight` lease assigned before any rerender
  - `refreshPlatformPricingAfterGatewayConnect()` removed from generic `refreshActiveTab()`
  - pricing reconnect refresh now triggered from `onHello`
  - `loadPlans(force)` semantics added for explicit refreshes
  - gateway suppress responses now carry `retryable + retryAfterMs`

Additional runtime validation:

- repeated `platform-plan-bundle.overview` bursts are now observed with:
  - `suppressedRepeatedOverview=true`
  - `retryAfterMs`
  - lightweight `UNAVAILABLE`
- this confirms the gateway is actively protecting itself instead of blindly serializing every oversized repeated response

Pricing browser surface status:

- `ui/src/ui/ports/platform/pricing/page.browser.test.ts`
- 35/36 or 34/36 style status across intermediate steps
- one long-standing `platform-plan-bundle.create` expectation remains flaky/unaligned
- that remaining test is not currently considered the main blocker for this incident

## Bottom-Line Assessment

This incident is no longer a vague "gateway unstable" problem.

It is now a narrowed platform pricing/control-surface incident with:

- one resolved recovery-service failure
- one still-active browser/runtime request storm whose dominant attributed source is `platformPricing.loadPlans`
- a gateway protection layer that now actively suppresses repeated large-response handling

The most valuable next step is no longer generic attribution work; it is the final semantic closure of:

- `loadPlans(force)` / already-loaded short-circuit behavior
- reconnect-only refresh semantics
- `packages` subtab reload behavior
- fresh single-tab pricing validation to determine whether the root trigger remains for new sessions or only legacy/live sessions
