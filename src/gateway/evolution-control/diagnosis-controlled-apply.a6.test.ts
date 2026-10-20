import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiagnosisRecheckRequest } from "@openbot/evolution-core";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { persistProducedEvolutionPreviews } from "../../diagnosis/diagnose-evolution-preview-store.js";
import type { DiagnoseGrowthAssessment } from "../../diagnosis/diagnose-growth-assessment.js";
import { persistGrowthAssessmentSnapshot } from "../../diagnosis/diagnose-growth-snapshot.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { buildStructuralEvolutionCandidate } from "../../diagnosis/structural-evolution-candidate.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import {
  readRobotWorkingStyleOrDefault,
  updateRobotWorkingStyle,
} from "../agent-growth/working-style-store.js";
import { createEvolutionControlHandlers } from "../server-methods/evolution-control.js";
import type { GatewayClient, GatewayRequestHandler } from "../server-methods/types.js";
import type { SkillLifecyclePort, SkillRecord } from "./adapters/skill.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { setEvolutionApplyAuthPortsForTests } from "./apply-authorization.js";
import {
  createMemoryCandidateStore,
  sealDiagnosisGovernedCandidate,
  sealGovernedCandidate,
} from "./candidate-store.js";
import { confirmDiagnosisCandidatePreview } from "./confirm-diagnosis-candidate.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { recommendDiagnosisApplyFollowUp } from "./diagnosis-apply-gate.js";
import { createLiveDiagnosisRecheckPort } from "./diagnosis-recheck-observer.js";
import {
  alignDiagnosisExperimentFreeze,
  createControlPlaneDiagnosisSubmitPorts,
  defaultSnapshotReader,
  workingDnaBaselineHash,
  type DiagnosisGrantView,
  type DiagnosisSubmitDeps,
} from "./submit-diagnosis-candidate.js";
import {
  TEST_ALLOWED_ACTIONS,
  createPassingObservationProvider,
  testInspector,
  withWorkingDnaExternal,
} from "./test-support.js";

const dirs: string[] = [];
const NOW = "2026-09-19T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const TENANT = "tenant-a6";
const OTHER_TENANT = "tenant-a6-other";
const AGENT = "a6-bot";
const EVIDENCE = ["obs:pattern:reporting-cadence-1", "evidence:task-result-1"] as const;
const DIR = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  setEvolutionApplyAuthPortsForTests();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-a6-"));
  dirs.push(dir);
  return dir;
}

function hasSubsequence(actual: readonly string[], expected: readonly string[]): boolean {
  let index = 0;
  for (const item of actual) {
    if (item === expected[index]) {
      index += 1;
    }
    if (index === expected.length) {
      return true;
    }
  }
  return false;
}

type ResultMode = "improved" | "neutral" | "regressed" | "inconclusive";

