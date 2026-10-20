import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { assertClientMayAccessAgentDetailed } = vi.hoisted(() => ({
  assertClientMayAccessAgentDetailed: vi.fn(),
}));

vi.mock("../server-methods/operator-access.js", () => ({
  assertClientMayAccessAgentDetailed,
}));

import type { GatewayClient, RespondFn } from "../server-methods/types.js";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "./evolution-loop-log.js";
import { resolveEvolutionIngestAccess } from "./runtime-ingest-access.js";
import {
  issueRuntimeOwnershipProof,
  resetRuntimeOwnershipProofsForTests,
} from "./runtime-ownership-proof.js";

const SECRET = "test-evolution-ownership-secret";

function client(): GatewayClient {
  return { user: "a@acme.com" } as GatewayClient;
}

function respondCapture(): {
  respond: RespondFn;
  last: { ok: boolean; error?: string; called: boolean };
} {
  const last = { ok: true as boolean, error: undefined as string | undefined, called: false };
  const respond: RespondFn = (ok, _payload, error) => {
    last.called = true;
    last.ok = ok;
    last.error =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : undefined;
  };
  return { respond, last };
}

function rejectedLog(reason: string, agentId?: string) {
  return listEvolutionLoopLogsForTests().some(
    (row) =>
      row.event === "evolution.attribution.rejected" &&
      row.reason === reason &&
      row.surfaceId === "pattern-detection.sample" &&
      (agentId ? row.agentId === agentId : true),
  );
}

describe("runtime ingest access", () => {
  beforeEach(() => {
    resetRuntimeOwnershipProofsForTests();
    resetEvolutionLoopLogsForTests();
    assertClientMayAccessAgentDetailed.mockReset();
    assertClientMayAccessAgentDetailed.mockResolvedValue({
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      userId: "user-a",
    });
  });

  afterEach(() => {
    resetRuntimeOwnershipProofsForTests();
  });

  it("rejects a concrete agent with no proof, binding, or sessionKey", async () => {
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "growth-bot",
      runId: "run-direct",
      respond,
    });
    expect(access).toBeNull();
    expect(last.called).toBe(true);
    expect(last.ok).toBe(false);
    expect(last.error).toContain("agent has no tenant ownership proof: growth-bot");
    expect(rejectedLog("missing_proof", "growth-bot")).toBe(true);
    expect(assertClientMayAccessAgentDetailed).not.toHaveBeenCalled();
  });

  it("accepts a concrete agent with a matching agent sessionKey", async () => {
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "growth-bot",
      runId: "run-session",
      sessionKey: "agent:growth-bot:direct:u1",
      respond,
    });
    expect(last.ok).toBe(true);
    expect(access).toMatchObject({
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      proofSource: "session",
    });
  });

  it("rejects a concrete agent when sessionKey points at another agent", async () => {
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "growth-bot",
      runId: "run-other-session",
      sessionKey: "agent:other-bot:direct:u1",
      respond,
    });
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(rejectedLog("agent_mismatch", "growth-bot")).toBe(true);
    expect(assertClientMayAccessAgentDetailed).not.toHaveBeenCalled();
  });

  it("accepts a concrete agent with a valid HMAC proof", async () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-hmac",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
    });
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "growth-bot",
      runId: "run-hmac",
      ownershipProof: issued?.token,
      secret: SECRET,
      respond,
    });
    expect(last.ok).toBe(true);
    expect(access).toMatchObject({
      agentId: "growth-bot",
      proofSource: "token",
    });
  });

  it("rejects an expired HMAC proof", async () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-expired",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
      now: 10,
      ttlMs: 5,
    });
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "growth-bot",
      runId: "run-expired",
      ownershipProof: issued?.token,
      secret: SECRET,
      now: 20,
      respond,
    });
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(rejectedLog("expired", "growth-bot")).toBe(true);
    expect(assertClientMayAccessAgentDetailed).not.toHaveBeenCalled();
  });

  it("accepts assistant-runtime with a valid run binding", async () => {
    issueRuntimeOwnershipProof({
      runId: "run-bind",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
    });
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "assistant-runtime",
      runId: "run-bind",
      secret: SECRET,
      respond,
    });
    expect(last.ok).toBe(true);
    expect(access).toMatchObject({
      agentId: "growth-bot",
      proofSource: "binding",
    });
  });

  it("rejects assistant-runtime without proof, binding, or sessionKey", async () => {
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "assistant-runtime",
      runId: "run-none",
      respond,
    });
    expect(access).toBeNull();
    expect(last.called).toBe(true);
    expect(last.ok).toBe(false);
    expect(last.error).toContain("agent has no tenant ownership proof: assistant-runtime");
    expect(rejectedLog("missing_proof", "assistant-runtime")).toBe(true);
    expect(assertClientMayAccessAgentDetailed).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant proof", async () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-x",
      agentId: "growth-bot",
      tenantId: "tenant-globex",
      secret: SECRET,
    });
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "assistant-runtime",
      runId: "run-x",
      ownershipProof: issued?.token,
      claimedTenantId: "tenant-acme",
      secret: SECRET,
      respond,
    });
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(rejectedLog("cross_tenant", "assistant-runtime")).toBe(true);
    expect(assertClientMayAccessAgentDetailed).not.toHaveBeenCalled();
  });

  it("rejects a binding whose agent does not match the session agent", async () => {
    issueRuntimeOwnershipProof({
      runId: "run-agent",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
    });
    const { respond, last } = respondCapture();
    const access = await resolveEvolutionIngestAccess({
      client: client(),
      claimedAgentId: "assistant-runtime",
      runId: "run-agent",
      sessionKey: "agent:other-bot:direct:u1",
      secret: SECRET,
      respond,
    });
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(rejectedLog("agent_mismatch")).toBe(true);
  });
});
