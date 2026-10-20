# COLLAB CSC depth-router agent-allowlist — design proposal (2026-08-25)

Status: DESIGN PROPOSAL. Not implemented. No code or production change is made by this document.
Requires review + separate authorization before any implementation, and the change then goes
through the full pipeline (implement -> unit tests -> build -> shadow-only observe on the real
assistant -> acceptance -> ROUTER stage separately).

## Problem (surfaced by the 2026-08-25 real-traffic window)

The shadow depth path only engages for the main default personal steward. In the real window the
operator chatted a custom assistant ("skill孵化") and a collaboration group ("数字人测试"), so
`DEPTH_EVENTS=0` — the feature never applied to the operator's real assistant. To make the test
match the real bot, the depth gate must cover the operator's actual personal assistant, not only
the `main` agent.

## Current behavior (code)

- `src/auto-reply/reply/inbound-depth.ts` `isInboundDepthEmployeeStewardSession`:
  returns true only when `resolveInboundSessionKind(sessionKey) === "employee"` AND
  (`agentId` is empty OR `agentId.toLowerCase() === "main"`).
- `resolveInboundSessionKind`: `employee:` prefix -> "employee"; `space:` -> "space"; else
  "mission"/"other".
- `src/auto-reply/reply/get-reply-run.ts` gates the depth classify+emit on
  `!isHeartbeat && (shadow || router || knowledge || tool) && isInboundDepthEmployeeStewardSession(...)`.
- Flags: `src/gateway/chat-inbound-flags.ts` (env-based deploy flags via `resolveEnvBool`).

## Proposed change

Broaden the agent gate from "main only" to "main plus a configurable allowlist", while keeping the
`employee:` session-kind requirement unchanged (so `space:`/`mission` stay excluded and space
isolation is preserved).

1. New deploy-level config in `chat-inbound-flags.ts` (default empty -> no behavior change):

```ts
/** Comma-separated agentIds (besides "main") whose employee sessions are in scope for depth. */
export function getChatInboundDepthAgentAllowlist(): string[] {
  const raw = process.env.OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
```

2. Widen the gate in `inbound-depth.ts` (illustrative):

```ts
export function isInboundDepthEmployeeStewardSession(params: {
  sessionKey: string;
  agentId?: string | null;
  allowlist?: string[]; // defaults to getChatInboundDepthAgentAllowlist()
}): boolean {
  if (resolveInboundSessionKind(params.sessionKey) !== "employee") return false;
  const agentId = params.agentId?.trim().toLowerCase();
  if (!agentId || agentId === "main") return true;
  const allow = params.allowlist ?? getChatInboundDepthAgentAllowlist();
  return allow.includes(agentId);
}
```

3. Add the enabled allowlist (count only, not raw ids) to `listEnabledChatInboundFlags()` output
   for observability, e.g. `chatInboundDepthAgentAllowlist:N`.

## Backward compatibility + safety

- Default allowlist is empty -> gate is identical to today (main-only) -> zero behavior change
  unless explicitly configured. Opt-in.
- Still gated by the existing inbound flags: with only `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` +
  the allowlist, the change is compute-only shadow for the allowlisted agents (no routing, no
  tool/model change).
- Session-kind requirement unchanged: `employee:` only; `space:` and `mission` still excluded, so
  the collaboration-space isolation invariant is preserved.
- Emit/redaction path unchanged (`emitChatInboundStage` + `assertNoSensitiveFields` +
  `sessionKeyHash`), so no new sensitive exposure.

## Impact analysis

- Newly in scope: only the `employee:` sessions of the allowlisted custom agents. In shadow mode
  they only add `chat.depth_decided` (compute+emit); no behavior change.
- Not affected: `main` sessions (already in scope), spaces, missions, non-allowlisted agents.
- Requires the operator to supply the target agentId(s) for the allowlist (e.g. the id of
  "skill孵化"); this doc does not embed any id.

## Test plan

- Unit tests for `isInboundDepthEmployeeStewardSession`: main (in), allowlisted agent (in),
  non-allowlisted agent (out), empty agent (in), `space:` (out), `mission` (out); empty vs
  populated allowlist.
- Mock validation of the capture (already have `capture-chat-lifecycle-v3.cjs`).
- Then a shadow-only real-traffic window targeting the real assistant (allowlist set to its
  agentId) to capture real `chat.depth_decided` with `wouldDepth`/`routeStrength`/`reasons`,
  `MODE_ALL_SHADOW=YES`, zero tools/no extra model, space isolation, no leaks.

## Rollout (pipeline)

1. Implement (flags + gate + unit tests); `pnpm tsgo` / `pnpm check` / scoped tests green.
2. Build; land via PR to main.
3. Separate authorization: shadow-only enable with `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` +
   `OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST=<assistant-agentId>` (same-SHA recreate, auto-rollback).
4. Real-traffic window on the actual assistant; acceptance all-green.
5. Only then request the ROUTER stage (separately authorized).

## Risks + mitigations

- Risk: allowlist typo -> wrong agent in scope. Mitigation: values lowercased/trimmed; observability
  shows count; shadow-only first (compute only).
- Risk: scope creep to spaces. Mitigation: session-kind `employee:` requirement is retained; spaces
  cannot enter via the allowlist.
- Risk: unintended behavior change. Mitigation: default empty = no change; opt-in; still shadow-gated.

## Explicitly out of scope here

- No code under `src/` is modified by this proposal.
- No production config, container, flag, or agent identity is changed.
- Implementation begins only after review + explicit authorization.
