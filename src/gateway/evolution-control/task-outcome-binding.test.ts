import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  workingDnaMetricSet,
  type EvolutionApplication,
  type EvolutionExperiment,
  type EvolutionProposal,
} from "@openbot/evolution-core";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "../agent-growth/evolution-task-outcomes.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import { recordSkillInvocationCompleted } from "../skill-invocation/record.js";
import {
  createFileWorkingDnaObservationPort,
  createWorkingDnaAdapter,
} from "./adapters/working-dna.js";
import {
  bindOrganizationTaskRecord,
  bindSkillInvocationRecord,
  bindWorkingDnaTaskOutcomeRecord,
  resolveOrganizationTaskBinding,
  resolveSkillInvocationBinding,
  resolveWorkingDnaTaskOutcomeBinding,
} from "./task-outcome-binding.js";

const AGENT_ID = "bind-dna-bot";
const TENANT = "tenant-bind-a";
const metrics = workingDnaMetricSet();

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:bind",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case",
    target: { domain: "agent", agentId: AGENT_ID },
    candidateRef: "cand:bind",
    surfaceId: "agent.working-dna",
    expectedEffects: [metrics.primary],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: TENANT,
    grantId: "grant-1",
    status: "CANARY",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-07T00:00:00.000Z",
    experimentId: "exp-bind",
    ...over,
  };
}

function experiment(over: Partial<EvolutionExperiment> = {}): EvolutionExperiment {
  return {
    schemaVersion: 1,
    experimentId: "exp-bind",
    proposalId: "evo:bind",
    surfaceId: "agent.working-dna",
    target: { domain: "agent", agentId: AGENT_ID },
    tenantScope: TENANT,
    baselineRef: "style-seed",
    candidateRef: "cand:bind",
    configRef: "cfg",
    assignment: { strategy: "canary", treatmentRefs: ["t1"], controlRefs: ["c1"] },
    primaryMetric: metrics.primary,
    guardrailMetrics: metrics.guardrails,
    minimumSampleSize: 20,
    requiredConfidence: 0.9,
    expiresAt: "2026-09-07T00:00:00.000Z",
    result: "pending",
    frozen: {
      baselineVersion: "style-seed",
      candidateVersion: "cand:bind",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "p",
      configSnapshotRef: "cfg",
      datasetOrCohortRef: "cohort-bind",
      tenantScope: TENANT,
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-07T00:00:00.000Z",
      maxResourceBudget: 1,
    },
    ...over,
  };
}

function application(over: Partial<EvolutionApplication> = {}): EvolutionApplication {
  return {
    schemaVersion: 1,
    applicationId: "app:bind",
    proposalId: "evo:bind",
    experimentId: "exp-bind",
    adapterId: "working-dna",
    idempotencyKey: "cmd-bind",
    targetVersionBefore: "a",
    targetVersionAfter: "b",
    rollbackRef: "rb:bind",
    scope: "canary",
    status: "applied",
    appliedToRuntime: true,
    appliedAt: "2026-09-06T11:00:00.000Z",
    ...over,
  };
}

function seedPersist(
  persistDir: string,
  over: {
    applications?: EvolutionApplication[];
    proposals?: EvolutionProposal[];
    experiments?: EvolutionExperiment[];
  } = {},
): string {
  fs.mkdirSync(persistDir, { recursive: true });
  const applications = Object.fromEntries(
    (over.applications ?? [application()]).map((row) => [row.applicationId, row]),
  );
  const proposals = Object.fromEntries(
    (over.proposals ?? [proposal()]).map((row) => [row.proposalId, row]),
  );
  const experiments = Object.fromEntries(
    (over.experiments ?? [experiment()]).map((row) => [row.experimentId, row]),
  );
  fs.writeFileSync(path.join(persistDir, "applications.json"), JSON.stringify(applications));
  fs.writeFileSync(path.join(persistDir, "proposals.json"), JSON.stringify(proposals));
  fs.writeFileSync(path.join(persistDir, "experiments.json"), JSON.stringify(experiments));
  return persistDir;
}

