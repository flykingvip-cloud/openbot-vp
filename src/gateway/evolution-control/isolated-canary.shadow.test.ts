/**
 * Isolated shadow canary. Uses a private persist directory and never touches
 * openbot-gateway-rc or shared production state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CANARY_CONFIG } = vi.hoisted(() => {
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  const dir = `${process.env.TMPDIR || "/tmp"}/openbot-evo-shadow-config-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  return { CANARY_CONFIG: dir };
});
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: CANARY_CONFIG };
});
import {
  evaluateCapsuleObservationEligibility,
  getEvolutionSurface,
} from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../config/config.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "../agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { writeRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { createFailClosedAdapter } from "./adapters/fail-closed.js";
import {
  promotionGateFromEffect,
  readEffectVerificationAudits,
} from "./effect-verification-audit.js";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "./evolution-loop-log.js";
import { createExternalEffectService } from "./external-effect-service.js";
import { readEvolutionObservationAudits } from "./observation-audit.js";
import { resolveEvolutionIngestAccess } from "./runtime-ingest-access.js";
import {
  issueRuntimeOwnershipProof,
  resetRuntimeOwnershipProofsForTests,
} from "./runtime-ownership-proof.js";
import { bootstrapWorkingDnaVerifierRegistry } from "./test-support.js";
import { WORKING_DNA_RAW_VERIFIER_ID } from "./verifiers/working-dna-raw.js";

const { assertClientMayAccessAgentDetailed } = vi.hoisted(() => ({
  assertClientMayAccessAgentDetailed: vi.fn(),
}));

vi.mock("../server-methods/operator-access.js", () => ({
  assertClientMayAccessAgentDetailed,
}));

const TENANT = "tenant-shadow-canary";
const AGENT_ID = "shadow-canary-bot";
const SECRET = "shadow-canary-ownership-secret";

describe("isolated evolution shadow canary", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;
  const runId = `canary-${Date.now()}`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-evo-shadow-canary-"));
    persistDir = path.join(tmpDir, "evolution-control");
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    resetRuntimeOwnershipProofsForTests();
    resetEvolutionLoopLogsForTests();
    process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET = SECRET;
    assertClientMayAccessAgentDetailed.mockResolvedValue({
      agentId: AGENT_ID,
      tenantId: TENANT,
      userId: "canary-user",
    });
  });

  afterEach(() => {
    resetRuntimeOwnershipProofsForTests();
    delete process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(CANARY_CONFIG, { recursive: true, force: true });
    fs.mkdirSync(CANARY_CONFIG, { recursive: true });
  });

  it("closes a low-risk isolated loop and keeps negative paths fail-closed", async () => {
    const occurredAt = Date.now();
    const outcome = appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt,
        succeeded: true,
        runId,
        tenantId: TENANT,
        taskId: `task-${runId}`,
        surfaceId: "agent.working-dna",
      },
      { persistDir },
    );
    expect(outcome.observationEligibility).toBe("eligible");
    const written = readEvolutionTaskOutcomes(cfg, AGENT_ID);
    expect(written.some((row) => row.runId === runId && row.tenantId === TENANT)).toBe(true);

    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "conservative",
    });

    const issued = issueRuntimeOwnershipProof({
      runId,
      agentId: AGENT_ID,
      tenantId: TENANT,
      secret: SECRET,
      persistDir,
    });
    const { patternDetectionHandlers } = await import("../server-methods/pattern-detection.js");
    let ingestOk = false;
    let ingestPayload: { observation?: { runId?: string; agentId?: string; tenantId?: string } } =
      {};
    await patternDetectionHandlers["pattern-detection.ingest-sample"]({
      params: {
        agentId: "assistant-runtime",
        runId,
        ownershipProof: issued?.token,
        inputStructureHash: "canary-in",
        outputStructureHash: "canary-out",
      },
      respond: (ok: boolean, payload?: unknown) => {
        ingestOk = ok;
        ingestPayload = (payload ?? {}) as typeof ingestPayload;
      },
      client: { user: "canary@acme.com" },
    } as never);
    expect(ingestOk).toBe(true);
    expect(ingestPayload.observation?.runId).toBe(runId);
    expect(ingestPayload.observation?.agentId).toBe(AGENT_ID);
    expect(ingestPayload.observation?.tenantId).toBe(TENANT);

    const observations = readEvolutionObservationAudits();
    const observation = observations.find((row) => row.runId === runId);
    expect(observation).toMatchObject({
      runId,
      agentId: AGENT_ID,
      tenantId: TENANT,
    });
    expect(observation?.attribution.source).toBeTruthy();

    const service = createExternalEffectService({
      persistDir,
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const proposal = {
      schemaVersion: 2 as const,
      proposalId: `evo:${runId}`,
      sourceEvidenceRefs: ["ev-canary"],
      sourceMechanismRef: "m",
      target: { domain: "agent" as const, agentId: AGENT_ID },
      candidateRef: "cand:canary",
      surfaceId: "agent.working-dna",
      expectedEffects: [],
      riskLevel: "medium" as const,
      confidentialityScope: "enterprise" as const,
      tenantScope: TENANT,
      grantId: "grant-1",
      status: "CANARY" as const,
      createdAt: new Date(occurredAt).toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const application = {
      schemaVersion: 1 as const,
      applicationId: `app:${runId}`,
      proposalId: proposal.proposalId,
      experimentId: `exp:${runId}`,
      adapterId: "working-dna",
      idempotencyKey: `apply-${runId}`,
      targetVersionBefore: "style-before",
      targetVersionAfter: "style-after",
      rollbackRef: "rb",
      scope: "canary" as const,
      status: "applied" as const,
      appliedToRuntime: true,
    };
    const request = service.requestVerification({
      proposal,
      application,
      target: proposal.target,
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: new Date().toISOString(),
      expiresAt: proposal.expiresAt,
    });
    const verified = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: new Date().toISOString(),
      runId,
    });
    expect(verified.outcome).toBe("verified");
    expect(verified.observationReceiptRef.startsWith("raw-verified:")).toBe(true);
    const effect = readEffectVerificationAudits(persistDir).find((row) => row.runId === runId);
    expect(effect).toMatchObject({
      surfaceId: "agent.working-dna",
      result: "verified",
    });

    expect(
      promotionGateFromEffect({
        proposalStatus: "VERIFIED",
        verificationId: "ver-canary",
        riskLevel: "medium",
        requireExternalEffect: true,
        externalEffectOutcome: "verified",
        runId,
        agentId: AGENT_ID,
        tenantId: TENANT,
        surfaceId: "agent.working-dna",
      }).ok,
    ).toBe(true);
    expect(
      promotionGateFromEffect({
        proposalStatus: "VERIFIED",
        verificationId: "ver-unavail",
        riskLevel: "medium",
        requireExternalEffect: true,
        externalEffectOutcome: "inconclusive",
        runId,
        surfaceId: "agent.working-dna",
      }).ok,
    ).toBe(false);
    expect(
      promotionGateFromEffect({
        proposalStatus: "VERIFIED",
        verificationId: "ver-contra",
        riskLevel: "medium",
        requireExternalEffect: true,
        externalEffectOutcome: "contradicted",
        runId,
        surfaceId: "agent.working-dna",
      }).ok,
    ).toBe(false);

    const unsupported = getEvolutionSurface("knowledge.experience-capsule");
    expect(unsupported?.externalVerificationPolicy).toBe("unsupported");
    await expect(
      createFailClosedAdapter("knowledge.experience-capsule", "knowledge").apply(
        undefined as never,
      ),
    ).rejects.toThrow(/not enabled/);

    const { respond: missingRespond, last: missing } = (() => {
      const last = { ok: true, error: "" };
      return {
        last,
        respond: (ok: boolean, _payload?: unknown, error?: { message?: string }) => {
          last.ok = ok;
          last.error = error?.message ?? "";
        },
      };
    })();
    expect(
      await resolveEvolutionIngestAccess({
        client: { user: "canary@acme.com" } as never,
        claimedAgentId: AGENT_ID,
        runId: `${runId}-noproof`,
        respond: missingRespond,
      }),
    ).toBeNull();
    expect(missing.ok).toBe(false);

    const expired = issueRuntimeOwnershipProof({
      runId: `${runId}-cross`,
      agentId: AGENT_ID,
      tenantId: "tenant-other",
      secret: SECRET,
      persistDir,
    });
    expect(
      await resolveEvolutionIngestAccess({
        client: { user: "canary@acme.com" } as never,
        claimedAgentId: "assistant-runtime",
        runId: `${runId}-cross`,
        ownershipProof: expired?.token,
        claimedTenantId: TENANT,
        secret: SECRET,
        persistDir,
        respond: missingRespond,
      }),
    ).toBeNull();

    expect(
      await resolveEvolutionIngestAccess({
        client: { user: "canary@acme.com" } as never,
        claimedAgentId: AGENT_ID,
        runId,
        sessionKey: "agent:other-bot:direct:u1",
        ownershipProof: issued?.token,
        secret: SECRET,
        persistDir,
        respond: missingRespond,
      }),
    ).toBeNull();

    const capsule = evaluateCapsuleObservationEligibility({});
    expect(capsule).toEqual({
      eligible: false,
      reason: "legacy_missing_failure_cluster",
    });

    expect(
      listEvolutionLoopLogsForTests().some((row) => row.event === "evolution.attribution.rejected"),
    ).toBe(true);
    fs.writeFileSync(
      path.join(tmpDir, "canary-evidence.json"),
      `${JSON.stringify(
        {
          runId,
          outcome,
          observation,
          effect,
          isolatedDir: tmpDir,
        },
        null,
        2,
      )}\n`,
    );
  });
});
