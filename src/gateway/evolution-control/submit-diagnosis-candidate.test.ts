import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnosisIngestWalRecord } from "@openbot/evolution-core";
import { diagnosisIngestProposalCreatedEventId } from "@openbot/evolution-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnoseGrowthAssessment } from "../../diagnosis/diagnose-growth-assessment.js";
import { persistGrowthAssessmentSnapshot } from "../../diagnosis/diagnose-growth-snapshot.js";
import {
  buildSkillInstallationCandidate,
  type SkillInstallationCandidate,
} from "../../diagnosis/skill-installation-candidate.js";
import {
  buildStructuralEvolutionCandidate,
  type StructuralEvolutionCandidate,
} from "../../diagnosis/structural-evolution-candidate.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { previewDiagnosisCandidate } from "./diagnosis-ingest.js";
import {
  createDiagnosisCandidateSubmitter,
  createMemoryDiagnosisSubmitPorts,
  defaultSnapshotReader,
  submitDiagnosisCandidate,
  workingDnaBaselineHash,
  type DiagnosisGrantView,
  type DiagnosisSubmitDeps,
  type DiagnosisSubmitWritePorts,
} from "./submit-diagnosis-candidate.js";

const dirs: string[] = [];
const NOW = "2026-09-19T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const TENANT = "tenant-a";
const AGENT = "bot-2";
const BASELINE_HASH = workingDnaBaselineHash(DEFAULT_WORKING_STYLE);
const SKILL_ID = "briefing";
const SKILL_BASELINE_HASH = "skill-install-baseline-aaa";

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e1-submit-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

function persistSnapshot(configDir: string) {
  const snapshot = persistGrowthAssessmentSnapshot({
    assessment: assessment(),
    observationWindow: {
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-19T00:00:00.000Z",
    },
    configDir,
    nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
  });
  if (!snapshot) {
    throw new Error("snapshot persist failed");
  }
  return snapshot;
}

function candidate(
  snapshotRef: string,
  patch: Record<string, unknown> = {},
): StructuralEvolutionCandidate {
  const built = buildStructuralEvolutionCandidate({
    structuralIntent: "adjust_reporting_cadence",
    proposedChange: { field: "reportingCadence", value: "milestone" },
    surfaceId: "agent.working-dna",
    targetHint: "agent:other-hint",
    baselineHash: BASELINE_HASH,
    observationRef: "obs:pattern:reporting-cadence-1",
    evidenceRefs: ["evidence:task-result-1"],
    snapshotRef,
    reportRef: "cdr-persisted-1",
    findingRef: "finding-1",
    observedWindow: {
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-19T00:00:00.000Z",
    },
    ...patch,
  });
  if (!built.ok) {
    throw new Error(built.reason);
  }
  return built.candidate;
}

function approvedGrant(
  over: Partial<Exclude<DiagnosisGrantView, { status: "missing" }>> = {},
): DiagnosisGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: TENANT,
    agentId: AGENT,
    allowedEvidence: ["obs:pattern:reporting-cadence-1", "evidence:task-result-1"],
    allowedActions: ["suggest", "experiment", "inspect"],
    confidentialityCeiling: "enterprise",
    ...over,
  };
}

function wrapPorts(ports: DiagnosisSubmitWritePorts) {
  return {
    ports,
    putProposal: vi.spyOn(ports, "putProposal"),
    putCandidate: vi.spyOn(ports, "putCandidate"),
    appendLedger: vi.spyOn(ports, "appendLedger"),
    putWal: vi.spyOn(ports, "putWal"),
  };
}