describe("working-dna task outcome binding", () => {
  it("returns nothing when no applied experiment exists", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-empty-"), {
      applications: [],
      proposals: [],
      experiments: [],
    });
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toBeUndefined();
  });

  it("binds a live canary application and does not invent missing sensors", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-live-"));
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toEqual({
      experimentId: "exp-bind",
      applicationId: "app:bind",
      tenantId: TENANT,
      cohortRef: "cohort-bind",
      appliedAt: "2026-09-06T11:00:00.000Z",
    });
  });

  it("does not bind shadow applications", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-shadow-"), {
      applications: [application({ scope: "shadow", appliedToRuntime: false })],
    });
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toBeUndefined();
  });

  it("does not bind rolled-back or terminal proposals", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-terminal-"), {
      applications: [application({ status: "rolled_back", appliedToRuntime: false })],
      proposals: [proposal({ status: "ROLLED_BACK" })],
    });
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toBeUndefined();
  });

  it("fails closed when two live experiments match the same agent", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-ambig-"), {
      applications: [
        application(),
        application({
          applicationId: "app:other",
          proposalId: "evo:other",
          experimentId: "exp-other",
          appliedAt: "2026-09-06T12:00:00.000Z",
        }),
      ],
      proposals: [
        proposal(),
        proposal({
          proposalId: "evo:other",
          experimentId: "exp-other",
          candidateRef: "cand:other",
        }),
      ],
      experiments: [
        experiment(),
        experiment({ experimentId: "exp-other", proposalId: "evo:other" }),
      ],
    });
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toBeUndefined();
  });

  it("keeps exact caller IDs only when they match the unique live binding", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-exact-"));
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
          cohortRef: "cohort-bind",
          runId: "run-keep",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      experimentId: "exp-bind",
      applicationId: "app:bind",
      tenantId: TENANT,
      cohortRef: "cohort-bind",
      runId: "run-keep",
    });
  });

  it("auto-binds an unlabeled outcome onto the unique live binding", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-auto-"));
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        { agentId: AGENT_ID, tenantId: TENANT, runId: "run-auto" },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: TENANT,
      runId: "run-auto",
      experimentId: "exp-bind",
      applicationId: "app:bind",
      cohortRef: "cohort-bind",
    });
  });

  it("keeps a standalone cohort label when no experiment IDs and no binding", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-cohort-only-"), {
      applications: [],
      proposals: [],
      experiments: [],
    });
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          tenantId: TENANT,
          cohortRef: "cohort-control",
          runId: "run-base-1",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: TENANT,
      cohortRef: "cohort-control",
      runId: "run-base-1",
    });
  });

  it("strips forged IDs when no binding exists and keeps ordinary fields", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-forged-empty-"), {
      applications: [],
      proposals: [],
      experiments: [],
    });
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-forged",
          applicationId: "app:forged",
          cohortRef: "cohort-forged",
          tenantId: TENANT,
          runId: "run-ordinary",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: TENANT,
      runId: "run-ordinary",
    });
  });

  it("strips IDs when the experiment record is missing", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-no-exp-"), {
      experiments: [],
    });
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toBeUndefined();
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          runId: "run-no-exp",
        },
        persistDir,
      ),
    ).toEqual({ agentId: AGENT_ID, runId: "run-no-exp" });
  });

  it("strips forged IDs when the application is unknown", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-unknown-app-"), {
      applications: [],
    });
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:missing",
          runId: "run-unknown",
        },
        persistDir,
      ),
    ).toEqual({ agentId: AGENT_ID, runId: "run-unknown" });
  });

  it("strips IDs from a rolled-back application", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-rolled-"), {
      applications: [application({ status: "rolled_back", appliedToRuntime: false })],
      proposals: [proposal({ status: "ROLLED_BACK" })],
    });
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          runId: "run-rolled",
        },
        persistDir,
      ),
    ).toEqual({ agentId: AGENT_ID, runId: "run-rolled" });
  });

  it("strips IDs from a shadow application", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-shadow-ids-"), {
      applications: [application({ scope: "shadow", appliedToRuntime: false })],
    });
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          runId: "run-shadow",
        },
        persistDir,
      ),
    ).toEqual({ agentId: AGENT_ID, runId: "run-shadow" });
  });

  it("strips partial explicit experiment or application IDs", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-partial-"));
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        { agentId: AGENT_ID, experimentId: "exp-bind", runId: "run-partial-exp" },
        persistDir,
      ),
    ).toEqual({ agentId: AGENT_ID, runId: "run-partial-exp" });
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        { agentId: AGENT_ID, applicationId: "app:bind", runId: "run-partial-app" },
        persistDir,
      ),
    ).toEqual({ agentId: AGENT_ID, runId: "run-partial-app" });
  });

  it("strips IDs when the caller tenant disagrees and does not leak the trusted tenant", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-tenant-"));
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: "tenant-other",
          runId: "run-tenant",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: "tenant-other",
      runId: "run-tenant",
    });
    expect(
      bindWorkingDnaTaskOutcomeRecord({ agentId: AGENT_ID, tenantId: "tenant-other" }, persistDir),
    ).toEqual({ agentId: AGENT_ID, tenantId: "tenant-other" });
  });

  it("strips IDs when the caller cohort disagrees", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-cohort-"));
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
          cohortRef: "cohort-other",
          runId: "run-cohort",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: TENANT,
      runId: "run-cohort",
    });
  });

  it("strips mismatched experiment/application pairs without swapping in another experiment", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-mismatch-"));
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-other",
          applicationId: "app:other",
          tenantId: TENANT,
          runId: "run-mismatch",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: TENANT,
      runId: "run-mismatch",
    });
  });

  it("does not bind when multiple live applications match the same agent", () => {
    const persistDir = seedPersist(tmpDir("evo-bind-multi-"), {
      applications: [
        application(),
        application({
          applicationId: "app:other",
          proposalId: "evo:other",
          experimentId: "exp-other",
          appliedAt: "2026-09-06T12:00:00.000Z",
        }),
      ],
      proposals: [
        proposal(),
        proposal({
          proposalId: "evo:other",
          experimentId: "exp-other",
          candidateRef: "cand:other",
        }),
      ],
      experiments: [
        experiment(),
        experiment({ experimentId: "exp-other", proposalId: "evo:other" }),
      ],
    });
    expect(resolveWorkingDnaTaskOutcomeBinding({ agentId: AGENT_ID, persistDir })).toBeUndefined();
    expect(
      bindWorkingDnaTaskOutcomeRecord(
        {
          agentId: AGENT_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
          runId: "run-multi",
        },
        persistDir,
      ),
    ).toEqual({
      agentId: AGENT_ID,
      tenantId: TENANT,
      runId: "run-multi",
    });
  });

  it("stamps live IDs onto the runner write path so treatment can accept the event", async () => {
    const persistDir = seedPersist(tmpDir("evo-bind-run-"));
    const agentDir = tmpDir("evo-bind-agent-");
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir }] },
    } as unknown as OpenBotConfig;
    await recordRunOutcome(cfg, AGENT_ID, {
      success: true,
      tenantId: TENANT,
      runId: "run-bind",
      occurredAt: Date.parse("2026-09-06T11:06:00.000Z"),
      evolutionPersistDir: persistDir,
    });
    const rows = readEvolutionTaskOutcomes(cfg, AGENT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: AGENT_ID,
      tenantId: TENANT,
      experimentId: "exp-bind",
      applicationId: "app:bind",
      cohortRef: "cohort-bind",
      runId: "run-bind",
      succeeded: true,
    });
    expect(rows[0]?.latencyMs).toBeUndefined();
    expect(rows[0]?.securityViolation).toBeUndefined();

    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: Date.parse("2026-09-06T11:07:00.000Z"),
        succeeded: true,
        tenantId: TENANT,
        runId: "run-bind-2",
      },
      { persistDir },
    );
    const adapter = createWorkingDnaAdapter(cfg, {
      observationPort: createFileWorkingDnaObservationPort(cfg),
    });
    const measured = await adapter.observeTarget?.({ domain: "agent", agentId: AGENT_ID }, "w", {
      windowId: "w",
      experimentId: "exp-bind",
      phase: "treatment",
      startedAt: "2026-09-06T11:05:00.000Z",
      endedAt: "2026-09-06T11:10:00.000Z",
      tenantScope: TENANT,
      targetKey: `agent:${AGENT_ID}`,
      modelRevision: "m",
      configRevision: "c",
      cohortRef: "cohort-bind",
    });
    expect(measured?.[0]).toEqual(
      expect.objectContaining({
        metricId: "task_success_rate",
        sampleSize: 2,
        value: 1,
      }),
    );
  });

  it("rejects a stripped forged outcome from the treatment cohort", async () => {
    const persistDir = seedPersist(tmpDir("evo-bind-forged-treat-"), {
      applications: [],
      proposals: [],
      experiments: [],
    });
    const agentDir = tmpDir("evo-bind-forged-agent-");
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir }] },
    } as unknown as OpenBotConfig;
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: Date.parse("2026-09-06T11:06:00.000Z"),
        succeeded: true,
        tenantId: TENANT,
        experimentId: "exp-forged",
        applicationId: "app:forged",
        cohortRef: "cohort-forged",
        runId: "run-forged",
      },
      { persistDir },
    );
    const row = readEvolutionTaskOutcomes(cfg, AGENT_ID)[0];
    expect(row?.experimentId).toBeUndefined();
    expect(row?.applicationId).toBeUndefined();
    expect(row?.cohortRef).toBeUndefined();
    expect(row?.runId).toBe("run-forged");
    const adapter = createWorkingDnaAdapter(cfg, {
      observationPort: createFileWorkingDnaObservationPort(cfg),
    });
    const measured = await adapter.observeTarget?.({ domain: "agent", agentId: AGENT_ID }, "w", {
      windowId: "w",
      experimentId: "exp-forged",
      phase: "treatment",
      startedAt: "2026-09-06T11:05:00.000Z",
      endedAt: "2026-09-06T11:10:00.000Z",
      tenantScope: TENANT,
      targetKey: `agent:${AGENT_ID}`,
      modelRevision: "m",
      configRevision: "c",
      cohortRef: "cohort-forged",
    });
    expect(measured).toEqual([]);
  });

  it("still rejects an unbound ordinary runtime event from treatment", async () => {
    const persistDir = seedPersist(tmpDir("evo-bind-unbound-"), {
      applications: [],
      proposals: [],
      experiments: [],
    });
    const agentDir = tmpDir("evo-bind-unbound-agent-");
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir }] },
    } as unknown as OpenBotConfig;
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: Date.parse("2026-09-06T11:06:00.000Z"),
        succeeded: true,
        tenantId: TENANT,
      },
      { persistDir },
    );
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]?.experimentId).toBeUndefined();
    const adapter = createWorkingDnaAdapter(cfg, {
      observationPort: createFileWorkingDnaObservationPort(cfg),
    });
    const measured = await adapter.observeTarget?.({ domain: "agent", agentId: AGENT_ID }, "w", {
      windowId: "w",
      experimentId: "exp-bind",
      phase: "treatment",
      startedAt: "2026-09-06T11:05:00.000Z",
      endedAt: "2026-09-06T11:10:00.000Z",
      tenantScope: TENANT,
      targetKey: `agent:${AGENT_ID}`,
      modelRevision: "m",
      configRevision: "c",
      cohortRef: "cohort-bind",
    });
    expect(measured).toEqual([]);
  });
});

