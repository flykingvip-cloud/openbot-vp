# Conversation Identity Context Convergence Requirements

## Purpose

Ensure an authenticated OpenBot employee conversation retains one authoritative identity context from webchat ingress through agent execution and every Seat-bound enterprise tool.

This task is the first implementation slice of `docs/design/openbot-conversation-system-isolation-audit-2026-09-20.md`. It must simplify identity propagation and must not add another independent fallback or environment-variable identity source.

## Product scenario

An employee opens Daibai in the OpenBot Control UI and asks it to execute an already-authorized enterprise operational identity, such as Tencent Meeting `schedule_meeting`.

Expected behavior:

1. the authenticated user, tenant, membership, seat, agent, and conversation remain attributable;
2. the operational identity policy is evaluated against the employee's authoritative seat;
3. an allowed action executes without asking the model to infer login state;
4. a denied action returns a precise typed reason;
5. process-global environment variables are irrelevant to request identity.

## Current failure

The inbound Gateway path already carries:

- `GatewayClientUser`;
- `GatewayClientPlatformUserId`;
- `GatewayClientSessionDomain`;
- `GatewayClientSessionEnterpriseId`;
- `GatewayClientSessionMembershipId`.

The reply path can construct a full temporary `GatewayClient`, but tool construction currently forwards only user, domain, and platform user ID. Enterprise and membership fields are lost before `operational_identity` executes. The runtime then depends on enrollment fallback and may return `NO_SEAT_CONTEXT` despite an authenticated employee workbench request.

## Functional requirements

### R1. One typed execution identity

Introduce or reuse one typed immutable context containing the trusted request identity required by Seat-bound tools:

```ts
type ExecutionIdentityContext = {
  user?: string;
  platformUserId?: string;
  sessionDomain?: "platform" | "enterprise" | "employee";
  enterpriseId?: string;
  membershipId?: string;
  seatId?: string;
  agentId?: string;
  sessionKey?: string;
  collaborationGroupId?: string;
};
```

Naming may follow existing conventions, but there must be one canonical structure rather than parallel parameter lists.

### R2. Trusted ingress only

Identity fields originate from authenticated Gateway connection and server-side membership/seat resolution. Tool arguments, prompts, model text, process environment, URL query parameters, and collaboration message bodies must not set or override them.

### R3. Lossless propagation

The context must remain available through:

```text
chat.send
-> MsgContext
-> get-reply / run preparation
-> queued and follow-up runs
-> Pi/OpenClaw tool construction
-> operational_identity runtime client/scope
```

### R4. Authoritative seat resolution

For an authenticated employee request, resolve tenant, employee, membership, and current seat from the authoritative tenant control-plane store. Enrollment fallback may serve non-interactive enrolled-agent execution only; it must not replace a present but invalid employee context.

### R5. Fail closed and explain precisely

Do not collapse distinct failures into `NO_SEAT_CONTEXT`. At minimum distinguish:

- missing authenticated employee identity;
- missing tenant context;
- missing or inactive membership;
- employee has no current seat;
- requested agent is not assigned/enrolled;
- identity policy denies seat/agent/action;
- ambiguous enrollment fallback.

User-facing text must not claim that empty process environment variables prove logout.

### R6. Conversation isolation preservation

The change must not weaken:

- employee steward ownership isolation;
- tenant binding;
- collaboration group owner/member entitlement;
- live event recipient isolation;
- personal operational identity separation;
- server-side credential storage.

### R7. No tool-specific patch

Do not solve this only inside Tencent Meeting, only inside `operational_identity`, or by adding a special case for agent `main`. The identity context must be reusable by all Seat-bound enterprise tools.

### R8. No environment fallback

Do not read `TENANT`, `USER`, `AGENT`, `SESSION`, or `CHANNEL` to recover request identity. `OPENBOT_DATA_MODE` and `OPENBOT_MULTITENANT` describe deployment mode, not the active employee.

## Non-goals

- Redesigning collaboration transcript routing.
- Enabling agent-to-agent messaging.
- Migrating all session keys to `ConversationRef` in this slice.
- Changing enterprise identity policies or granting new permissions.
- Automatically assigning a seat to an employee.
- Weakening Managed Enterprise fail-closed behavior.

## Acceptance requirements

1. An employee Daibai turn retains enterprise and membership identity at tool execution.
2. Authorized Tencent Meeting read and schedule actions resolve the expected seat and agent.
3. A user without a seat receives a typed no-seat result.
4. A suspended/wrong-tenant membership cannot fall back through agent enrollment.
5. A background enrolled-agent run without an employee session still works only when enrollment resolves uniquely.
6. Collaboration owner entitlement remains explicit and cannot be replaced by the speaking member's seat.
7. Existing user operational identity tests remain green.
8. No production code reads request identity from process environment.
