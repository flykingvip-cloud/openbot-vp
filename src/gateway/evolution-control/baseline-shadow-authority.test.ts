import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import {
  createFailClosedObservationProvider,
  observationsToEvaluation,
  type ExperimentObservationProvider,
} from "./observation.js";
import { testInspector, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const AGENT_ID = "dna-bot";

function freeze(candidateVersion: string) {
  return {
    baselineVersion: "style-seed",
    candidateVersion,
    codeSha: "sha-fixture",
    modelRef: "model-fixture",
    providerVersion: "provider-fixture",
    configSnapshotRef: "cfg-fixture",
    datasetOrCohortRef: "cohort-a",
    tenantScope: TENANT_A,
    confidentialityScope: "enterprise" as const,
    expiresAt: "2026-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

function dnaV1(proposalId: string, candidateRef: string) {
  return {
    schemaVersion: 1 as const,
    proposalId,
    sourceFindingIds: ["f-1"],
    sourceEvidenceRefs: ["ev-a"],
    tenantScope: TENANT_A,
    targetDomain: "agent_working_dna" as const,
    proposedChange: { summary: "tune" },
    expectedEffect: "raise success",
    riskLevel: "medium" as const,
    confidentialityScope: "enterprise" as const,
    status: "APPROVED" as const,
    approvalRequired: true as const,
    approverScope: "enterprise" as const,
    grantId: "grant-1",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    auditReceipt: `aud:${proposalId}`,
    candidateRef,
  };
}

function dnaCandidate(candidateVersion: string) {
  return {
    agentId: AGENT_ID,
    delta: { riskPreference: "conservative" as const },
    baselineStyle: DEFAULT_WORKING_STYLE,
    candidateVersion,
  };
}

function missingBaselineProvider(): ExperimentObservationProvider {
  return {
    async captureBaseline() {
      return null;
    },
    async collect({ experiment, rollbackDrill }) {
      return observationsToEvaluation(experiment, [], [], rollbackDrill ?? "not_run");
    },
  };
}

function completeSamples(experiment: {
  primaryMetric: { metricId: string };
  guardrailMetrics: Array<{ metricId: string }>;
  experimentId: string;
}) {
  return [
    {
      metricId: experiment.primaryMetric.metricId,
      value: 0.7,
      sampleSize: 40,
      windowRef: `${experiment.experimentId}:baseline`,
    },
    ...experiment.guardrailMetrics.map((row) => ({
      metricId: row.metricId,
      value: 0,
      sampleSize: 40,
      windowRef: `${experiment.experimentId}:baseline`,
    })),
  ];
}

function frozenInconclusiveProvider(): ExperimentObservationProvider {
  return {
    async captureBaseline({ experiment }) {
      const window = {
        windowId: `${experiment.experimentId}:baseline`,
        experimentId: experiment.experimentId,
        phase: "baseline" as const,
        startedAt: "2026-09-06T11:00:00.000Z",
        endedAt: "2026-09-06T11:00:00.000Z",
        tenantScope: experiment.tenantScope,
        targetKey: "agent:dna-bot",
        modelRevision: experiment.frozen.modelRef,
        configRevision: experiment.frozen.configSnapshotRef,
        cohortRef: experiment.frozen.datasetOrCohortRef,
      };
      return {
        experimentId: experiment.experimentId,
        frozenAt: window.endedAt,
        window,
        samples: completeSamples(experiment),
      };
    },
    async collect({ experiment, rollbackDrill }) {
      return observationsToEvaluation(
        experiment,
        completeSamples(experiment),
        [],
        rollbackDrill ?? "not_run",
        { treatmentPremature: true },
      );
    },
  };
}

function incompleteGuardrailProvider(): ExperimentObservationProvider {
  return {
    async captureBaseline({ experiment }) {
      return {
        experimentId: experiment.experimentId,
        frozenAt: "2026-09-06T11:00:00.000Z",
        window: {
          windowId: `${experiment.experimentId}:baseline`,
          experimentId: experiment.experimentId,
          phase: "baseline",
          startedAt: "2026-09-06T11:00:00.000Z",
          endedAt: "2026-09-06T11:00:00.000Z",
          tenantScope: experiment.tenantScope,
          targetKey: "agent:dna-bot",
          modelRevision: experiment.frozen.modelRef,
          configRevision: experiment.frozen.configSnapshotRef,
          cohortRef: experiment.frozen.datasetOrCohortRef,
        },
        samples: [
          {
            metricId: experiment.primaryMetric.metricId,
            value: 0.7,
            sampleSize: 40,
            windowRef: `${experiment.experimentId}:baseline`,
          },
        ],
      };
    },
    async collect({ experiment, rollbackDrill }) {
      return observationsToEvaluation(
        experiment,
        [
          {
            metricId: experiment.primaryMetric.metricId,
            value: 0.7,
            sampleSize: 40,
            windowRef: "baseline",
          },
        ],
        [],
        rollbackDrill ?? "not_run",
      );
    },
  };
}

function regressedProvider(): ExperimentObservationProvider {
  const passing = testObservation();
  return {
    captureBaseline: (input) => passing.captureBaseline(input),
    async collect({ experiment }) {
      return {
        primary: { contract: experiment.primaryMetric, baseline: 0.8, treatment: 0.4 },
        guardrails: experiment.guardrailMetrics.map((contract) => ({
          contract,
          baseline: contract.critical ? 0 : 0,
          treatment: contract.metricId === "security_violations" ? 2 : 0,
        })),
        sampleSize: 40,
        minimumSampleSize: experiment.minimumSampleSize,
        confidence: null,
        requiredConfidence: experiment.requiredConfidence,
        baselineContaminated: false,
        modelVersionChanged: false,
        rollbackDrill: "passed",
        assessmentMode: "deterministic-fixture",
      };
    },
  };
}

describe("baseline, shadow, and authority gates", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-bsa-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("missing baseline blocks canary", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: missingBaselineProvider(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-missing",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(experiment.baselineCapture?.status).toBe("missing");
    await expect(
      plane.applyWorkingDna({
        commandId: "canary-missing",
        proposalId: "evo:dna",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/frozen baseline/);
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
  });

  it("missing critical guardrail blocks canary", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: incompleteGuardrailProvider(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-incomplete",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(experiment.baselineCapture?.status).toBe("incomplete");
    expect(experiment.baselineCapture?.missingCriticalGuardrails).toContain("security_violations");
    await expect(
      plane.applyWorkingDna({
        commandId: "canary-incomplete",
        proposalId: "evo:dna",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/critical guardrail/);
  });

  it("complete baseline plus inconclusive allows approved canary", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: frozenInconclusiveProvider(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-ok",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("inconclusive");
    const applied = await plane.applyWorkingDna({
      commandId: "canary-ok",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(applied.appliedToRuntime).toBe(true);
    expect(plane.getProposal("evo:dna")?.status).toBe("CANARY");
  });

  it("regressed blocks canary", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: regressedProvider(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-reg",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("regressed");
    await expect(
      plane.applyWorkingDna({
        commandId: "canary-reg",
        proposalId: "evo:dna",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/regressed/);
  });

  it("shadow remains allowed without runtime mutation", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: missingBaselineProvider(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-shadow",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    const shadow = await plane.applyWorkingDna({
      commandId: "shadow-ok",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    expect(shadow.appliedToRuntime).toBe(false);
    expect(shadow.scope).toBe("shadow");
    expect(plane.getProposal("evo:dna")?.status).toBe("EXPERIMENTING");
    expect(plane.ledger.list({ proposalId: "evo:dna" }).map((row) => row.type)).toContain(
      "experiment.shadow_observed",
    );
    expect(plane.ledger.list({ proposalId: "evo:dna" }).map((row) => row.type)).not.toContain(
      "application.applied",
    );
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
  });

  it("keeps Proposal EXPERIMENTING after shadow, not only ledger/application", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: missingBaselineProvider(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-shadow-status",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.applyWorkingDna({
      commandId: "shadow-status",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    expect(plane.getProposal("evo:dna")?.status).toBe("EXPERIMENTING");
    expect(plane.getProposal("evo:dna")?.status).not.toBe("ACTIVE");
    expect(plane.getProposal("evo:dna")?.status).not.toBe("CANARY");
    expect(plane.getProposal("evo:dna")?.applicationId).toBeUndefined();
  });

  it("rejects unregistered and tampered candidates", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    const experiment = await plane.startExperiment({
      commandId: "exp-cand",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await expect(
      plane.applyWorkingDna({
        commandId: "apply-unreg",
        proposalId: "evo:dna",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "shadow",
      }),
    ).rejects.toThrow(/governed candidate not found/);
    const payload = dnaCandidate("cand:dna");
    plane.registerCandidate("cand:dna", payload);
    (payload as { delta: Record<string, string> }).delta = { communicationTone: "formal" };
    await expect(
      plane.applyWorkingDna({
        commandId: "apply-tamper",
        proposalId: "evo:dna",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "shadow",
      }),
    ).rejects.toThrow(/payload|hash|candidate/i);
  });

  it("rejects cross-tenant reject, verify, promote, and rollback", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", dnaCandidate("cand:dna"));
    const experiment = await plane.startExperiment({
      commandId: "exp-tenant",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    const applied = await plane.applyWorkingDna({
      commandId: "canary-tenant",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(() =>
      plane.rejectProposal({
        commandId: "reject-x",
        proposalId: "evo:dna",
        principalRef: "intruder",
        trustedTenantId: TENANT_B,
      }),
    ).toThrow(/proposal not found/);
    await expect(
      plane.verifyApplication({
        commandId: "ver-x",
        applicationId: applied.applicationId,
        principalRef: "intruder",
        trustedTenantId: TENANT_B,
      }),
    ).rejects.toThrow(/proposal not found/);
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-x",
        proposalId: "evo:dna",
        principalRef: "intruder",
        trustedTenantId: TENANT_B,
      }),
    ).toThrow(/proposal not found|not VERIFIED/);
    await expect(
      plane.rollbackApplication({
        commandId: "rb-x",
        applicationId: applied.applicationId,
        principalRef: "intruder",
        trustedTenantId: TENANT_B,
      }),
    ).rejects.toThrow(/proposal not found/);
    expect(plane.getProposal("evo:dna")?.status).toBe("CANARY");
  });

  it("blocks every mutation after an expired or revoked grant", async () => {
    const expired = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A, { status: "EXPIRED" }),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    expired.ingestV1(dnaV1("evo:exp", "cand:exp"), { agentId: AGENT_ID });
    expired.registerCandidate("cand:exp", dnaCandidate("cand:exp"));
    await expect(
      expired.startExperiment({
        commandId: "exp-expired",
        proposalId: "evo:exp",
        freeze: freeze("cand:exp"),
        now: "2026-09-06T11:00:00.000Z",
      }),
    ).rejects.toThrow(/expired/);
    expect(() =>
      expired.rejectProposal({
        commandId: "reject-expired",
        proposalId: "evo:exp",
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
      }),
    ).toThrow(/expired/);
    const revoked = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A, { status: "REVOKED" }),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    revoked.ingestV1(dnaV1("evo:rev", "cand:rev"), { agentId: AGENT_ID });
    revoked.registerCandidate("cand:rev", dnaCandidate("cand:rev"));
    await expect(
      revoked.startExperiment({
        commandId: "exp-revoked",
        proposalId: "evo:rev",
        freeze: freeze("cand:rev"),
        now: "2026-09-06T11:00:00.000Z",
      }),
    ).rejects.toThrow(/revoked/);
  });

  it("keeps duplicate command IDs idempotent and refuses retargeting", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:a", "cand:a"), { agentId: AGENT_ID });
    plane.ingestV1(dnaV1("evo:b", "cand:b"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:a", dnaCandidate("cand:a"));
    plane.registerCandidate("cand:b", {
      ...dnaCandidate("cand:b"),
      delta: { communicationTone: "formal" },
    });
    const experimentA = await plane.startExperiment({
      commandId: "shared-cmd",
      proposalId: "evo:a",
      freeze: freeze("cand:a"),
      now: "2026-09-06T11:00:00.000Z",
    });
    const first = await plane.applyWorkingDna({
      commandId: "apply-shared",
      proposalId: "evo:a",
      experimentId: experimentA.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    const again = await plane.applyWorkingDna({
      commandId: "apply-shared",
      proposalId: "evo:a",
      experimentId: experimentA.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(again.applicationId).toBe(first.applicationId);
    await expect(
      plane.applyWorkingDna({
        commandId: "apply-shared",
        proposalId: "evo:b",
        experimentId: experimentA.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/cannot retarget|not bound/);
  });

  it("does not use the fail-closed provider as a success path", async () => {
    const closed = createFailClosedObservationProvider();
    await expect(closed.captureBaseline({} as never)).resolves.toBeNull();
    await expect(closed.collect({} as never)).rejects.toThrow(
      /trusted observation provider required/,
    );
  });
});
