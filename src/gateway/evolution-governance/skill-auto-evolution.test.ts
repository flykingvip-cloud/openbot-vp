import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-auto-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  setSkillAutoEvolutionForTests,
  runSkillAutoEvolutionPass,
  isSkillAutoEvolutionEnabled,
  isSkillAutoEvolutionMutationAllowed,
  enrollSkillAutoInstall,
  listControlPlaneApplicationConsumptions,
  cancelSkillAutoInstallJob,
  setGovernanceKillSwitch,
  setEvolutionGovernanceModeForTests,
} = await import("./index.js");
const {
  ingestPatternSample,
  listPatternCandidates,
  approvePatternCandidate,
  structureHashFromText,
  resetPatternDetectionStoreForTests,
  publishPatternCandidateAsDraftSkill,
  getPatternCandidate,
} = await import("../pattern-detection/index.js");
const { finalizeDraftSkill, listRobotSkillAssets, getPersonalSkillAssetDetail } =
  await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  loadSkillExecutionBindingEntries,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
} = await import("../skill-execution-binding/index.js");
const { writeGovernancePersistedState, readGovernancePersistedState } =
  await import("./persistent-store.js");

function seedCandidate(agentId: string) {
  const hash = structureHashFromText("# Auto evo\n1. a\n- b");
  const out = structureHashFromText("# Out\n- ok");
  for (let i = 1; i <= 3; i += 1) {
    ingestPatternSample({
      agentId,
      runId: `auto-run-${agentId}-${i}`,
      taskId: `auto-task-${agentId}-${i}`,
      inputStructureHash: hash,
      outputStructureHash: out,
      success: true,
      suggestedNameHint: "自动进化技能",
    });
  }
  return listPatternCandidates({ agentId })[0];
}