describe("skill invocation experiment binding", () => {
  const skillId = "skill-bind";

  function skillPersist(
    prefix: string,
    over: {
      applications?: EvolutionApplication[];
      proposals?: EvolutionProposal[];
      experiments?: EvolutionExperiment[];
    } = {},
  ): string {
    return seedPersist(tmpDir(prefix), {
      applications: over.applications ?? [application({ adapterId: "skill" })],
      proposals: over.proposals ?? [
        proposal({
          target: { domain: "capability", skillId },
          surfaceId: "capability.skill-spec",
        }),
      ],
      ...(over.experiments ? { experiments: over.experiments } : {}),
    });
  }

  it("binds a live skill canary and keeps exact matching caller IDs", () => {
    const persistDir = skillPersist("evo-skill-bind-");
    expect(resolveSkillInvocationBinding({ skillId, persistDir })).toEqual({
      experimentId: "exp-bind",
      applicationId: "app:bind",
      tenantId: TENANT,
      cohortRef: "cohort-bind",
      appliedAt: "2026-09-06T11:00:00.000Z",
    });
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
          cohortRef: "cohort-bind",
        },
        persistDir,
      ),
    ).toMatchObject({
      experimentId: "exp-bind",
      applicationId: "app:bind",
      tenantId: TENANT,
      cohortRef: "cohort-bind",
    });
    expect(bindSkillInvocationRecord({ skillId, tenantId: TENANT }, persistDir)).toMatchObject({
      experimentId: "exp-bind",
      applicationId: "app:bind",
    });
  });

  it("strips forged skill IDs when no binding exists and keeps ordinary fields", () => {
    const persistDir = skillPersist("evo-skill-forged-empty-", {
      applications: [],
      proposals: [],
      experiments: [],
    });
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-forged",
          applicationId: "app:forged",
          cohortRef: "cohort-forged",
          tenantId: TENANT,
        },
        persistDir,
      ),
    ).toEqual({
      skillId,
      tenantId: TENANT,
    });
  });

  it("strips forged skill IDs when the application is unknown", () => {
    const persistDir = skillPersist("evo-skill-unknown-app-", {
      applications: [],
    });
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-bind",
          applicationId: "app:missing",
        },
        persistDir,
      ),
    ).toEqual({ skillId });
  });

  it("strips skill IDs when the experiment record is missing", () => {
    const persistDir = skillPersist("evo-skill-no-exp-", {
      experiments: [],
    });
    expect(resolveSkillInvocationBinding({ skillId, persistDir })).toBeUndefined();
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-bind",
          applicationId: "app:bind",
        },
        persistDir,
      ),
    ).toEqual({ skillId });
  });

  it("strips IDs from a rolled-back skill application", () => {
    const persistDir = skillPersist("evo-skill-rolled-", {
      applications: [
        application({ adapterId: "skill", status: "rolled_back", appliedToRuntime: false }),
      ],
      proposals: [
        proposal({
          target: { domain: "capability", skillId },
          surfaceId: "capability.skill-spec",
          status: "ROLLED_BACK",
        }),
      ],
    });
    expect(
      bindSkillInvocationRecord(
        { skillId, experimentId: "exp-bind", applicationId: "app:bind" },
        persistDir,
      ),
    ).toEqual({ skillId });
  });

  it("does not bind shadow skill applications and strips caller IDs", () => {
    const persistDir = skillPersist("evo-skill-shadow-", {
      applications: [application({ adapterId: "skill", scope: "shadow", appliedToRuntime: false })],
    });
    expect(resolveSkillInvocationBinding({ skillId, persistDir })).toBeUndefined();
    expect(
      bindSkillInvocationRecord(
        { skillId, experimentId: "exp-bind", applicationId: "app:bind" },
        persistDir,
      ),
    ).toEqual({ skillId });
  });

  it("strips partial explicit skill experiment or application IDs", () => {
    const persistDir = skillPersist("evo-skill-partial-");
    expect(bindSkillInvocationRecord({ skillId, experimentId: "exp-bind" }, persistDir)).toEqual({
      skillId,
    });
    expect(bindSkillInvocationRecord({ skillId, applicationId: "app:bind" }, persistDir)).toEqual({
      skillId,
    });
  });

  it("strips skill IDs when the caller tenant disagrees and does not leak the trusted tenant", () => {
    const persistDir = skillPersist("evo-skill-tenant-");
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: "tenant-other",
        },
        persistDir,
      ),
    ).toEqual({
      skillId,
      tenantId: "tenant-other",
    });
  });

  it("strips skill IDs when the caller cohort disagrees", () => {
    const persistDir = skillPersist("evo-skill-cohort-");
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
          cohortRef: "cohort-other",
        },
        persistDir,
      ),
    ).toEqual({
      skillId,
      tenantId: TENANT,
    });
  });

  it("strips mismatched skill experiment/application pairs without swapping", () => {
    const persistDir = skillPersist("evo-skill-mismatch-");
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-other",
          applicationId: "app:other",
          tenantId: TENANT,
        },
        persistDir,
      ),
    ).toEqual({
      skillId,
      tenantId: TENANT,
    });
  });

  it("does not bind when multiple live skill applications match", () => {
    const persistDir = skillPersist("evo-skill-multi-", {
      applications: [
        application({ adapterId: "skill" }),
        application({
          adapterId: "skill",
          applicationId: "app:other",
          proposalId: "evo:other",
          experimentId: "exp-other",
          appliedAt: "2026-09-06T12:00:00.000Z",
        }),
      ],
      proposals: [
        proposal({
          target: { domain: "capability", skillId },
          surfaceId: "capability.skill-spec",
        }),
        proposal({
          proposalId: "evo:other",
          experimentId: "exp-other",
          candidateRef: "cand:other",
          target: { domain: "capability", skillId },
          surfaceId: "capability.skill-spec",
        }),
      ],
      experiments: [
        experiment(),
        experiment({ experimentId: "exp-other", proposalId: "evo:other" }),
      ],
    });
    expect(resolveSkillInvocationBinding({ skillId, persistDir })).toBeUndefined();
    expect(
      bindSkillInvocationRecord(
        {
          skillId,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
        },
        persistDir,
      ),
    ).toEqual({
      skillId,
      tenantId: TENANT,
    });
  });

  it("stamps completed skill invocations from a live applied experiment", () => {
    const persistDir = skillPersist("evo-skill-record-");
    const configDir = tmpDir("evo-skill-events-");
    const event = recordSkillInvocationCompleted(
      {
        skillId,
        agentId: AGENT_ID,
        tenantId: TENANT,
        outcome: "success",
        latencyMs: 12,
        startedAt: Date.parse("2026-09-06T11:06:00.000Z"),
        completedAt: Date.parse("2026-09-06T11:06:12.000Z"),
        failureCategory: null,
      },
      { configDir, persistDir },
    );
    expect(event.experimentId).toBe("exp-bind");
    expect(event.applicationId).toBe("app:bind");
  });

  it("strips forged IDs on the skill writer path when no binding exists", () => {
    const persistDir = skillPersist("evo-skill-writer-forged-", {
      applications: [],
      proposals: [],
      experiments: [],
    });
    const event = recordSkillInvocationCompleted(
      {
        skillId,
        agentId: AGENT_ID,
        tenantId: TENANT,
        experimentId: "exp-forged",
        applicationId: "app:forged",
        outcome: "success",
        latencyMs: 12,
        startedAt: Date.parse("2026-09-06T11:06:00.000Z"),
        completedAt: Date.parse("2026-09-06T11:06:12.000Z"),
        failureCategory: null,
      },
      { configDir: tmpDir("evo-skill-forged-events-"), persistDir },
    );
    expect(event.experimentId).toBeUndefined();
    expect(event.applicationId).toBeUndefined();
    expect(event.tenantId).toBe(TENANT);
    expect(event.skillId).toBe(skillId);
  });
});

