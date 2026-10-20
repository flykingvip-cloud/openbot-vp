import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skillMetricSet } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createDiagnosisRecheckPort } from "../../diagnosis/diagnose-evolution-recheck.js";
import { skillInstallationBaselineHash } from "../../diagnosis/skill-installation-candidate.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { updateRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import type { SkillLifecyclePort, SkillRecord } from "./adapters/skill.js";
import {
  createLiveDiagnosisRecheckObserver,
  skillInstallationRelationHash,
} from "./diagnosis-recheck-observer.js";
import { workingDnaBaselineHash } from "./submit-diagnosis-candidate.js";
import { evaluateSkillInstallationClosure } from "./working-dna-evaluation.js";

const OBSERVER_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "diagnosis-recheck-observer.ts"),
  "utf8",
);

function skillPort(input: {
  installed: boolean;
  agentId?: string;
  version?: string;
  enabled?: boolean;
  missing?: boolean;
}): SkillLifecyclePort {
  const record: SkillRecord = {
    skillId: "briefing",
    name: "briefing",
    summary: "briefing",
    lifecycle: "published",
    version: input.version ?? "1.0.0",
    successRate: 1,
    installations:
      input.installed && input.agentId
        ? {
            [input.agentId]: {
              installed: true,
              installedVersion: input.version ?? "1.0.0",
              enabled: input.enabled ?? true,
            },
          }
        : input.installed
          ? { "bot-2": { installed: true, installedVersion: "1.0.0", enabled: true } }
          : {},
  };
  return {
    get: (skillId) => {
      if (skillId === "throw") {
        throw new Error("skill-store-unreadable");
      }
      if (input.missing || skillId !== "briefing") {
        return undefined;
      }
      return record;
    },
    installation: (agentId, skillId) =>
      skillId === "briefing" ? record.installations[agentId] : undefined,
    publish: () => record,
    install: () => record,
    promote: () => record,
    restoreLifecycle: () => undefined,
    restoreInstallation: () => undefined,
  };
}

function request(over: Record<string, unknown> = {}) {
  return {
    verificationRef: {
      schemaVersion: 1 as const,
      proposalId: "evo:c4",
      experimentId: "exp-c4",
      applicationId: "app-c4",
      verificationId: "ver-c4",
    },
    target: { domain: "capability" as const, skillId: "briefing" },
    findingRefs: ["finding-c4-1"],
    surfaceId: "capability.skill-installation",
    tenantScope: "tenant-a",
    ...over,
  };
}

