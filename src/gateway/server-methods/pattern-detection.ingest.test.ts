import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-pattern-ingest-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { assertClientMayAccessAgentDetailed } = vi.hoisted(() => ({
  assertClientMayAccessAgentDetailed: vi.fn(),
}));

vi.mock("./operator-access.js", () => ({
  assertClientMayAccessAgentDetailed,
  assertClientMayAccessCandidate: vi.fn(),
  requireAuthenticatedOperatorPrincipal: vi.fn(),
}));

const { patternDetectionHandlers } = await import("./pattern-detection.js");
const { resetPatternDetectionStoreForTests } = await import("../pattern-detection/index.js");
const { issueRuntimeOwnershipProof, resetRuntimeOwnershipProofsForTests } =
  await import("../evolution-control/runtime-ownership-proof.js");
const { readEvolutionObservationAudits } =
  await import("../evolution-control/observation-audit.js");
const { listEvolutionLoopLogsForTests, resetEvolutionLoopLogsForTests } =
  await import("../evolution-control/evolution-loop-log.js");

const SECRET = "test-evolution-ownership-secret";

function respondCapture() {
  let payload: unknown;
  let error: { message?: string } | undefined;
  let ok = false;
  return {
    last: () => ({ ok, payload, error }),
    respond: (nextOk: boolean, nextPayload?: unknown, nextError?: { message?: string }) => {
      ok = nextOk;
      payload = nextPayload;
      error = nextError;
    },
  };
}

describe("pattern-detection.ingest-sample ownership", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    resetPatternDetectionStoreForTests();
    resetRuntimeOwnershipProofsForTests();
    resetEvolutionLoopLogsForTests();
    process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET = SECRET;
    assertClientMayAccessAgentDetailed.mockResolvedValue({
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      userId: "user-a",
    });
  });

  afterEach(() => {
    resetPatternDetectionStoreForTests();
    resetRuntimeOwnershipProofsForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET;
  });

  it("ingests a legal assistant-runtime proof and writes an observation", async () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-ingest",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
      persistDir: tmpDir,
    });
    const { respond, last } = respondCapture();
    await patternDetectionHandlers["pattern-detection.ingest-sample"]({
      params: {
        agentId: "assistant-runtime",
        runId: "run-ingest",
        ownershipProof: issued?.token,
        inputStructureHash: "in-1",
        outputStructureHash: "out-1",
      },
      respond,
      client: { user: "a@acme.com" },
    } as never);
    expect(last().ok).toBe(true);
    const payload = last().payload as {
      sample?: { runId?: string; agentId?: string };
      observation?: { runId?: string };
    };
    expect(payload.sample?.runId).toBe("run-ingest");
    expect(payload.sample?.agentId).toBe("growth-bot");
    expect(payload.observation?.runId).toBe("run-ingest");
    expect(readEvolutionObservationAudits().some((row) => row.runId === "run-ingest")).toBe(true);
  });

  it("rejects a missing proof", async () => {
    const { respond, last } = respondCapture();
    await patternDetectionHandlers["pattern-detection.ingest-sample"]({
      params: {
        agentId: "assistant-runtime",
        runId: "run-missing",
        inputStructureHash: "in-1",
        outputStructureHash: "out-1",
      },
      respond,
      client: { user: "a@acme.com" },
    } as never);
    expect(last().ok).toBe(false);
    expect(last().error?.message).toContain(
      "agent has no tenant ownership proof: assistant-runtime",
    );
    expect(readEvolutionObservationAudits()).toHaveLength(0);
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) => row.event === "evolution.attribution.rejected" && row.reason === "missing_proof",
      ),
    ).toBe(true);
  });

  it("rejects a cross-tenant proof", async () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-cross",
      agentId: "growth-bot",
      tenantId: "tenant-globex",
      secret: SECRET,
    });
    const { respond, last } = respondCapture();
    await patternDetectionHandlers["pattern-detection.ingest-sample"]({
      params: {
        agentId: "assistant-runtime",
        runId: "run-cross",
        tenantId: "tenant-acme",
        ownershipProof: issued?.token,
        inputStructureHash: "in-1",
        outputStructureHash: "out-1",
      },
      respond,
      client: { user: "a@acme.com" },
    } as never);
    expect(last().ok).toBe(false);
  });

  it("rejects a concrete agent that only has ordinary ACL", async () => {
    const { respond, last } = respondCapture();
    await patternDetectionHandlers["pattern-detection.ingest-sample"]({
      params: {
        agentId: "growth-bot",
        runId: "run-acl-only",
        inputStructureHash: "in-1",
        outputStructureHash: "out-1",
      },
      respond,
      client: { user: "a@acme.com" },
    } as never);
    expect(last().ok).toBe(false);
    expect(last().error?.message).toContain("agent has no tenant ownership proof: growth-bot");
    expect(readEvolutionObservationAudits()).toHaveLength(0);
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) =>
          row.event === "evolution.attribution.rejected" &&
          row.reason === "missing_proof" &&
          row.runId === "run-acl-only",
      ),
    ).toBe(true);
  });

  it("does not create an observation without runId when session proof is present", async () => {
    const { respond, last } = respondCapture();
    await patternDetectionHandlers["pattern-detection.ingest-sample"]({
      params: {
        agentId: "growth-bot",
        sessionKey: "agent:growth-bot:direct:u1",
        inputStructureHash: "in-1",
        outputStructureHash: "out-1",
      },
      respond,
      client: { user: "a@acme.com" },
    } as never);
    expect(last().ok).toBe(false);
    expect(last().error?.message).toContain("runId is required");
    expect(readEvolutionObservationAudits()).toHaveLength(0);
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) =>
          row.event === "evolution.observation.unavailable" && row.reason === "missing_run_id",
      ),
    ).toBe(true);
  });
});