async function boot(options?: {
  mode?: ResultMode;
  sourceMechanismRef?: string;
  expiresAt?: string;
  killSwitch?: boolean;
  inspector?: EvolutionAuthorizationInspector;
  evaluate?: boolean;
  proposalId?: string;
  candidateRef?: string;
}) {
  const agentDir = tempDir();
  const persistDir = tempDir();
  const cfg = { agents: { list: [{ id: AGENT, agentDir }] } } as unknown as OpenBotConfig;
  const mode = options?.mode ?? "improved";
  const inner = createPassingObservationProvider();
  const proposalId = options?.proposalId ?? "evo:a6-wdna";
  const candidateRef = options?.candidateRef ?? "cand:a6-wdna";
  const plane = createEvolutionControlPlane({
    inspector: options?.inspector ?? testInspector(TENANT),
    workingDnaAdapter: createWorkingDnaAdapter(cfg),
    observationProvider: {
      captureBaseline: (input) => inner.captureBaseline(input),
      async collect(input) {
        const row = await inner.collect(input);
        if (mode === "neutral") {
          return { ...row, primary: { ...row.primary, treatment: row.primary.baseline } };
        }
        if (mode === "regressed") {
          return {
            ...row,
            primary: { ...row.primary, treatment: row.primary.baseline - 0.2 },
          };
        }
        if (mode === "inconclusive") {
          return { ...row, sampleSize: 0 };
        }
        return row;
      },
    },
    persistDir,
    now: () => NOW,
    isKillSwitchActive: () => options?.killSwitch === true,
    ...withWorkingDnaExternal(cfg),
  });
  plane.registerProposal(
    {
      schemaVersion: 2,
      proposalId,
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: options?.sourceMechanismRef ?? "diagnosis.behavior.reporting_cadence_gap",
      target: { domain: "agent", agentId: AGENT },
      candidateRef,
      surfaceId: "agent.working-dna",
      expectedEffects: [
        { metricId: "task_success_rate", improveWhen: "increase", minimumEffect: 0.02 },
      ],
      riskLevel: "medium",
      confidentialityScope: "enterprise",
      tenantScope: TENANT,
      grantId: "grant-1",
      status: "APPROVED_FOR_EXPERIMENT",
      createdAt: "2026-09-19T10:00:00.000Z",
      expiresAt: options?.expiresAt ?? "2026-09-20T00:00:00.000Z",
    },
    {
      agentId: AGENT,
      delta: { reportingCadence: "milestone" as const },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: candidateRef,
    },
  );
  const experiment = await plane.startExperiment({
    commandId: `exp-${proposalId}`,
    proposalId,
    now: NOW,
    freeze: {
      baselineVersion: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
      candidateVersion: candidateRef,
      codeSha: "sha-a6",
      modelRef: "model-a6",
      providerVersion: "provider-a6",
      configSnapshotRef: "cfg-a6",
      datasetOrCohortRef: "cohort-a6",
      tenantScope: TENANT,
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-20T00:00:00.000Z",
      maxResourceBudget: 1,
    },
  });
  if (options?.evaluate !== false) {
    await plane.evaluateExperiment(experiment.experimentId);
  }
  return { plane, cfg, persistDir, proposalId, candidateRef, experiment };
}

function applyInput(
  proposalId: string,
  experimentId: string,
  commandId: string,
  scope: "shadow" | "canary" | "active" = "active",
) {
  return {
    commandId,
    proposalId,
    experimentId,
    principalRef: "ent-admin",
    trustedTenantId: TENANT,
    scope,
  };
}

function clientFor(tenantId: string, scopes?: string[], user = "ent-admin"): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "ctrl",
        displayName: "ctrl",
        version: "1",
        platform: "web",
        mode: "webchat",
      },
      ...(scopes ? { scopes } : {}),
    },
    user,
    sessionEnterpriseId: tenantId,
    sessionTenantId: tenantId,
  };
}

function invoke(
  handler: GatewayRequestHandler,
  params: Record<string, unknown>,
  client: GatewayClient | null,
) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: { message?: string } }>(
    (resolve) => {
      void handler({
        req: { id: "1", method: "test", type: "req" },
        params,
        client,
        isWebchatConnect: () => false,
        respond: (ok, payload, error) => {
          resolve({ ok, payload, error: error as { message?: string } | undefined });
        },
        context: {} as never,
      });
    },
  );
}

function skillRecord(version: string, enabled: boolean): SkillRecord {
  return {
    skillId: "briefing",
    name: "Briefing",
    summary: "brief",
    lifecycle: "published",
    version,
    successRate: 1,
    installations: {
      "agent-a": { installed: true, installedVersion: version, enabled },
    },
  };
}

function skillPort(record: SkillRecord | undefined): SkillLifecyclePort {
  return {
    get: () => record,
    installation: () => record?.installations["agent-a"],
    publish: () => {
      throw new Error("publish must not decide RESOLVED");
    },
    install: () => {
      throw new Error("installSkill must not decide RESOLVED");
    },
    promote: () => {
      throw new Error("promote must not decide RESOLVED");
    },
    restoreLifecycle: () => undefined,
    restoreInstallation: () => undefined,
  };
}