describe("createLiveDiagnosisRecheckObserver", () => {
  it("treats an uninstalled skill as store-unchanged", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({ skillPort: skillPort({ installed: false }) }),
    );
    const result = await port.recheck(request());
    expect(result.outcome).toBe("STILL_OPEN");
    expect(result.reasonCode).toBe("sot_unchanged");
    expect(result.observedEvidenceRefs[0]).toContain(
      skillInstallationBaselineHash("briefing", false).slice(0, 12),
    );
  });

  it("resolves an installed matching relation and lets B policy decide Promote", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        skillPort: skillPort({ installed: true }),
        readApplication: async () => ({
          targetVersionBefore: "skill:published:1.0.0:missing",
          targetVersionAfter: "skill:published:1.0.0:installed",
          agentId: "bot-2",
          tenantScope: "tenant-a",
          effectWindowRef: "obs:window:skill-1",
        }),
      }),
    );
    const result = await port.recheck({
      verificationRef: {
        schemaVersion: 1,
        proposalId: "evo:skill-e3",
        experimentId: "exp-skill-e3",
        applicationId: "app-skill-e3",
        verificationId: "ver-skill-e3",
      },
      target: { domain: "capability", skillId: "briefing" },
      findingRefs: ["ev-a"],
      surfaceId: "capability.skill-installation",
      tenantScope: "tenant-a",
    });
    expect(result.outcome).toBe("RESOLVED");
    const metrics = skillMetricSet();
    const decision = await evaluateSkillInstallationClosure({
      proposal: {
        schemaVersion: 2,
        proposalId: "evo:skill-e3",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "diagnosis.capability.install_gap",
        target: { domain: "capability", skillId: "briefing" },
        candidateRef: "cand:skill-e3",
        surfaceId: "capability.skill-installation",
        expectedEffects: [metrics.primary],
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        tenantScope: "tenant-a",
        grantId: "grant-1",
        status: "VERIFIED",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
        experimentId: "exp-skill-e3",
        applicationId: "app-skill-e3",
        verificationId: "ver-skill-e3",
      },
      experiment: {
        schemaVersion: 1,
        experimentId: "exp-skill-e3",
        proposalId: "evo:skill-e3",
        surfaceId: "capability.skill-installation",
        target: { domain: "capability", skillId: "briefing" },
        tenantScope: "tenant-a",
        baselineRef: "baseline",
        candidateRef: "cand:skill-e3",
        configRef: "cfg-fixture",
        assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
        primaryMetric: metrics.primary,
        guardrailMetrics: metrics.guardrails,
        minimumSampleSize: 20,
        requiredConfidence: 0.9,
        result: "improved",
        frozen: {
          baselineVersion: "skill:published:1.0.0",
          candidateVersion: "cand:skill-e3",
          codeSha: "sha",
          modelRef: "model",
          providerVersion: "provider",
          configSnapshotRef: "cfg",
          datasetOrCohortRef: "cohort-skill",
          tenantScope: "tenant-a",
          confidentialityScope: "enterprise",
          expiresAt: "2026-09-07T00:00:00.000Z",
          maxResourceBudget: 1,
        },
        baselineCapture: {
          status: "frozen",
          primaryPresent: true,
          missingCriticalGuardrails: [],
        },
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      verification: {
        schemaVersion: 1,
        verificationId: "ver-skill-e3",
        applicationId: "app-skill-e3",
        baselineWindowRef: "baseline",
        evaluationWindowRef: "treatment",
        primaryEffect: 0.2,
        guardrailResults: [],
        sampleSize: 40,
        confidence: 0.95,
        outcome: "improved",
        evidenceRefs: ["ev-a"],
        verifiedAt: "2026-09-06T11:10:00.000Z",
      },
      externalEffectOutcome: "verified",
      drills: [
        {
          schemaVersion: 1,
          drillId: "drill-skill-1",
          proposalId: "evo:skill-e3",
          experimentId: "exp-skill-e3",
          applicationId: "app-skill-e3",
          targetVersionBefore: "skill:published:1.0.0",
          targetVersionAfter: "skill:published:1.0.0:installed",
          restoredVersion: "skill:published:1.0.0",
          startedAt: "2026-09-06T11:06:00.000Z",
          completedAt: "2026-09-06T11:07:00.000Z",
          result: "passed",
          domainReceiptRef: "receipt",
          verifiedBy: "ent-admin",
          evidenceRefs: ["ev-a"],
        },
      ],
      authorityOk: true,
      recheckPort: port,
    });
    expect(decision).toEqual({ action: "promote", reasonCode: "evaluation_passed" });
    expect(OBSERVER_SOURCE).not.toMatch(/\badapter\.apply\s*\(/);
    expect(OBSERVER_SOURCE).not.toMatch(/\bstartExperiment\s*\(/);
  });

  it("resolves when the target agent has the expected install relation", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        skillPort: skillPort({
          installed: true,
          agentId: "bot-2",
          version: "1.0.0",
          enabled: true,
        }),
        resolveExpectation: () => ({
          expectedAgentId: "bot-2",
          expectedSkillVersion: "1.0.0",
          expectedEnabled: true,
        }),
      }),
    );
    const result = await port.recheck(request());
    expect(result.outcome).toBe("RESOLVED");
    expect(result.reasonCode).toBe("sot_confirmed");
    expect(result.observedEvidenceRefs.length).toBeGreaterThan(0);
  });

  it("regresses when the installed version does not match", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        skillPort: skillPort({
          installed: true,
          agentId: "bot-2",
          version: "0.9.0",
          enabled: true,
        }),
        resolveExpectation: () => ({
          expectedAgentId: "bot-2",
          expectedSkillVersion: "1.0.0",
          expectedEnabled: true,
        }),
      }),
    );
    const result = await port.recheck(request());
    expect(result.outcome).toBe("REGRESSED");
    expect(result.reasonCode).toBe("sot_diverged");
  });

  it("blocks an empty skill target and marks a missing skill as inconclusive", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        skillPort: skillPort({ installed: false, missing: true }),
      }),
    );
    await expect(
      port.recheck(request({ target: { domain: "capability", skillId: "" } })),
    ).resolves.toEqual(
      expect.objectContaining({ outcome: "BLOCKED", reasonCode: "unknown_target" }),
    );
    await expect(port.recheck(request())).resolves.toEqual(
      expect.objectContaining({ outcome: "INCONCLUSIVE", reasonCode: "sot_missing" }),
    );
  });

  it("returns inconclusive when the skill store cannot be read", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({ skillPort: skillPort({ installed: false }) }),
    );
    await expect(
      port.recheck(request({ target: { domain: "capability", skillId: "throw" } })),
    ).resolves.toEqual(
      expect.objectContaining({ outcome: "INCONCLUSIVE", reasonCode: "sot_unreadable" }),
    );
  });
});