const GROUP_ID = "group-bind-org";

function orgPersist(prefix: string) {
  return seedPersist(tmpDir(prefix), {
    applications: [application({ adapterId: "organization" })],
    proposals: [
      proposal({
        target: { domain: "organization", groupId: GROUP_ID },
        surfaceId: "organization.task-routing",
      }),
    ],
    experiments: [
      experiment({
        target: { domain: "organization", groupId: GROUP_ID },
        surfaceId: "organization.task-routing",
      }),
    ],
  });
}

describe("organization task outcome binding", () => {
  it("binds a live canary organization application", () => {
    const persistDir = orgPersist("evo-org-bind-");
    expect(resolveOrganizationTaskBinding({ groupId: GROUP_ID, persistDir })).toEqual({
      experimentId: "exp-bind",
      applicationId: "app:bind",
      tenantId: TENANT,
      cohortRef: "cohort-bind",
      appliedAt: "2026-09-06T11:00:00.000Z",
    });
  });

  it("does not bind after rollback and does not keep caller-forged ids", () => {
    const persistDir = seedPersist(tmpDir("evo-org-bind-rb-"), {
      applications: [
        application({
          adapterId: "organization",
          status: "rolled_back",
          appliedToRuntime: true,
        }),
      ],
      proposals: [
        proposal({
          status: "EXPERIMENTING",
          target: { domain: "organization", groupId: GROUP_ID },
          surfaceId: "organization.task-routing",
        }),
      ],
      experiments: [
        experiment({
          target: { domain: "organization", groupId: GROUP_ID },
          surfaceId: "organization.task-routing",
        }),
      ],
    });
    expect(resolveOrganizationTaskBinding({ groupId: GROUP_ID, persistDir })).toBeUndefined();
    expect(
      bindOrganizationTaskRecord(
        {
          organizationId: GROUP_ID,
          experimentId: "exp-bind",
          applicationId: "app:bind",
          tenantId: TENANT,
        },
        persistDir,
      ),
    ).toEqual({
      organizationId: GROUP_ID,
      tenantId: TENANT,
    });
  });

  it("stamps only from the unique live organization binding", () => {
    const persistDir = orgPersist("evo-org-bind-stamp-");
    expect(
      bindOrganizationTaskRecord(
        {
          organizationId: GROUP_ID,
          tenantId: TENANT,
          cohortRef: "cohort-bind",
          createdAt: "2026-09-06T11:00:00.000Z",
        },
        persistDir,
      ),
    ).toEqual({
      organizationId: GROUP_ID,
      tenantId: TENANT,
      experimentId: "exp-bind",
      applicationId: "app:bind",
      cohortRef: "cohort-bind",
      createdAt: "2026-09-06T11:00:00.000Z",
    });
  });

  it("does not stamp in-flight tasks created before the application", () => {
    const persistDir = orgPersist("evo-org-bind-inflight-");
    expect(
      bindOrganizationTaskRecord(
        {
          organizationId: GROUP_ID,
          tenantId: TENANT,
          createdAt: "2026-09-06T10:59:00.000Z",
        },
        persistDir,
      ),
    ).toEqual({
      organizationId: GROUP_ID,
      tenantId: TENANT,
      createdAt: "2026-09-06T10:59:00.000Z",
    });
  });
});
