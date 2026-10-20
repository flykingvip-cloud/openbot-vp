import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evaluateAgentInvocationMock,
  appendGovernanceShadowDecisionMock,
  resolveTrustedAttributionMock,
} = vi.hoisted(() => ({
  evaluateAgentInvocationMock: vi.fn(),
  appendGovernanceShadowDecisionMock: vi.fn(),
  resolveTrustedAttributionMock: vi.fn(),
}));

vi.mock("../agent-invocation-governance.js", () => ({
  evaluateAgentInvocation: evaluateAgentInvocationMock,
}));
vi.mock("./shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendGovernanceShadowDecisionMock,
}));
vi.mock("../scope-attribution.js", () => ({
  resolveTrustedAttribution: resolveTrustedAttributionMock,
}));

import {
  AGENT_INVOCATION_SHADOW_ENV,
  isAgentInvocationShadowEnabled,
  recordAgentInvocationShadow,
} from "./agent-invocation-shadow.js";

describe("agent invocation shadow", () => {
  beforeEach(() => {
    evaluateAgentInvocationMock.mockReset();
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(true);
    resolveTrustedAttributionMock.mockReset();
    resolveTrustedAttributionMock.mockResolvedValue({});
  });

  it("stays off unless the flag is truthy", () => {
    expect(isAgentInvocationShadowEnabled({})).toBe(false);
    expect(isAgentInvocationShadowEnabled({ [AGENT_INVOCATION_SHADOW_ENV]: "off" })).toBe(false);
    expect(isAgentInvocationShadowEnabled({ [AGENT_INVOCATION_SHADOW_ENV]: "1" })).toBe(true);
  });

  it("does not evaluate or write when the flag is off", async () => {
    await recordAgentInvocationShadow({
      client: null,
      agentId: "sales",
      env: {},
    });
    expect(evaluateAgentInvocationMock).not.toHaveBeenCalled();
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
  });

  it("records a D1 deny when the pure decision is not allowed", async () => {
    evaluateAgentInvocationMock.mockResolvedValue({
      allowed: false,
      reason: "outside-governance-scope",
    });
    await recordAgentInvocationShadow({
      client: null,
      agentId: "sales",
      runId: "run-1",
      env: { [AGENT_INVOCATION_SHADOW_ENV]: "1" },
    });
    expect(evaluateAgentInvocationMock).toHaveBeenCalledWith({
      client: null,
      agentId: "sales",
      cfg: undefined,
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      effect: "deny",
      source: "agent-invocation",
      mode: "shadow",
      reason: "outside-governance-scope",
      runId: "run-1",
      subject: { kind: "agent", id: "sales" },
      shadow: {
        existing: { effect: "allow", source: "session", reason: "not-enforced" },
        divergence: "D1",
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("auditManagementDecision");
    expect(JSON.stringify(envelope)).not.toContain("authorizeAgentInvocation");
  });

  it("records D0 when the pure decision allows", async () => {
    evaluateAgentInvocationMock.mockResolvedValue({ allowed: true });
    await recordAgentInvocationShadow({
      client: null,
      agentId: "sales",
      runId: "run-allow",
      env: { [AGENT_INVOCATION_SHADOW_ENV]: "1" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "allow",
      runId: "run-allow",
      shadow: { existing: { effect: "allow", source: "session" }, divergence: "D0" },
    });
  });

  // Regression: these rows carried no tenant and no actor, so an E2 decision could
  // not be grouped by tenant or traced to a caller. Observed on production
  // 2026-10-01: 5 of 5 agent-invocation rows from a real 001 CEO browser session
  // had tenantId and actorId absent, while the model-entitlement rows on the very
  // same runIds carried tenantId=001 and actorId=platform-user:<uuid>.
  it("stamps the membership tenant and the platform-user actor id", async () => {
    evaluateAgentInvocationMock.mockResolvedValue({ allowed: true });
    resolveTrustedAttributionMock.mockResolvedValue({
      tenantId: "001",
      ownerId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    });
    await recordAgentInvocationShadow({
      client: null,
      agentId: "panda",
      runId: "run-attributed",
      env: { [AGENT_INVOCATION_SHADOW_ENV]: "1" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      source: "agent-invocation",
      runId: "run-attributed",
      tenantId: "001",
      actorId: "platform-user:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      subject: { kind: "agent", id: "panda" },
    });
  });

  it("stamps the actor alone when the session has an owner but no membership tenant", async () => {
    evaluateAgentInvocationMock.mockResolvedValue({ allowed: true });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-elle" });
    await recordAgentInvocationShadow({
      client: null,
      agentId: "panda",
      runId: "run-no-tenant",
      env: { [AGENT_INVOCATION_SHADOW_ENV]: "1" },
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({ actorId: "platform-user:user-elle" });
    expect(envelope).not.toHaveProperty("tenantId");
  });

  it("omits both when attribution resolves nothing, rather than inventing a tenant", async () => {
    evaluateAgentInvocationMock.mockResolvedValue({ allowed: true });
    resolveTrustedAttributionMock.mockResolvedValue({});
    await recordAgentInvocationShadow({
      client: null,
      agentId: "panda",
      runId: "run-anon",
      env: { [AGENT_INVOCATION_SHADOW_ENV]: "1" },
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).not.toHaveProperty("tenantId");
    expect(envelope).not.toHaveProperty("actorId");
  });

  it("still records the envelope when attribution resolution throws", async () => {
    evaluateAgentInvocationMock.mockResolvedValue({ allowed: true });
    resolveTrustedAttributionMock.mockRejectedValue(new Error("platform auth unreadable"));
    await recordAgentInvocationShadow({
      client: null,
      agentId: "panda",
      runId: "run-throw",
      env: { [AGENT_INVOCATION_SHADOW_ENV]: "1" },
    });
    // Attribution is best-effort: losing it must not cost us the decision row.
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      source: "agent-invocation",
      runId: "run-throw",
    });
  });

  it("chat.send and the agent RPC pass the run id they already own", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server-methods");
    const agent = fs.readFileSync(path.join(dir, "agent.ts"), "utf8");
    const chat = fs.readFileSync(path.join(dir, "chat.ts"), "utf8");
    expect(agent).toContain("recordAgentInvocationShadow({ client, agentId, cfg, runId: idem })");
    expect(chat).toContain(
      "recordAgentInvocationShadow({ client, agentId, cfg, runId: clientRunId })",
    );
    expect(agent).not.toContain("authorizeAgentInvocation");
    expect(chat).not.toContain("authorizeAgentInvocation");
  });
});