describe("live Working DNA recheck observer", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;
  const agentId = "dna-c4-bot";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c4-wdna-"));
    cfg = { agents: { list: [{ id: agentId, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("holds when the store still matches the baseline", async () => {
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        cfg,
        resolveExpectation: () => ({
          expectedAgentId: agentId,
          baselineHash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
          expectedHash: "style:applied",
          expectedDeltaKeys: ["reportingCadence"],
        }),
      }),
    );
    const result = await port.recheck({
      verificationRef: request().verificationRef,
      target: { domain: "agent", agentId },
      findingRefs: ["finding-wdna"],
      surfaceId: "agent.working-dna",
      tenantScope: "tenant-a",
    });
    expect(result.outcome).toBe("STILL_OPEN");
    expect(result.reasonCode).toBe("sot_unchanged");
  });

  it("resolves only after the store matches the application target version", async () => {
    await updateRobotWorkingStyle(cfg, agentId, () => ({
      ...DEFAULT_WORKING_STYLE,
      reportingCadence: "milestone",
    }));
    const expected = workingDnaBaselineHash({
      ...DEFAULT_WORKING_STYLE,
      reportingCadence: "milestone",
    });
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        cfg,
        resolveExpectation: () => ({
          expectedAgentId: agentId,
          baselineHash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
          expectedHash: expected,
          expectedDeltaKeys: ["reportingCadence"],
        }),
      }),
    );
    const result = await port.recheck({
      verificationRef: request().verificationRef,
      target: { domain: "agent", agentId },
      findingRefs: ["finding-wdna"],
      surfaceId: "agent.working-dna",
      tenantScope: "tenant-a",
    });
    expect(result.outcome).toBe("RESOLVED");
    expect(result.reasonCode).toBe("sot_confirmed");
  });

  it("regresses when the live style diverges from the expected application version", async () => {
    await updateRobotWorkingStyle(cfg, agentId, () => ({
      ...DEFAULT_WORKING_STYLE,
      reportingCadence: "periodic",
    }));
    const port = createDiagnosisRecheckPort(
      createLiveDiagnosisRecheckObserver({
        cfg,
        resolveExpectation: () => ({
          expectedAgentId: agentId,
          baselineHash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
          expectedHash: "style:applied-milestone",
          expectedDeltaKeys: ["reportingCadence"],
        }),
      }),
    );
    const result = await port.recheck({
      verificationRef: request().verificationRef,
      target: { domain: "agent", agentId },
      findingRefs: ["finding-wdna"],
      surfaceId: "agent.working-dna",
      tenantScope: "tenant-a",
    });
    expect(result.outcome).toBe("REGRESSED");
    expect(result.reasonCode).toBe("sot_diverged");
  });
});

describe("skillInstallationRelationHash", () => {
  it("changes when version or enabled state changes", () => {
    const base = skillInstallationRelationHash({
      skillId: "briefing",
      agentId: "bot-2",
      installed: true,
      version: "1.0.0",
      enabled: true,
    });
    expect(
      skillInstallationRelationHash({
        skillId: "briefing",
        agentId: "bot-2",
        installed: true,
        version: "1.1.0",
        enabled: true,
      }),
    ).not.toBe(base);
    expect(
      skillInstallationRelationHash({
        skillId: "briefing",
        agentId: "bot-2",
        installed: true,
        version: "1.0.0",
        enabled: false,
      }),
    ).not.toBe(base);
  });
});