function skillRequest(): DiagnosisRecheckRequest {
  return {
    verificationRef: {
      schemaVersion: 1,
      proposalId: "evo:skill-a6",
      experimentId: "exp-skill-a6",
      applicationId: "app-skill-a6",
      verificationId: "ver-skill-a6",
    },
    target: { domain: "capability", skillId: "briefing" },
    findingRefs: ["finding-skill-1"],
    surfaceId: "capability.skill-installation",
    tenantScope: TENANT,
  };
}

describe("A6 diagnosis controlled apply", () => {
  it("rejects a governed version that is not the candidate ref and writes nothing", () => {
    const store = createMemoryCandidateStore();
    const payload = { candidateVersion: "content-hash", delta: { reportingCadence: "milestone" } };
    expect(() => sealGovernedCandidate("cand:a6", payload, "other-version")).toThrow(
      /governed version must equal candidateRef/,
    );
    expect(store.get("cand:a6")).toBeUndefined();
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
    });
    expect(() => plane.registerCandidate("cand:a6", payload, "other-version")).toThrow(
      /governed version must equal candidateRef/,
    );
    expect(plane.getCandidate("cand:a6")).toBeUndefined();
    const sealed = sealDiagnosisGovernedCandidate("cand:a6", payload);
    expect(sealed.version).toBe("cand:a6");
    expect(sealed.payload).toMatchObject({ candidateVersion: "content-hash" });
    store.put(sealed);
    expect(store.get("cand:a6")?.version).toBe("cand:a6");
  });

  it("rejects payload hash tamper and candidateRef rebind with zero writes", async () => {
    const tamper = await boot({ evaluate: false });
    const stored = tamper.plane.getCandidate(tamper.candidateRef);
    expect(stored).toBeTruthy();
    const payload = stored?.payload as { delta: { reportingCadence: string } };
    payload.delta.reportingCadence = "periodic";
    await expect(
      tamper.plane.applyWorkingDna(
        applyInput(tamper.proposalId, tamper.experiment.experimentId, "apply-tamper"),
      ),
    ).rejects.toThrow(/payload hash mismatch/);
    expect(tamper.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(tamper.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    const rebound = await boot({
      evaluate: false,
      proposalId: "evo:a6-rebind",
      candidateRef: "cand:a6-rebind",
    });
    const row = rebound.plane.getCandidate(rebound.candidateRef);
    expect(row).toBeTruthy();
    if (row) {
      row.candidateRef = "cand:other";
    }
    await expect(
      rebound.plane.applyWorkingDna(
        applyInput(rebound.proposalId, rebound.experiment.experimentId, "apply-rebind"),
      ),
    ).rejects.toThrow(/not the proposal candidate/);
    expect(rebound.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(rebound.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );
  });

  it("does not Apply until the operator calls apply, and rejects non-improved results", async () => {
    const pending = await boot({ evaluate: false });
    const observed = await pending.plane.applyWorkingDna(
      applyInput(pending.proposalId, pending.experiment.experimentId, "apply-pending", "canary"),
    );
    expect(observed.scope).toBe("canary");
    expect(
      pending.plane.getExperiment(pending.experiment.experimentId)?.applyApproval,
    ).toBeUndefined();
    await expect(
      pending.plane.applyWorkingDna(
        applyInput(
          pending.proposalId,
          pending.experiment.experimentId,
          "apply-pending-active",
          "active",
        ),
      ),
    ).rejects.toThrow(/awaiting operator approval/);
    expect(pending.plane.listApplications().some((row) => row.scope === "active")).toBe(false);

    for (const mode of ["neutral", "regressed", "inconclusive"] as const) {
      const held = await boot({
        mode,
        proposalId: `evo:a6-${mode}`,
        candidateRef: `cand:a6-${mode}`,
      });
      expect(held.plane.getExperiment(held.experiment.experimentId)?.result).toBe(mode);
      expect(held.plane.getExperiment(held.experiment.experimentId)?.applyApproval).toBeUndefined();
      await expect(
        held.plane.applyWorkingDna(
          applyInput(held.proposalId, held.experiment.experimentId, `apply-${mode}`, "active"),
        ),
      ).rejects.toThrow(/awaiting operator approval/);
      expect(held.plane.listApplications()).toEqual([]);
      expect((await readRobotWorkingStyleOrDefault(held.cfg, AGENT)).reportingCadence).toBe(
        "on_completion",
      );
    }

    const improved = await boot({ proposalId: "evo:a6-wait", candidateRef: "cand:a6-wait" });
    expect(improved.plane.getExperiment(improved.experiment.experimentId)?.result).toBe("improved");
    expect(improved.plane.getExperiment(improved.experiment.experimentId)?.applyApproval).toBe(
      "pending_apply_approval",
    );
    expect(improved.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(improved.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );
  });

  it("rejects expired proposals, revoked grants, and the kill switch with zero writes", async () => {
    const expired = await boot({
      expiresAt: "2026-09-19T11:00:00.000Z",
      proposalId: "evo:a6-expired",
      candidateRef: "cand:a6-expired",
    });
    await expect(
      expired.plane.applyWorkingDna(
        applyInput(expired.proposalId, expired.experiment.experimentId, "apply-expired"),
      ),
    ).rejects.toThrow(/expired/);
    expect(expired.plane.listApplications()).toEqual([]);

    let grantStatus = "APPROVED";
    const inspector: EvolutionAuthorizationInspector = {
      inspect: () => ({
        grantId: "grant-1",
        status: grantStatus,
        tenantScope: TENANT,
        allowedEvidence: ["ev-a"],
        allowedActions: [...TEST_ALLOWED_ACTIONS, "inspect"],
        confidentialityCeiling: "enterprise",
      }),
    };
    const revoked = await boot({
      inspector,
      proposalId: "evo:a6-revoked",
      candidateRef: "cand:a6-revoked",
    });
    grantStatus = "REVOKED";
    await expect(
      revoked.plane.applyWorkingDna(
        applyInput(revoked.proposalId, revoked.experiment.experimentId, "apply-revoked"),
      ),
    ).rejects.toThrow(/revok/i);
    expect(revoked.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(revoked.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    const killed = await boot({
      killSwitch: true,
      proposalId: "evo:a6-kill",
      candidateRef: "cand:a6-kill",
    });
    await expect(
      killed.plane.applyWorkingDna(
        applyInput(killed.proposalId, killed.experiment.experimentId, "apply-kill"),
      ),
    ).rejects.toThrow(/kill switch/);
    expect(killed.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(killed.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );
  });

  it("still allows a non-diagnosis canary before evaluation", async () => {
    const manual = await boot({
      evaluate: false,
      sourceMechanismRef: "case.manual",
      proposalId: "evo:a6-manual",
      candidateRef: "cand:a6-manual",
    });
    const applied = await manual.plane.applyWorkingDna(
      applyInput(manual.proposalId, manual.experiment.experimentId, "apply-manual", "canary"),
    );
    expect(applied.appliedToRuntime).toBe(true);
    expect(manual.plane.getExperiment(manual.experiment.experimentId)?.result).toBe("pending");
    expect((await readRobotWorkingStyleOrDefault(manual.cfg, AGENT)).reportingCadence).toBe(
      "milestone",
    );
  });

  it("keeps command ids idempotent and rejects retargeting them onto another object", async () => {
    const ready = await boot();
    const first = await ready.plane.applyWorkingDna(
      applyInput(ready.proposalId, ready.experiment.experimentId, "cmd-apply"),
    );
    const replay = await ready.plane.applyWorkingDna(
      applyInput(ready.proposalId, ready.experiment.experimentId, "cmd-apply"),
    );
    expect(replay.applicationId).toBe(first.applicationId);
    expect(ready.plane.listApplications()).toHaveLength(1);
    await expect(
      ready.plane.applyWorkingDna(
        applyInput("evo:other", ready.experiment.experimentId, "cmd-apply"),
      ),
    ).rejects.toThrow(/cannot retarget/);
    expect(ready.plane.listApplications()).toHaveLength(1);

    await expect(
      ready.plane.verifyApplication({
        commandId: "cmd-apply",
        applicationId: first.applicationId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
        now: "2026-09-19T12:10:00.000Z",
      }),
    ).rejects.toThrow(/distinct from apply/);

    const verification = await ready.plane.verifyApplication({
      commandId: "cmd-verify",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      now: "2026-09-19T12:10:00.000Z",
    });
    expect(verification.verificationId).toBe("ver:cmd-verify");
    expect(verification.verificationId).not.toBe(first.applicationId);
    await expect(
      ready.plane.applyWorkingDna(
        applyInput(ready.proposalId, ready.experiment.experimentId, "cmd-verify"),
      ),
    ).rejects.toThrow(/distinct from verify/);
    expect(ready.plane.listApplications()).toHaveLength(1);
    expect(ready.plane.getProposal(ready.proposalId)?.status).toBe("VERIFIED");
  });

  it("reads Working DNA back from the style store and does not mark a mismatch VERIFIED", async () => {
    const ready = await boot({ proposalId: "evo:a6-mismatch", candidateRef: "cand:a6-mismatch" });
    const applied = await ready.plane.applyWorkingDna(
      applyInput(ready.proposalId, ready.experiment.experimentId, "apply-mismatch"),
    );
    const written = await readRobotWorkingStyleOrDefault(ready.cfg, AGENT);
    expect(workingDnaBaselineHash(written)).toBe(applied.targetVersionAfter);
    await updateRobotWorkingStyle(ready.cfg, AGENT, (current) => ({
      ...current,
      reportingCadence: "periodic",
    }));
    const verification = await ready.plane.verifyApplication({
      commandId: "ver-mismatch",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      now: "2026-09-19T12:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    expect(ready.plane.getProposal(ready.proposalId)?.status).not.toBe("VERIFIED");
    const port = createLiveDiagnosisRecheckPort({
      cfg: ready.cfg,
      readApplication: async () => ({
        targetVersionBefore: applied.targetVersionBefore,
        targetVersionAfter: applied.targetVersionAfter,
        agentId: AGENT,
        tenantScope: TENANT,
        effectWindowRef: `obs:window:${applied.applicationId}`,
      }),
    });
    const recheck = await port.recheck({
      verificationRef: {
        schemaVersion: 1,
        proposalId: ready.proposalId,
        experimentId: ready.experiment.experimentId,
        applicationId: applied.applicationId,
        verificationId: verification.verificationId,
      },
      target: { domain: "agent", agentId: AGENT },
      findingRefs: ["finding-a6"],
      surfaceId: "agent.working-dna",
      tenantScope: TENANT,
    });
    expect(recheck.outcome).toBe("REGRESSED");
    expect(
      recommendDiagnosisApplyFollowUp({
        recheckOutcome: recheck.outcome,
        guardrailRegressed: verification.guardrailResults.some(
          (row) => row.degraded && row.critical,
        ),
      }),
    ).toBe("rollback");
    expect(ready.plane.getProposal(ready.proposalId)?.status).not.toBe("PROMOTED");
  });

  it("resolves a diagnosis apply only after SoT readback, then recommends promote without promoting", async () => {
    const configDir = tempDir();
    const agentDir = tempDir();
    const persistDir = tempDir();
    const cfg = { agents: { list: [{ id: AGENT, agentDir }] } } as unknown as OpenBotConfig;
    const snapshot = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    const built = buildStructuralEvolutionCandidate({
      structuralIntent: "adjust_reporting_cadence",
      proposedChange: { field: "reportingCadence", value: "milestone" },
      surfaceId: "agent.working-dna",
      targetHint: "agent:other-hint",
      baselineHash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
      observationRef: EVIDENCE[0],
      evidenceRefs: [EVIDENCE[1]],
      snapshotRef: snapshot!.snapshotId,
      reportRef: "cdr-a6-1",
      findingRef: "finding-a6",
      observedWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    persistProducedEvolutionPreviews({
      report: {
        producer: { structuralCandidates: [built.candidate], skillInstallationCandidates: [] },
      },
      tenantId: TENANT,
      configDir,
      nowMs: NOW_MS,
    });
    const plane = createEvolutionControlPlane({
      inspector: operatorInspector(),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: createPassingObservationProvider(),
      persistDir,
      now: () => NOW,
      ...withWorkingDnaExternal(cfg),
    });
    const deps: DiagnosisSubmitDeps = {
      ports: createControlPlaneDiagnosisSubmitPorts(
        plane,
        path.join(persistDir, "diagnosis-ingest-wal.json"),
      ),
      inspectGrant: () => confirmGrant(),
      readSnapshot: defaultSnapshotReader(configDir, NOW_MS),
      readBaseline: (agentId) =>
        agentId === AGENT
          ? { style: DEFAULT_WORKING_STYLE, hash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE) }
          : null,
      now: () => NOW,
    };
    const confirmed = await confirmDiagnosisCandidatePreview({
      commandId: "cmd-a6-confirm",
      grantId: "grant-1",
      candidateVersion: built.candidate.candidateVersion,
      tenantId: TENANT,
      principalRef: "user-1",
      confirmedByUser: true,
      configDir,
      nowMs: NOW_MS,
      deps,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(plane.listApplications()).toEqual([]);
    const stored = plane.getCandidate(confirmed.receipt.candidateRef);
    expect(stored?.version).toBe(confirmed.receipt.candidateRef);
    expect(stored?.version).not.toBe(built.candidate.candidateVersion);

    const proposal = plane.getProposal(confirmed.receipt.proposalId);
    const experiment = await plane.startExperiment({
      commandId: "exp-a6-live",
      proposalId: confirmed.receipt.proposalId,
      now: NOW,
      freeze: alignDiagnosisExperimentFreeze(proposal!, stored, null)!,
    });
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("EXPERIMENTING");
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.experiment.result).toBe("improved");
    expect(evaluated.experiment.applyApproval).toBe("pending_apply_approval");
    expect(plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    const applied = await plane.applyWorkingDna(
      applyInput(confirmed.receipt.proposalId, experiment.experimentId, "apply-a6-live"),
    );
    const style = await readRobotWorkingStyleOrDefault(cfg, AGENT);
    expect(style.reportingCadence).toBe("milestone");
    expect(workingDnaBaselineHash(style)).toBe(applied.targetVersionAfter);
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("ACTIVE");

    const verification = await plane.verifyApplication({
      commandId: "ver-a6-live",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      now: "2026-09-19T12:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("VERIFIED");
    const port = createLiveDiagnosisRecheckPort({
      cfg,
      readApplication: async () => ({
        targetVersionBefore: applied.targetVersionBefore,
        targetVersionAfter: applied.targetVersionAfter,
        agentId: AGENT,
        tenantScope: TENANT,
        effectWindowRef: `obs:window:${applied.applicationId}`,
      }),
    });
    const recheck = await port.recheck({
      verificationRef: {
        schemaVersion: 1,
        proposalId: confirmed.receipt.proposalId,
        experimentId: experiment.experimentId,
        applicationId: applied.applicationId,
        verificationId: verification.verificationId,
      },
      target: { domain: "agent", agentId: AGENT },
      findingRefs: ["finding-a6"],
      surfaceId: "agent.working-dna",
      tenantScope: TENANT,
    });
    expect(recheck.outcome).toBe("RESOLVED");
    const guardrailRegressed = verification.guardrailResults.some(
      (row) => row.degraded && row.critical,
    );
    expect(
      recommendDiagnosisApplyFollowUp({ recheckOutcome: recheck.outcome, guardrailRegressed }),
    ).toBe("promote");
    expect(plane.getProposal(confirmed.receipt.proposalId)?.status).toBe("VERIFIED");

    const types = plane.ledger
      .list({ proposalId: confirmed.receipt.proposalId })
      .map((row) => row.type);
    expect(
      hasSubsequence(types, [
        "proposal.created",
        "experiment.started",
        "experiment.completed",
        "application.approval_pending",
        "application.applied",
        "external_effect.recorded",
        "verification.completed",
      ]),
    ).toBe(true);
    expect(types).not.toContain("promotion.completed");

    const restored = createEvolutionControlPlane({
      inspector: operatorInspector(),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: createPassingObservationProvider(),
      persistDir,
      now: () => NOW,
      ...withWorkingDnaExternal(cfg),
    });
    expect(restored.getProposal(confirmed.receipt.proposalId)?.status).toBe("VERIFIED");
    expect(restored.getCandidate(confirmed.receipt.candidateRef)?.version).toBe(
      confirmed.receipt.candidateRef,
    );
    expect(restored.getApplication(applied.applicationId)?.targetVersionAfter).toBe(
      applied.targetVersionAfter,
    );
    expect(restored.getVerification(verification.verificationId)?.outcome).toBe("improved");
    expect(
      restored.ledger
        .list({ proposalId: confirmed.receipt.proposalId })
        .some((row) => row.type === "application.approval_pending"),
    ).toBe(true);
  });

  it("requires operator.approvals and ignores client-declared identity", async () => {
    const ready = await boot({ proposalId: "evo:a6-rpc", candidateRef: "cand:a6-rpc" });
    const handlers = createEvolutionControlHandlers(() => ready.plane);
    const params = {
      commandId: "apply-rpc",
      proposalId: ready.proposalId,
      experimentId: ready.experiment.experimentId,
      scope: "active",
    };
    const admin = await invoke(
      handlers["evolution.applications.apply"],
      params,
      clientFor(TENANT, ["operator.admin"]),
    );
    expect(admin.ok).toBe(false);
    expect(admin.error?.message).toMatch(/operator\.approvals/);
    expect(ready.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    const forgedTenant = await invoke(
      handlers["evolution.applications.apply"],
      { ...params, tenantId: TENANT },
      clientFor(TENANT, ["operator.approvals"]),
    );
    expect(forgedTenant.ok).toBe(false);
    expect(forgedTenant.error?.message).toMatch(/cannot declare principalRef or tenantId/);
    const forgedPrincipal = await invoke(
      handlers["evolution.applications.apply"],
      { ...params, principalRef: "someone-else" },
      clientFor(TENANT, ["operator.approvals"]),
    );
    expect(forgedPrincipal.ok).toBe(false);
    expect(forgedPrincipal.error?.message).toMatch(/cannot declare principalRef or tenantId/);
    const anonymous = await invoke(
      handlers["evolution.applications.apply"],
      params,
      clientFor(TENANT, ["operator.approvals"], ""),
    );
    expect(anonymous.ok).toBe(false);
    expect(anonymous.error?.message).toMatch(/operator identity is required/);

    const crossTenant = await invoke(
      handlers["evolution.applications.apply"],
      params,
      clientFor(OTHER_TENANT, ["operator.admin", "operator.approvals"]),
    );
    expect(crossTenant.ok).toBe(false);
    expect(crossTenant.error?.message).toMatch(/proposal not found|operator session is required/);
    expect(ready.plane.listApplications()).toEqual([]);
    expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
      "on_completion",
    );

    setEvolutionApplyAuthPortsForTests({
      resolveActor: async () => ({
        sessionKind: "enterprise-admin",
        membershipRole: "enterprise-admin",
        tenantId: TENANT,
        userId: "ceo-session",
      }),
      resolveObject: async () => ({
        tenantId: TENANT,
        targetId: `agent:${AGENT}`,
        objectKind: "enterprise",
        ownerUserId: null,
      }),
      resolveGrant: async () => null,
    });
    const session = clientFor(TENANT, ["operator.approvals"], "ceo-session");
    session.sessionKind = "enterprise-admin";
    session.platformUserId = "ceo-session";
    session.sessionMembershipId = "mem-ceo";
    const allowed = await invoke(
      handlers["evolution.applications.apply"],
      { ...params, scope: "canary" },
      session,
    );
    expect(allowed.ok).toBe(true);
    const application = ready.plane.listApplications().find((row) => row.scope === "canary");
    expect(application?.scope).toBe("canary");
    expect((await readRobotWorkingStyleOrDefault(ready.cfg, AGENT)).reportingCadence).toBe(
      "milestone",
    );
    const verifyDenied = await invoke(
      handlers["evolution.applications.verify"],
      {
        commandId: "ver-rpc",
        applicationId: application?.applicationId,
        principalRef: "ceo-session",
      },
      clientFor(TENANT, ["operator.admin"]),
    );
    expect(verifyDenied.ok).toBe(false);
    expect(verifyDenied.error?.message).toMatch(
      /cannot declare principalRef or tenantId|operator\.approvals/,
    );
    expect(ready.plane.getProposal(ready.proposalId)?.status).toBe("CANARY");
  });

  it("reads skill installation from the lifecycle store", async () => {
    const observerSource = readFileSync(join(DIR, "diagnosis-recheck-observer.ts"), "utf8");
    const recheckSource = readFileSync(
      join(DIR, "../../diagnosis/diagnose-evolution-recheck.ts"),
      "utf8",
    );
    expect(observerSource).not.toMatch(/installSkillToRobotAsset/);
    expect(recheckSource).not.toMatch(/installSkillToRobotAsset|applyWorkingDna/);
    const matched = "skill:published:1.2.0:installed";
    const application = {
      targetVersionBefore: "skill:published:1.0.0:missing",
      targetVersionAfter: matched,
      agentId: "agent-a",
      tenantScope: TENANT,
      effectWindowRef: "obs:window:app-skill",
    };
    const resolved = await createLiveDiagnosisRecheckPort({
      skillPort: skillPort(skillRecord("1.2.0", true)),
      readApplication: async () => application,
    }).recheck(skillRequest());
    expect(resolved.outcome).toBe("RESOLVED");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: resolved.outcome })).toBe("promote");

    const wrongVersion = await createLiveDiagnosisRecheckPort({
      skillPort: skillPort(skillRecord("9.9.9", true)),
      readApplication: async () => application,
    }).recheck(skillRequest());
    expect(wrongVersion.outcome).toBe("STILL_OPEN");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: wrongVersion.outcome })).toBe("hold");

    const disabled = await createLiveDiagnosisRecheckPort({
      skillPort: skillPort(skillRecord("1.2.0", false)),
      readApplication: async () => application,
    }).recheck(skillRequest());
    expect(disabled.outcome).toBe("STILL_OPEN");

    const missing = await createLiveDiagnosisRecheckPort({
      skillPort: skillPort(undefined),
      readApplication: async () => application,
    }).recheck(skillRequest());
    expect(missing.outcome).not.toBe("RESOLVED");
    expect(missing.outcome).toBe("INCONCLUSIVE");
  });

  it("maps joint recheck facts without bypassing the promote gate", () => {
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "RESOLVED" })).toBe("promote");
    expect(
      recommendDiagnosisApplyFollowUp({ recheckOutcome: "RESOLVED", guardrailRegressed: true }),
    ).toBe("rollback");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "STILL_OPEN" })).toBe("hold");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "REGRESSED" })).toBe("rollback");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "INCONCLUSIVE" })).toBe("observe");
    expect(recommendDiagnosisApplyFollowUp({ recheckOutcome: "BLOCKED" })).toBe("fail-closed");
    expect(
      recommendDiagnosisApplyFollowUp({ recheckOutcome: "RESOLVED", sotReadable: false }),
    ).toBe("fail-closed");
  });
});

function assessment(): DiagnoseGrowthAssessment {
  return {
    agentId: AGENT,
    tenantId: TENANT,
    agentAssetId: "asset-1",
    targetOwnerId: "owner-1",
    groupId: null,
    objectLabel: "市场助手",
    displayName: "市场助手",
    identity: {
      readable: true,
      bootstrapPending: false,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: true,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 2,
    reportFileCount: 1,
    freshArtifactCount: 2,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 1 },
    activitySources: ["memory_file"],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

function operatorInspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT,
      allowedEvidence: [...EVIDENCE],
      allowedActions: ["suggest", "experiment", "inspect", "apply", "verify"],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function confirmGrant(): DiagnosisGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: TENANT,
    agentId: AGENT,
    allowedEvidence: [...EVIDENCE],
    allowedActions: ["suggest", "experiment", "inspect"],
    confidentialityCeiling: "enterprise",
  };
}