describe("skill auto-evolution", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    setGovernanceKillSwitch(false);
    setEvolutionGovernanceModeForTests("auto");
    setSkillAutoEvolutionForTests(true);
    delete process.env.OPENBOT_SKILL_AUTO_ALLOW_AGENTS;
    resetPatternDetectionStoreForTests();
    resetSkillExecutionBindingHooksForTests();
    ensureSkillExecutionBindingHooksRegistered();
  });
  afterEach(() => {
    setSkillAutoEvolutionForTests(null);
    setEvolutionGovernanceModeForTests(null);
    setGovernanceKillSwitch(false);
    delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    delete process.env.OPENBOT_SKILL_AUTO_ALLOW_AGENTS;
    resetSkillExecutionBindingHooksForTests();
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is disabled by default (fail-closed)", () => {
    setSkillAutoEvolutionForTests(null);
    delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    expect(isSkillAutoEvolutionEnabled()).toBe(false);
    expect(isSkillAutoEvolutionMutationAllowed()).toBe(false);
  });

  it("rejects invalid env values (fail-closed)", () => {
    setSkillAutoEvolutionForTests(null);
    process.env.OPENBOT_SKILL_AUTO_EVOLUTION = "maybe";
    expect(isSkillAutoEvolutionEnabled()).toBe(false);
    process.env.OPENBOT_SKILL_AUTO_EVOLUTION = "ON";
    expect(isSkillAutoEvolutionEnabled()).toBe(true);
  });

  it("does not auto-approve or install without autoInstallIntent", () => {
    const candidate = seedCandidate("robot-no-intent");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops-1",
      autoInstallIntent: false,
    });
    const pass = runSkillAutoEvolutionPass();
    expect(pass.published).toBe(0);
    expect(pass.installed).toBe(0);
    expect(listPatternCandidates({ agentId: "robot-no-intent" })[0]?.status).toBe("approved");
  });

  it("records approval audit fields", () => {
    const candidate = seedCandidate("robot-audit");
    const approved = approvePatternCandidate(candidate.candidateId, {
      approvedBy: "operator-alice",
      autoInstallIntent: true,
    });
    expect(approved.approvedBy).toBe("operator-alice");
    expect(approved.approvedAt).toBeGreaterThan(0);
    expect(approved.approvalPolicySnapshot?.policyVersion).toBeTruthy();
    expect(approved.autoInstallIntent).toBe(true);
  });

  it("assist mode blocks mutations even when skill-auto env on", () => {
    setEvolutionGovernanceModeForTests("assist");
    const candidate = seedCandidate("robot-assist");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const pass = runSkillAutoEvolutionPass();
    expect(pass.mutationsAllowed).toBe(false);
    expect(pass.errors.some((e) => e.error.includes("governance-auto"))).toBe(true);
  });

  it("assist mode records an install intent for a ready job without installing it", () => {
    const candidate = seedCandidate("robot-assist-ready");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const enrolled = enrollSkillAutoInstall({
      candidateId: candidate.candidateId,
      enrolledBy: "ops",
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) {
      return;
    }
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: "robot-assist-ready",
    });
    finalizeDraftSkill(published.skillId);
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      skillAutoJobs: {
        [candidate.candidateId]: {
          ...enrolled.job,
          skillId: published.skillId,
          stage: "finalized",
        },
      },
    });
    setEvolutionGovernanceModeForTests("assist");

    const pass = runSkillAutoEvolutionPass();

    expect(pass.installed).toBe(0);
    expect(listRobotSkillAssets("robot-assist-ready")).toEqual([]);
    expect(listControlPlaneApplicationConsumptions(tmpDir)).toContainEqual(
      expect.objectContaining({
        source: "skill-auto-pass",
        approvedAction: "install",
        liveExecuted: false,
        executedConsumer: false,
      }),
    );
  });

  it("after human approve+intent: publish → finalize → install when dual gates on", () => {
    const candidate = seedCandidate("robot-auto");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });

    const pass = runSkillAutoEvolutionPass();
    expect(pass.mutationsAllowed).toBe(true);
    expect(pass.approved).toBe(0);
    expect(pass.published).toBeGreaterThanOrEqual(1);
    expect(pass.installed).toBeGreaterThanOrEqual(1);

    const skillId = pass.skillIds[0];
    expect(getPersonalSkillAssetDetail(skillId).lifecycle).toBe("private");
    expect(listRobotSkillAssets("robot-auto").some((r) => r.id === skillId)).toBe(true);
    expect(
      loadSkillExecutionBindingEntries({ agentId: "robot-auto" }).map((e) => e.skill.name),
    ).toContain(skillExecutionSkillName(skillId));
  });

  it("does not take over historical published drafts without a job", () => {
    const candidate = seedCandidate("robot-manual-pub");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: false,
    });
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: "robot-manual-pub",
    });
    expect(published.detail.lifecycle).toBe("draft");

    // Turn on skill-auto and run pass — must not finalize/install this draft
    const pass = runSkillAutoEvolutionPass();
    expect(pass.installed).toBe(0);
    expect(getPersonalSkillAssetDetail(published.skillId).lifecycle).toBe("draft");
    expect(listRobotSkillAssets("robot-manual-pub").some((r) => r.id === published.skillId)).toBe(
      false,
    );
  });

  it("retries only owned incomplete jobs after re-validation", () => {
    const candidate = seedCandidate("robot-retry");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const enrolled = enrollSkillAutoInstall({
      candidateId: candidate.candidateId,
      enrolledBy: "ops",
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) {
      return;
    }

    // Simulate partial progress: publish done, job at draft_created
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: "robot-retry",
    });
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      skillAutoJobs: {
        [candidate.candidateId]: {
          ...enrolled.job,
          skillId: published.skillId,
          stage: "draft_created",
          autoInstallIntent: true,
        },
      },
    });

    const pass = runSkillAutoEvolutionPass();
    expect(pass.installed).toBeGreaterThanOrEqual(1);
    expect(getPersonalSkillAssetDetail(published.skillId).lifecycle).toBe("private");
    expect(listRobotSkillAssets("robot-retry").some((r) => r.id === published.skillId)).toBe(true);
  });

  it("cancel aborts incomplete job and prevents further install", () => {
    const candidate = seedCandidate("robot-cancel");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    enrollSkillAutoInstall({ candidateId: candidate.candidateId, enrolledBy: "ops" });
    const cancelled = cancelSkillAutoInstallJob({
      candidateId: candidate.candidateId,
      reason: "operator-abort",
      cancelledBy: "ops",
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.ok && cancelled.job?.stage).toBe("cancelled");
    expect(getPatternCandidate(candidate.candidateId)?.autoInstallIntent).toBe(false);

    const pass = runSkillAutoEvolutionPass();
    expect(pass.installed).toBe(0);
    expect(listPatternCandidates({ agentId: "robot-cancel" })[0]?.status).toBe("approved");
  });

  it("re-validation cancels job when quality gates no longer met", () => {
    const candidate = seedCandidate("robot-reval");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const enrolled = enrollSkillAutoInstall({
      candidateId: candidate.candidateId,
      enrolledBy: "ops",
    });
    expect(enrolled.ok).toBe(true);

    // Tighten live thresholds beyond candidate quality
    process.env.OPENBOT_SKILL_AUTO_MIN_INDEPENDENT = "99";
    try {
      const pass = runSkillAutoEvolutionPass();
      expect(pass.cancelled).toBeGreaterThanOrEqual(1);
      const jobs = readGovernancePersistedState().skillAutoJobs ?? {};
      expect(jobs[candidate.candidateId]?.stage).toBe("cancelled");
    } finally {
      delete process.env.OPENBOT_SKILL_AUTO_MIN_INDEPENDENT;
    }
  });

  it("re-validation cancels when approvedBy is missing", () => {
    const candidate = seedCandidate("robot-no-approver");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    enrollSkillAutoInstall({ candidateId: candidate.candidateId, enrolledBy: "ops" });
    const storePath = path.join(tmpDir, "pattern-detection", "candidates.json");
    const rows = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.candidateId === candidate.candidateId) {
        row.approvedBy = null;
      }
    }
    fs.writeFileSync(storePath, `${JSON.stringify(rows, null, 2)}\n`);

    const pass = runSkillAutoEvolutionPass();
    expect(pass.cancelled).toBeGreaterThanOrEqual(1);
    const jobs = readGovernancePersistedState().skillAutoJobs ?? {};
    expect(jobs[candidate.candidateId]?.stage).toBe("cancelled");
    expect(jobs[candidate.candidateId]?.cancelReason).toBe("approval-audit-missing");
  });

  it("re-validation cancels on job/candidate ownership mismatch", () => {
    const candidate = seedCandidate("robot-own");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    // Give candidate an authority tenant so snapshot is non-null
    const storePath = path.join(tmpDir, "pattern-detection", "candidates.json");
    const rows = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.candidateId === candidate.candidateId) {
        row.tenantId = "tenant-a";
      }
    }
    fs.writeFileSync(storePath, `${JSON.stringify(rows, null, 2)}\n`);

    const enrolled = enrollSkillAutoInstall({
      candidateId: candidate.candidateId,
      enrolledBy: "ops",
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) {
      return;
    }
    expect(enrolled.job.tenantId).toBe("tenant-a");

    // Corrupt job ownership (agent or tenant drift)
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      skillAutoJobs: {
        [candidate.candidateId]: {
          ...enrolled.job,
          agentId: "wrong-agent",
          autoInstallIntent: true,
        },
      },
    });
    const passAgent = runSkillAutoEvolutionPass();
    expect(passAgent.cancelled).toBeGreaterThanOrEqual(1);
    expect(
      readGovernancePersistedState().skillAutoJobs?.[candidate.candidateId]?.cancelReason,
    ).toBe("ownership-mismatch");

    // Re-enroll clean then corrupt tenant snapshot
    writeGovernancePersistedState({
      ...readGovernancePersistedState(),
      skillAutoJobs: {
        [candidate.candidateId]: {
          ...enrolled.job,
          agentId: candidate.agentId,
          tenantId: "tenant-b",
          stage: "pending_publish",
          autoInstallIntent: true,
          cancelReason: undefined,
          cancelledAt: undefined,
        },
      },
    });
    const passTenant = runSkillAutoEvolutionPass();
    expect(passTenant.cancelled).toBeGreaterThanOrEqual(1);
    expect(
      readGovernancePersistedState().skillAutoJobs?.[candidate.candidateId]?.cancelReason,
    ).toBe("ownership-mismatch");
  });

  it("no-ops when skill auto is off", () => {
    setSkillAutoEvolutionForTests(false);
    const candidate = seedCandidate("robot-off");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const pass = runSkillAutoEvolutionPass();
    expect(pass.enabled).toBe(false);
    expect(pass.published).toBe(0);
  });
});
