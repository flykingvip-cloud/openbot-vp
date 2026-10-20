import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillInvocationCompletedEvent } from "../gateway/skill-invocation/types.js";
import { assessDiagnoseGrowth, readWorkspaceGrowthFacts } from "./diagnose-growth-assessment.js";

function completed(skillId: string, outcome: "success" | "failure"): SkillInvocationCompletedEvent {
  return {
    type: "skill_invocation_completed",
    invocationId: `${skillId}-${outcome}`,
    skillId,
    skillVersion: "1",
    agentId: "bot-2",
    tenantId: "001",
    userId: null,
    startedAt: 1_000,
    completedAt: 2_000,
    outcome,
    latencyMs: 10,
    failureCategory: outcome === "failure" ? "timeout" : null,
    runId: null,
    sessionKey: "agent:bot-2:main",
    businessOutcome: null,
  };
}

describe("diagnose growth assessment", () => {
  it("reads identity and memory freshness without copying file text", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-growth-"));
    fs.writeFileSync(
      path.join(dir, "IDENTITY.md"),
      "# IDENTITY.md\n- **Name:**\n  _(pick something you like)_\n",
    );
    fs.writeFileSync(path.join(dir, "USER.md"), "# USER.md\n- **Name:**\n");
    fs.writeFileSync(path.join(dir, "BOOTSTRAP.md"), "# BOOTSTRAP\n");
    fs.mkdirSync(path.join(dir, "memory"));
    fs.writeFileSync(path.join(dir, "memory", "2026-09-19.md"), "secret-chat-body-must-not-leak");
    fs.mkdirSync(path.join(dir, "skills", "briefing"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "briefing", "SKILL.md"), "secret-skill-body");

    const facts = readWorkspaceGrowthFacts(dir);
    expect(facts.identity?.bootstrapPending).toBe(true);
    expect(facts.identity?.identityInitialized).toBe(false);
    expect(facts.memoryFiles.map((file) => file.name)).toEqual(["2026-09-19.md"]);
    expect(facts.installedSkillIds).toEqual(["briefing"]);
    expect(facts.identityMissingFields).toContain("name");
    expect(facts.userMissingFields).toEqual(["name", "what to call them", "timezone"]);
    expect(JSON.stringify(facts)).not.toContain("secret-chat-body");
    expect(JSON.stringify(facts)).not.toContain("secret-skill-body");
  });

  it("treats fresh memory or reports as window activity without skill events", () => {
    const assessed = assessDiagnoseGrowth({
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      windowMs: 10_000,
      nowMs: 3_000,
      identity: {
        readable: true,
        bootstrapPending: false,
        identityInitialized: false,
        userInitialized: false,
      },
      identityMissingFields: ["name"],
      userMissingFields: ["timezone"],
      memoryFiles: [{ name: "2026-09-19.md", mtimeMs: 2_500 }],
      reportFiles: [{ name: "competitor.md", mtimeMs: 2_800 }],
      sessionRoster: { main: 1, cron: 3, other: 2, freshCron: 1, freshMain: 0 },
    });
    expect(assessed.hadTaskActivity).toBe(true);
    expect(assessed.memory.fresh).toBe(true);
    expect(assessed.activitySources).toEqual(["memory_file", "report_file", "cron_session"]);
    expect(assessed.freshArtifactCount).toBe(2);
    expect(JSON.stringify(assessed)).not.toContain("competitor price");
  });

  it("splits capable, unstable, and unused skills inside the window", () => {
    const assessed = assessDiagnoseGrowth({
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      windowMs: 10_000,
      nowMs: 3_000,
      identity: {
        readable: true,
        bootstrapPending: false,
        identityInitialized: true,
        userInitialized: true,
      },
      memoryFiles: [{ name: "today.md", mtimeMs: 2_500 }],
      installedSkillIds: ["briefing", "idle-skill"],
      skillEvents: [completed("briefing", "success"), completed("ops", "failure")],
    });
    expect(assessed.capable).toEqual(["briefing"]);
    expect(assessed.unstable).toEqual(["ops"]);
    expect(assessed.unused).toEqual(["idle-skill"]);
    expect(assessed.skillLastSeenMs["briefing"]).toBe(2_000);
    expect(assessed.skillLastSeenMs["idle-skill"]).toBeUndefined();
    expect(assessed.memory.fresh).toBe(true);
    expect(assessed.objectLabel).toBe("bot-2");
    expect(assessed.memoryJudgedMissing).toBe(false);
    expect(assessed.baselineGapCandidates).toEqual([]);
  });

  it("records last skill observation even when it falls outside the window", () => {
    const assessed = assessDiagnoseGrowth({
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      windowMs: 1_000,
      nowMs: 10_000,
      installedSkillIds: ["data-analysis"],
      skillEvents: [completed("data-analysis", "success")],
    });
    expect(assessed.unused).toEqual(["data-analysis"]);
    expect(assessed.skillLastSeenMs["data-analysis"]).toBe(2_000);
  });

  it("does not call memory missing when the window had no task activity", () => {
    const assessed = assessDiagnoseGrowth({
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      windowMs: 1_000,
      nowMs: 100_000,
      memoryFiles: [{ name: "old.md", mtimeMs: 1 }],
      hadTaskActivity: false,
    });
    expect(assessed.memory.fresh).toBe(false);
    expect(assessed.memoryJudgedMissing).toBe(false);
  });

  it("rejects symlink workspaces and path traversal", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-growth-link-"));
    const real = path.join(dir, "real");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "IDENTITY.md"), "secret-identity-body");
    const link = path.join(dir, "link");
    fs.symlinkSync(real, link);
    const viaLink = readWorkspaceGrowthFacts(link);
    expect(viaLink.identity).toBeNull();
    expect(JSON.stringify(viaLink)).not.toContain("secret-identity-body");
    const escaped = readWorkspaceGrowthFacts(`${dir}/../../etc`);
    expect(escaped.identity).toBeNull();
    expect(escaped.memoryFiles).toEqual([]);
    const workspace = path.join(dir, "workspace");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    const outside = path.join(dir, "secret.md");
    fs.writeFileSync(outside, "secret-memory-body");
    fs.symlinkSync(outside, path.join(workspace, "memory", "link.md"));
    const facts = readWorkspaceGrowthFacts(workspace);
    expect(facts.memoryFiles).toEqual([]);
    expect(JSON.stringify(facts)).not.toContain("secret-memory-body");
  });

  it("labels a collaboration group instead of only the coordinator", () => {
    const assessed = assessDiagnoseGrowth({
      agentId: "main",
      sessionKey: "agent:main:space:grp-sales",
      windowMs: 1_000,
      nowMs: 5_000,
    });
    expect(assessed.groupId).toBe("grp-sales");
    expect(assessed.objectLabel).toBe("协作小组 grp-sales");
  });
});