function harness(
  over: {
    grant?: DiagnosisGrantView;
    ports?: DiagnosisSubmitWritePorts;
    configDir?: string;
    snapshotNowMs?: number;
  } = {},
) {
  const configDir = over.configDir ?? tempDir();
  const snapshot = persistSnapshot(configDir);
  const ports = over.ports ?? createMemoryDiagnosisSubmitPorts();
  const spies = wrapPorts(ports);
  const startExperiment = vi.fn();
  const apply = vi.fn();
  const deps: DiagnosisSubmitDeps = {
    ports,
    inspectGrant: () => over.grant ?? approvedGrant(),
    readSnapshot: defaultSnapshotReader(configDir, over.snapshotNowMs ?? NOW_MS),
    readBaseline: (agentId) =>
      agentId === AGENT ? { style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH } : null,
    now: () => NOW,
  };
  return {
    configDir,
    snapshot,
    ports,
    spies,
    startExperiment,
    apply,
    deps,
    input: {
      commandId: "cmd-1",
      candidate: candidate(snapshot.snapshotId),
      trustedContext: {
        tenantId: TENANT,
        principalRef: "user-1",
        agentId: AGENT,
        confirmedByUser: true,
      },
      grantId: "grant-1",
    },
  };
}

describe("submitDiagnosisCandidate", () => {
  it("does not call startExperiment or Adapter.apply", async () => {
    const ctx = harness();
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result.ok).toBe(true);
    expect(ctx.startExperiment).not.toHaveBeenCalled();
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("resolves the authoritative agent from trust/grant/snapshot, not targetHint", async () => {
    const ctx = harness();
    expect(ctx.input.candidate.targetHint).toBe("agent:other-hint");
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const proposal = ctx.ports.getProposal(result.receipt.proposalId);
    expect(proposal?.target).toEqual({ domain: "agent", agentId: AGENT });
  });

  it("maps WorkingDnaCandidate.delta.reportingCadence from the domain-legal proposed change", async () => {
    const ctx = harness();
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result.ok).toBe(true);
    const stored = ctx.spies.putCandidate.mock.calls[0]?.[1];
    expect(stored).toMatchObject({
      agentId: AGENT,
      delta: { reportingCadence: "milestone" },
      candidateVersion: ctx.input.candidate.candidateVersion,
    });
  });

  it("fails closed with zero writes when the grant is missing", async () => {
    const ctx = harness({ grant: { status: "missing" } });
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result).toEqual({ ok: false, code: "grant_missing", writes: [] });
    expect(ctx.spies.putProposal).not.toHaveBeenCalled();
    expect(ctx.spies.putCandidate).not.toHaveBeenCalled();
    expect(ctx.spies.appendLedger).not.toHaveBeenCalled();
  });

  it("fails closed when the grant is expired or revoked", async () => {
    const expired = harness({
      grant: approvedGrant({ status: "EXPIRED", expired: true }),
    });
    expect(await submitDiagnosisCandidate(expired.input, expired.deps)).toEqual({
      ok: false,
      code: "grant_inactive",
      writes: [],
    });
    const revoked = harness({
      grant: approvedGrant({ status: "REVOKED", revoked: true }),
    });
    expect(await submitDiagnosisCandidate(revoked.input, revoked.deps)).toEqual({
      ok: false,
      code: "grant_inactive",
      writes: [],
    });
    expect(expired.spies.appendLedger).not.toHaveBeenCalled();
    expect(revoked.spies.appendLedger).not.toHaveBeenCalled();
  });

  it("fails closed on cross-tenant grant binding", async () => {
    const ctx = harness({ grant: approvedGrant({ tenantScope: "tenant-other" }) });
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result).toEqual({ ok: false, code: "cross_tenant", writes: [] });
    expect(ctx.spies.putProposal).not.toHaveBeenCalled();
  });

  it("fails closed on unknown target", async () => {
    const ctx = harness();
    const result = await submitDiagnosisCandidate(
      {
        ...ctx.input,
        trustedContext: { ...ctx.input.trustedContext, agentId: "" },
      },
      ctx.deps,
    );
    expect(result).toEqual({ ok: false, code: "unknown_target", writes: [] });
  });

  it("fails closed when the snapshot is missing, corrupt, or expired", async () => {
    const missing = harness();
    const missingResult = await submitDiagnosisCandidate(
      {
        ...missing.input,
        candidate: candidate("b".repeat(64)),
      },
      missing.deps,
    );
    expect(missingResult).toEqual({ ok: false, code: "snapshot_missing", writes: [] });

    const corruptDir = tempDir();
    const corruptSnap = persistSnapshot(corruptDir);
    fs.writeFileSync(
      path.join(
        corruptDir,
        "diagnosis-growth-snapshots",
        createHash("sha256").update(TENANT).digest("hex").slice(0, 16),
        `${corruptSnap.snapshotId}.json`,
      ),
      "{not-json",
    );
    const corruptPorts = createMemoryDiagnosisSubmitPorts();
    const corruptSpies = wrapPorts(corruptPorts);
    const corrupt = await submitDiagnosisCandidate(
      {
        commandId: "cmd-corrupt",
        candidate: candidate(corruptSnap.snapshotId),
        trustedContext: {
          tenantId: TENANT,
          principalRef: "user-1",
          agentId: AGENT,
          confirmedByUser: true,
        },
        grantId: "grant-1",
      },
      {
        ports: corruptPorts,
        inspectGrant: () => approvedGrant(),
        readSnapshot: defaultSnapshotReader(corruptDir, NOW_MS),
        readBaseline: () => ({ style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH }),
        now: () => NOW,
      },
    );
    expect(corrupt).toEqual({ ok: false, code: "snapshot_corrupt", writes: [] });
    expect(corruptSpies.putProposal).not.toHaveBeenCalled();

    const expired = harness({
      snapshotNowMs: Date.parse("2026-09-27T00:00:01.000Z"),
    });
    expect(await submitDiagnosisCandidate(expired.input, expired.deps)).toEqual({
      ok: false,
      code: "snapshot_expired",
      writes: [],
    });
  });

  it("fails closed on baseline hash mismatch", async () => {
    const ctx = harness();
    const result = await submitDiagnosisCandidate(ctx.input, {
      ...ctx.deps,
      readBaseline: () => ({
        style: DEFAULT_WORKING_STYLE,
        hash: "style:structured:periodic:confirm_first:balanced:neutral",
      }),
    });
    expect(result).toEqual({ ok: false, code: "baseline_hash_mismatch", writes: [] });
    expect(ctx.spies.putProposal).not.toHaveBeenCalled();
  });

  it("is idempotent for the same commandId and candidate", async () => {
    const ctx = harness();
    const first = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    const second = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.receipt.proposalId).toBe(first.receipt.proposalId);
      expect(second.receipt.candidateRef).toBe(first.receipt.candidateRef);
    }
    expect(ctx.spies.appendLedger).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent submits of the same commandId", async () => {
    const ctx = harness();
    const submitter = createDiagnosisCandidateSubmitter(ctx.deps);
    const [left, right] = await Promise.all([
      submitter.submit(ctx.input),
      submitter.submit(ctx.input),
    ]);
    expect(left.ok && right.ok).toBe(true);
    if (left.ok && right.ok) {
      expect(left.receipt.proposalId).toBe(right.receipt.proposalId);
    }
    expect(ctx.spies.appendLedger).toHaveBeenCalledTimes(1);
  });

  it("rejects commandId rebind to a different candidate", async () => {
    const ctx = harness();
    const first = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(first.ok).toBe(true);
    const other = candidate(ctx.snapshot.snapshotId, {
      proposedChange: { field: "reportingCadence", value: "periodic" },
    });
    const rebound = await submitDiagnosisCandidate({ ...ctx.input, candidate: other }, ctx.deps);
    expect(rebound).toEqual({ ok: false, code: "command_rebind", writes: [] });
  });

  it("returns the existing proposal when the same candidate arrives with different provenance", async () => {
    const ctx = harness();
    const first = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    const otherProvenance = candidate(ctx.snapshot.snapshotId, {
      reportRef: "cdr-persisted-2",
      findingRef: "finding-2",
      evidenceRefs: ["evidence:task-result-2"],
      observationRef: "obs:pattern:reporting-cadence-2",
    });
    expect(otherProvenance.candidateVersion).toBe(ctx.input.candidate.candidateVersion);
    const second = await submitDiagnosisCandidate(
      {
        ...ctx.input,
        commandId: "cmd-2",
        candidate: otherProvenance,
        grantId: "grant-1",
      },
      {
        ...ctx.deps,
        inspectGrant: () =>
          approvedGrant({
            allowedEvidence: ["obs:pattern:reporting-cadence-2", "evidence:task-result-2"],
          }),
      },
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.receipt.proposalId).toBe(first.receipt.proposalId);
      expect(second.writes).toEqual({ proposal: false, candidate: false, ledger: false });
    }
    expect(ctx.spies.appendLedger).toHaveBeenCalledTimes(1);
  });

  it("appends only one proposal.created ledger event and never writes on committed", async () => {
    const ctx = harness();
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result.ok).toBe(true);
    expect(ctx.spies.appendLedger).toHaveBeenCalledTimes(1);
    expect(ctx.spies.appendLedger.mock.calls[0]?.[0]?.type).toBe("proposal.created");
    expect(ctx.spies.appendLedger.mock.calls[0]?.[0]?.eventId).toBe(
      diagnosisIngestProposalCreatedEventId("cmd-1"),
    );
    const wal = ctx.ports.getWal("cmd-1");
    expect(wal?.state).toBe("committed");
    expect(wal?.ledgerEventIds).toEqual([diagnosisIngestProposalCreatedEventId("cmd-1")]);
  });

  it("resumes from proposal_written and candidate_written without a second ledger append when the event exists", async () => {
    const snapshotDir = tempDir();
    const snapshot = persistSnapshot(snapshotDir);
    const built = candidate(snapshot.snapshotId);
    const proposalWritten: DiagnosisIngestWalRecord = {
      commandId: "cmd-crash-1",
      proposalId: "evo:diag:crash1",
      candidateRef: "cand:diag:crash1",
      surfaceId: "agent.working-dna",
      contentHash: built.candidatePayloadHash,
      tenantScope: TENANT,
      targetKey: `agent:${AGENT}`,
      mechanism: built.mechanismRef,
      candidateVersion: built.candidateVersion,
      grantId: "grant-1",
      state: "proposal_written",
      ledgerEventIds: [],
    };
    const fromProposal = createMemoryDiagnosisSubmitPorts({ wals: [proposalWritten] });
    const proposalSpies = wrapPorts(fromProposal);
    const recoveredProposal = await submitDiagnosisCandidate(
      {
        commandId: "cmd-crash-1",
        candidate: built,
        trustedContext: {
          tenantId: TENANT,
          principalRef: "user-1",
          agentId: AGENT,
          confirmedByUser: true,
        },
        grantId: "grant-1",
      },
      {
        ports: fromProposal,
        inspectGrant: () => approvedGrant(),
        readSnapshot: defaultSnapshotReader(snapshotDir, NOW_MS),
        readBaseline: () => ({ style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH }),
        now: () => NOW,
      },
    );
    expect(recoveredProposal.ok).toBe(true);
    expect(proposalSpies.putCandidate).toHaveBeenCalled();
    expect(proposalSpies.appendLedger).toHaveBeenCalledTimes(1);

    const eventId = diagnosisIngestProposalCreatedEventId("cmd-crash-2");
    const candidateWritten: DiagnosisIngestWalRecord = {
      ...proposalWritten,
      commandId: "cmd-crash-2",
      proposalId: "evo:diag:crash2",
      candidateRef: "cand:diag:crash2",
      state: "candidate_written",
      ledgerEventIds: [],
    };
    const fromCandidate = createMemoryDiagnosisSubmitPorts({
      wals: [candidateWritten],
      ledgerEventIds: [eventId],
    });
    const candidateSpies = wrapPorts(fromCandidate);
    const recoveredCandidate = await submitDiagnosisCandidate(
      {
        commandId: "cmd-crash-2",
        candidate: built,
        trustedContext: {
          tenantId: TENANT,
          principalRef: "user-1",
          agentId: AGENT,
          confirmedByUser: true,
        },
        grantId: "grant-1",
      },
      {
        ports: fromCandidate,
        inspectGrant: () => approvedGrant(),
        readSnapshot: defaultSnapshotReader(snapshotDir, NOW_MS),
        readBaseline: () => ({ style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH }),
        now: () => NOW,
      },
    );
    expect(recoveredCandidate.ok).toBe(true);
    expect(candidateSpies.appendLedger).not.toHaveBeenCalled();
    expect(fromCandidate.getWal("cmd-crash-2")?.state).toBe("committed");
  });

  it("advances the receipt when ledger is written but WAL is still candidate_written", async () => {
    const snapshotDir = tempDir();
    const snapshot = persistSnapshot(snapshotDir);
    const built = candidate(snapshot.snapshotId);
    const eventId = diagnosisIngestProposalCreatedEventId("cmd-receipt");
    const wal: DiagnosisIngestWalRecord = {
      commandId: "cmd-receipt",
      proposalId: "evo:diag:receipt",
      candidateRef: "cand:diag:receipt",
      surfaceId: "agent.working-dna",
      contentHash: built.candidatePayloadHash,
      tenantScope: TENANT,
      targetKey: `agent:${AGENT}`,
      mechanism: built.mechanismRef,
      candidateVersion: built.candidateVersion,
      grantId: "grant-1",
      state: "candidate_written",
      ledgerEventIds: [],
    };
    const ports = createMemoryDiagnosisSubmitPorts({
      wals: [wal],
      ledgerEventIds: [eventId],
    });
    const spies = wrapPorts(ports);
    const result = await submitDiagnosisCandidate(
      {
        commandId: "cmd-receipt",
        candidate: built,
        trustedContext: {
          tenantId: TENANT,
          principalRef: "user-1",
          agentId: AGENT,
          confirmedByUser: true,
        },
        grantId: "grant-1",
      },
      {
        ports,
        inspectGrant: () => approvedGrant(),
        readSnapshot: defaultSnapshotReader(snapshotDir, NOW_MS),
        readBaseline: () => ({ style: DEFAULT_WORKING_STYLE, hash: BASELINE_HASH }),
        now: () => NOW,
      },
    );
    expect(result.ok).toBe(true);
    expect(spies.appendLedger).not.toHaveBeenCalled();
    expect(ports.getWal("cmd-receipt")?.state).toBe("committed");
  });

  it("recovers after a restart from a durable WAL snapshot", async () => {
    const ctx = harness();
    const first = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(first.ok).toBe(true);
    const wal = ctx.ports.getWal("cmd-1");
    const restarted = createMemoryDiagnosisSubmitPorts({
      wals: wal ? [wal] : [],
      ledgerEventIds: wal?.ledgerEventIds,
      proposals: ctx.ports.listProposals(),
    });
    const spies = wrapPorts(restarted);
    const second = await submitDiagnosisCandidate(ctx.input, {
      ...ctx.deps,
      ports: restarted,
    });
    expect(second.ok).toBe(true);
    expect(spies.appendLedger).not.toHaveBeenCalled();
  });
});

