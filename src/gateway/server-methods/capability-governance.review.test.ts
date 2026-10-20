// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-gov-review-${process.pid}-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { capabilityGovernanceHandlers, __setDisplayedSkillCardLoaderForTest } =
  await import("./capability-governance.js");
const { getProposal, listRegistry, submitProposal } =
  await import("../capability-governance-store.js");

type HandlerError = { code?: string; message?: string };

async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = capabilityGovernanceHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("capabilities.governance approve/reject of displayed pending skills", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    __setDisplayedSkillCardLoaderForTest(() => [
      {
        skillKey: "agent-reach",
        name: "Agent Reach",
        description: "reach",
        source: "openclaw-managed",
      },
      {
        skillKey: "canvas",
        name: "Canvas",
        description: "canvas",
        source: "openclaw-extra",
      },
      {
        skillKey: "bundled-one",
        name: "Bundled",
        description: "ships with the runtime",
        source: "openclaw-bundled",
      },
    ]);
  });

  afterEach(() => {
    __setDisplayedSkillCardLoaderForTest(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("approves a pending card that was only derived from the skill catalog", async () => {
    const proposalId = "proposal:urn:openclaw:skill:agent-reach@0.0.0";
    expect(getProposal(proposalId)).toBeNull();

    const res = await invoke<{
      proposal: { status: string };
      entry: { manifest: { skillKey: string } };
    }>("capabilities.governance.approveProposal", { proposalId, reviewerId: "platform-ui" });

    expect(res.ok).toBe(true);
    expect(res.payload.proposal.status).toBe("approved");
    expect(res.payload.entry.manifest.skillKey).toBe("agent-reach");
    expect(getProposal(proposalId)?.status).toBe("approved");
    expect(listRegistry().some((entry) => entry.manifest.skillKey === "agent-reach")).toBe(true);
  });

  it("rejects a pending card that was not yet stored", async () => {
    const proposalId = "proposal:urn:openclaw:skill:canvas@0.0.0";
    const res = await invoke<{ proposal: { status: string } }>(
      "capabilities.governance.rejectProposal",
      { proposalId, reviewerId: "platform-ui", note: "不纳入当前平台目录" },
    );

    expect(res.ok).toBe(true);
    expect(res.payload.proposal.status).toBe("rejected");
    expect(getProposal(proposalId)?.status).toBe("rejected");
    expect(listRegistry()).toHaveLength(0);
  });

  it("returns a clear error when the proposal is not stored and not a pending skill card", async () => {
    const proposalId = "proposal:not-a-real-card";
    const res = await invoke("capabilities.governance.approveProposal", {
      proposalId,
      reviewerId: "platform-ui",
    });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_REQUEST");
    expect(res.error.message).toContain("not found in the governance store");
    expect(res.error.message).toContain(proposalId);
    expect(getProposal(proposalId)).toBeNull();
  });

  it("does not invent a proposal for a first-party skill the pending tab does not show", async () => {
    const proposalId = "proposal:urn:openclaw:skill:bundled-one@0.0.0";
    const res = await invoke("capabilities.governance.approveProposal", {
      proposalId,
      reviewerId: "platform-ui",
    });

    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("does not match a pending skill");
    expect(getProposal(proposalId)).toBeNull();
  });

  it("still approves a proposal that is already in the store", async () => {
    const proposalId = "proposal:stored-one";
    submitProposal({
      proposalId,
      submittedAt: "2026-10-04T00:00:00.000Z",
      submittedBy: "test",
      status: "proposed",
      manifest: {
        id: "urn:openclaw:skill:stored-one@1.0.0",
        kind: "skill",
        version: "1.0.0",
        skillKey: "stored-one",
        name: "Stored",
        description: "already submitted",
        source: { kind: "upload", origin: "test", trustTier: "third-party" },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      findings: [],
    });
    __setDisplayedSkillCardLoaderForTest(() => []);

    const res = await invoke("capabilities.governance.approveProposal", {
      proposalId,
      reviewerId: "platform-ui",
    });

    expect(res.ok).toBe(true);
    expect(getProposal(proposalId)?.status).toBe("approved");
  });
});
