# Conversation Identity Context Convergence Design

## Architectural rule

Authentication identity is request state, not process state and not conversation text.

The implementation should have one forward-only flow:

```text
Authenticated GatewayClient
        |
        v
Frozen turn identity
        |
        v
Agent run identity
        |
        v
Tool execution identity
        |
        v
Authoritative tenant membership + seat policy
```

No downstream layer should reconstruct a stronger identity than its upstream layer supplied.

## Existing reliable components

Reuse these components rather than creating replacements:

- webchat identity hydration in `src/gateway/webchat-client-platform-identity.ts`;
- trusted membership resolution in `src/gateway/platform-auth/active-membership-scope.ts`;
- employee actor/seat projection in `src/gateway/employee-workbench-scope.ts`;
- complete temporary client builder in `src/gateway/knowledge/reply-gateway-client.ts`;
- turn fields already defined in `src/auto-reply/templating.ts`;
- enterprise operational identity policy/runtime in `src/gateway/enterprise-operational-identity-runtime.ts`.

## Current break location

`get-reply.ts` and `get-reply-run.ts` know `GatewayClientSessionEnterpriseId` and `GatewayClientSessionMembershipId`. `createOpenClawTools()` and `PiToolsOptions` expose only:

- `gatewayClientUser`;
- `gatewayClientSessionDomain`;
- `gatewayClientPlatformUserId`.

`createOperationalIdentityTool()` accepts the same reduced set and calls `buildKnowledgeReplyGatewayClient()` without enterprise or membership IDs, although that helper already supports both.

Queued/follow-up execution also selects only the reduced fields in `agent-runner-execution.ts` and related queue models.

## Target data flow

### 1. Freeze at turn boundary

Build an immutable execution identity after webchat hydration and authoritative tenant binding. Preserve absence as absence; never invent identity from environment or display text.

### 2. Carry one object

Replace repeated optional scalar parameters where practical with one context object. Transitional adapters are acceptable inside one PR, but there must be one canonical source object and no independent defaults.

### 3. Preserve through queues

Queue/follow-up serialization must include the trusted identifiers needed to reproduce authorization. Tests must cover a follow-up run, because the current loss can recur after the initial turn even if direct execution is fixed.

### 4. Build runtime client once

Seat-bound tools should receive either the complete execution identity or one already-built restricted `GatewayClient` view. Do not let each tool independently reconstruct identity from a different subset.

### 5. Resolve scope with precedence

Recommended precedence:

```text
valid authenticated employee context
-> explicit collaboration owner entitlement where the group policy requires it
-> unique enrolled-agent context for non-interactive/background execution
-> typed denial
```

If an authenticated context exists but is suspended, cross-tenant, or incomplete, fail closed. Do not silently switch to enrollment fallback.

## Expected implementation surface

Cursor must inspect the full call graph before editing. The likely surface includes:

- `src/auto-reply/templating.ts`
- `src/auto-reply/reply/get-reply.ts`
- `src/auto-reply/reply/get-reply-run.ts`
- `src/auto-reply/reply/agent-runner-execution.ts`
- `src/auto-reply/reply/followup-runner.ts`
- `src/auto-reply/reply/queue/types.ts`
- `src/agents/pi-tools.ts`
- `src/agents/openclaw-tools.ts`
- `src/agents/tools/operational-identity-tool.ts`
- `src/gateway/knowledge/reply-gateway-client.ts`
- `src/gateway/enterprise-operational-identity-runtime.ts`

This list is a tracing guide, not authorization to edit every file. Cursor should minimize the final surface after proving the call graph.

## Prohibited approaches

- Reading request identity from environment variables.
- Adding a Tencent Meeting-only bypass.
- Hard-coding `tenantId`, `seatId`, employee email, or agent ID.
- Treating `agent:main` as proof of employee identity.
- Turning on permissive enrollment fallback for all runs.
- Catching authorization errors and retrying with weaker context.
- Adding title/name matching.
- Passing secrets or credential handles into model-visible context.
- Changing user-facing error text without adding typed server-side causes.
- Declaring success from tool output without verifying execution scope.

## Observability

Add redacted structured diagnostics at the scope decision, not raw credentials:

- context source: employee, collaboration-owner, enrollment, none;
- tenant present/missing;
- membership present/missing;
- seat present/missing;
- agent present/missing;
- final denial code.

Never log tokens, secrets, identity credentials, message bodies, or full personal identifiers.

## Compatibility policy

Existing enrolled-agent background execution remains supported. Compatibility must be expressed as an explicit context source with unique-resolution requirements, not as a catch-all fallback after any employee error.