describe("preview remains disconnected from submit writes", () => {
  it("preview still writes nothing after submit exists", () => {
    const result = previewDiagnosisCandidate({ schemaVersion: 2 });
    expect(result.ok).toBe(false);
    expect(result.writes).toEqual([]);
  });
});

describe("submitDiagnosisCandidate skill installation", () => {
  function skillCandidate(
    snapshotRef: string,
    patch: Record<string, unknown> = {},
  ): SkillInstallationCandidate {
    const built = buildSkillInstallationCandidate({
      structuralIntent: "install_existing_skill",
      proposedChange: { field: "skillId", operation: "install", skillId: SKILL_ID },
      surfaceId: "capability.skill-installation",
      targetHint: "other-hint",
      baselineHash: SKILL_BASELINE_HASH,
      observationRef: "obs:explicit-install:briefing",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef,
      reportRef: "cdr-persisted-1",
      findingRef: "finding-1",
      observedWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
      installed: false,
      ...patch,
    });
    if (!built.ok) {
      throw new Error(built.reason);
    }
    return built.candidate;
  }

  function skillGrant() {
    return approvedGrant({
      allowedEvidence: ["obs:explicit-install:briefing", "evidence:task-result-1"],
    });
  }

  function skillHarness(
    over: {
      skillId?: string;
      known?: boolean;
      installed?: boolean;
      hash?: string;
    } = {},
  ) {
    const ctx = harness({ grant: skillGrant() });
    const skillId = over.skillId ?? SKILL_ID;
    return {
      ...ctx,
      deps: {
        ...ctx.deps,
        readSkillTarget: ({ skillId: requested }: { skillId: string }) =>
          requested === skillId
            ? {
                known: over.known ?? true,
                installed: over.installed ?? false,
                hash: over.hash ?? SKILL_BASELINE_HASH,
              }
            : { known: false, installed: false, hash: "" },
      },
      input: {
        ...ctx.input,
        candidate: skillCandidate(ctx.snapshot.snapshotId),
      },
    };
  }

  it("submits an existing-skill install candidate without starting an experiment", async () => {
    const ctx = skillHarness();
    const startExperiment = vi.fn();
    const apply = vi.fn();
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(startExperiment).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(ctx.ports.getWal("cmd-1")?.state).toBe("committed");
    expect(ctx.ports.getWal("cmd-1")?.surfaceId).toBe("capability.skill-installation");
    const proposal = ctx.ports.getProposal(result.receipt.proposalId);
    expect(proposal?.target).toEqual({ domain: "capability", skillId: SKILL_ID });
    expect(proposal?.sourceMechanismRef).toBe("diagnosis.capability.skill_installation_intent");
    expect(ctx.spies.putCandidate.mock.calls[0]?.[1]).toMatchObject({
      skillId: SKILL_ID,
      operation: "install",
      agentId: AGENT,
      candidateVersion: ctx.input.candidate.candidateVersion,
    });
  });

  it("resolves capability target from the existing skillId, not targetHint", async () => {
    const ctx = skillHarness();
    expect(ctx.input.candidate.targetHint).toBe("other-hint");
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(ctx.ports.getProposal(result.receipt.proposalId)?.target).toEqual({
      domain: "capability",
      skillId: SKILL_ID,
    });
  });

  it("fails closed when the skillId is unknown", async () => {
    const ctx = skillHarness({ known: false });
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result).toEqual({ ok: false, code: "unknown_target", writes: [] });
    expect(ctx.spies.putProposal).not.toHaveBeenCalled();
    expect(ctx.spies.appendLedger).not.toHaveBeenCalled();
  });

  it("fails closed when the skill is already installed", async () => {
    const ctx = skillHarness({ installed: true });
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result).toEqual({ ok: false, code: "candidate_invalid", writes: [] });
    expect(ctx.spies.putCandidate).not.toHaveBeenCalled();
  });

  it("fails closed on skill baseline mismatch", async () => {
    const ctx = skillHarness({ hash: "other-hash" });
    const result = await submitDiagnosisCandidate(ctx.input, ctx.deps);
    expect(result).toEqual({ ok: false, code: "baseline_hash_mismatch", writes: [] });
  });

  it("rejects a skill-spec surface candidate before WAL writes", async () => {
    const ctx = skillHarness();
    const result = await submitDiagnosisCandidate(
      {
        ...ctx.input,
        candidate: {
          ...ctx.input.candidate,
          surfaceId: "capability.skill-spec",
        },
      },
      ctx.deps,
    );
    expect(result).toEqual({ ok: false, code: "candidate_invalid", writes: [] });
    expect(ctx.spies.putWal).not.toHaveBeenCalled();
  });
});
