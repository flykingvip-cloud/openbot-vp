import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { applyCapsuleGovernanceTransition } from "../../gateway/collaboration-learning/capsule-governance.js";
import { promoteApprovedCapsuleIfEligible } from "../../gateway/collaboration-learning/capsule-promotion.js";
import { buildMemoryFlushCandidateCapsule } from "../../gateway/collaboration-learning/memory-flush-outcome-capsule.js";
import { createWorkspaceCollaborationStores } from "../../gateway/collaboration-learning/shared.js";
import { buildCollaborationCapabilitySystemPrompt } from "./collaboration-capability-context.js";

const cleanupDirs: string[] = [];

describe("buildCollaborationCapabilitySystemPrompt", () => {
  afterEach(async () => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("injects promoted learning asset instructions after governance approve + promote", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-capability-prompt-"));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-capability-ws-"));
    cleanupDirs.push(stateDir, workspaceDir);
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
    await fs.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: {
          list: [{ id: "bot-reviewer" }],
          defaults: { workspace: workspaceDir },
        },
        collaboration: { defaults: { workspace: path.join(workspaceDir, "collab-root") } },
      }),
      "utf8",
    );
    clearRuntimeConfigSnapshot();
    clearConfigCache();

    const capsule = buildMemoryFlushCandidateCapsule({
      groupId: "group-1",
      botId: "bot-reviewer",
      participationId: "group-1::bot-reviewer",
      confidentialityTier: "internal",
      memoryFlushWritePath: "memory/2026-04-09.md",
      appendedMarkdown: "## Retro\n- Always verify release checklist with reviewer.",
      flushedAt: 1_000,
      memoryCompactionCompleted: false,
      workspaceDir,
      sessionKey: "sk-1",
    });
    expect(capsule).toBeTruthy();

    const { learningStorage } = createWorkspaceCollaborationStores();
    await learningStorage.appendCapsule("group-1", capsule!);
    const approved = applyCapsuleGovernanceTransition(capsule!, "approved", {
      actor: "operator-1",
      reusability: "promotable",
    });
    await promoteApprovedCapsuleIfEligible({
      groupId: "group-1",
      capsule: approved,
      targetBotId: "bot-reviewer",
      actor: "operator-1",
      approvalMode: "approved",
      learningStorage,
    });

    const prompt = await buildCollaborationCapabilitySystemPrompt({
      workspaceDir,
      groupId: "group-1",
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: 1,
        sessionFile: "sessions/session-1.jsonl",
        groupId: "group-1",
        collaborationGroupProfile: {
          groupId: "group-1",
          updatedAtMs: 1,
          confidentialityTier: "internal",
        },
        collaborationParticipationOverlay: {
          participationId: "group-1::bot-reviewer",
          groupId: "group-1",
          botId: "bot-reviewer",
          overlayCapabilities: [],
          confidentialityTier: "internal",
        },
      },
    });

    expect(prompt).toContain("Learned principles");
    expect(prompt).toContain("verify release checklist");
  });

  it("injects Group instructions from disk when the session has no profile", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-capability-prompt-"));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-capability-ws-"));
    cleanupDirs.push(stateDir, workspaceDir);
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
    await fs.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: {
          list: [{ id: "bot-reviewer" }],
          defaults: { workspace: workspaceDir },
        },
        collaboration: { defaults: { workspace: path.join(workspaceDir, "collab-root") } },
      }),
      "utf8",
    );
    clearRuntimeConfigSnapshot();
    clearConfigCache();

    const { metadataStorage } = createWorkspaceCollaborationStores();
    await metadataStorage.writeGroupCapabilities("group-1", {
      groupId: "group-1",
      systemInstructions: ["被 @ 时必须回应", "禁止空寒暄"],
      confidentialityTier: "internal",
      updatedAtMs: 1,
    });

    const prompt = await buildCollaborationCapabilitySystemPrompt({
      workspaceDir,
      groupId: "group-1",
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: 1,
        sessionFile: "sessions/session-1.jsonl",
        groupId: "group-1",
      },
    });

    expect(prompt).toContain("Group instructions");
    expect(prompt).toContain("被 @ 时必须回应");
    expect(prompt).toContain("禁止空寒暄");
  });

  it("returns undefined for non-collab sessions without groupId (no capability/overlay prompt)", async () => {
    const prompt = await buildCollaborationCapabilitySystemPrompt({
      sessionEntry: {},
      workspaceDir: "/tmp/unused",
    });
    expect(prompt).toBeUndefined();
  });

  it("does not leak peer overlay capabilities across bots on a shared session bag", async () => {
    const { upsertSessionParticipationOverlay } =
      await import("../../gateway/collaboration-learning/session-participation-overlay.js");
    const bag = upsertSessionParticipationOverlay({
      existing: upsertSessionParticipationOverlay({
        existing: null,
        overlay: {
          botId: "bot-a",
          groupId: "grp_iso",
          participationId: "grp_iso::bot-a",
          overlayCapabilities: ["skill-a-only"],
          updatedAt: 1,
        },
      }),
      overlay: {
        botId: "bot-b",
        groupId: "grp_iso",
        participationId: "grp_iso::bot-b",
        overlayCapabilities: ["skill-b-only"],
        updatedAt: 2,
      },
    });
    const groupProfile = {
      groupId: "grp_iso",
      enabledSkills: ["shared"],
      updatedAtMs: 1,
    };
    const promptA = await buildCollaborationCapabilitySystemPrompt({
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 1,
        groupId: "grp_iso",
        collaborationGroupProfile: groupProfile,
        collaborationParticipationOverlay: bag,
      } as never,
      groupId: "grp_iso",
      botId: "bot-a",
      groupProfile: groupProfile as never,
    });
    const promptB = await buildCollaborationCapabilitySystemPrompt({
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 1,
        groupId: "grp_iso",
        collaborationGroupProfile: groupProfile,
        collaborationParticipationOverlay: bag,
      } as never,
      groupId: "grp_iso",
      botId: "bot-b",
      groupProfile: groupProfile as never,
    });
    expect(promptA).toContain("skill-a-only");
    expect(promptA).not.toContain("skill-b-only");
    expect(promptB).toContain("skill-b-only");
    expect(promptB).not.toContain("skill-a-only");
  });
});
