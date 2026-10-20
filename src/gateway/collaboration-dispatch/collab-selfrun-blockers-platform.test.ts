import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  applyClaim,
  boardClaimsDir,
  cancelBoardItem,
  claimBoardItem,
  isIntendedClaimantId,
  loadBoardClaimItem,
  publishBoardItem,
  type GroupBoardClaimItem,
} from "./claim-contract.js";
import { maybeContinueAfterRoundComplete, planContinueAfterRound } from "./continue-after-round.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { classifyGovernanceActor } from "./governance-gate.js";
import { loadBoardClaimItemsFromDir } from "./member-progress-export.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  evaluateSelfAdvanceEligibility,
  isModeBInventoryActiveBoardItem,
  isSelfAdvanceActiveBoardItem,
  rankModeBInventoryActiveBoardItems,
  rankSelfAdvanceActiveBoardItems,
  tryClaimPublishedInventoryLead,
} from "./self-advance.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
        continueAfterRoundComplete: { enabled: true },
        selfAdvance: { mode: "execute", executeGroupAllowlist: ["grp_any"] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-selfrun-blockers-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId = "grp_any"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_selfrun_blockers" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_selfrun_blockers",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

const seedTask: Task = {
  taskId: "task-selfrun-1",
  groupId: "grp_any",
  title: "platform cancel smoke",
  status: "in_progress",
  ownerMemberId: "human-ceo",
  assignedMemberIds: ["human-ceo"],
  createdBy: "human-ceo",
  updatedBy: "human-ceo",
  createdAtMs: 1,
  updatedAtMs: 1,
};

function boardItem(
  partial: Partial<GroupBoardClaimItem> & Pick<GroupBoardClaimItem, "itemId" | "status">,
): GroupBoardClaimItem {
  return {
    groupId: "grp_x",
    taskId: "task_x",
    title: "t",
    remainingWork: "rw",
    acceptanceCriteria: ["a"],
    intendedClaimantIds: [],
    publishedBy: "pub",
    publishedAt: 1,
    ...partial,
  };
}

describe("collab selfrun blockers platform", () => {
  it("rankSelfAdvanceActiveBoardItems: in_progress before applied; newer applied wins", () => {
    const ranked = rankSelfAdvanceActiveBoardItems([
      boardItem({ itemId: "smoke", status: "applied", appliedAt: 10, claimantId: "s" }),
      boardItem({ itemId: "newer", status: "applied", appliedAt: 99, claimantId: "n" }),
      boardItem({ itemId: "prog", status: "in_progress", inProgressAt: 5, claimantId: "p" }),
      boardItem({ itemId: "done", status: "accepted" }),
    ]);
    expect(ranked.map((i) => i.itemId)).toEqual(["prog", "newer", "smoke"]);
    expect(isSelfAdvanceActiveBoardItem(boardItem({ itemId: "c", status: "cancelled" }))).toBe(
      false,
    );
  });

  it("evaluateSelfAdvanceEligibility uses ranked active set", () => {
    const effective = {
      governance: {
        botMaySelfAdvanceWithoutHuman: true,
        decisionMode: "human_required",
      },
    } as EffectiveCollaborationPolicy;
    const eligibility = evaluateSelfAdvanceEligibility({
      effective,
      actor: classifyGovernanceActor("bot:lead"),
      boardItems: [
        boardItem({ itemId: "old", status: "applied", appliedAt: 1, claimantId: "old" }),
        boardItem({
          itemId: "fresh",
          status: "in_progress",
          inProgressAt: 2,
          claimantId: "fresh",
        }),
      ],
    });
    expect(eligibility.activeBoardItems[0]?.itemId).toBe("fresh");
  });

  it("cancelBoardItem: published|claimed|applied → cancelled; exits active set", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);

    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_any",
        taskId: seedTask.taskId,
        title: "stale published",
        remainingWork: "n/a",
        acceptanceCriteria: ["x"],
        publishedBy: "ops",
        skipChallengeWindow: true,
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const cancelPub = await cancelBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        actorId: "ops",
        reason: "stale_smoke",
      },
      { cfg },
    );
    expect(cancelPub.ok).toBe(true);
    if (!cancelPub.ok) {
      return;
    }
    expect(cancelPub.value.status).toBe("cancelled");
    expect(cancelPub.value.cancelledBy).toBe("ops");
    expect(cancelPub.value.cancelledReason).toBe("stale_smoke");
    expect(isSelfAdvanceActiveBoardItem(cancelPub.value)).toBe(false);

    // applied path
    const pub2 = await publishBoardItem(
      auth,
      {
        groupId: "grp_any",
        taskId: seedTask.taskId,
        title: "applied smoke",
        remainingWork: "n/a",
        acceptanceCriteria: ["x"],
        intendedClaimantIds: ["exec"],
        publishedBy: "ops",
        skipChallengeWindow: true,
      },
      { cfg },
    );
    expect(pub2.ok).toBe(true);
    if (!pub2.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId: pub2.value.itemId, claimantId: "exec" },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      return;
    }
    const applied = await applyClaim(
      auth,
      { taskId: seedTask.taskId, itemId: pub2.value.itemId },
      seedTask,
      auth.policy.effective,
      { cfg },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value.item.status).toBe("applied");

    const cancelApplied = await cancelBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: applied.value.item.itemId,
        actorId: "ops",
        reason: "clear_active_set",
      },
      { cfg },
    );
    expect(cancelApplied.ok).toBe(true);
    if (!cancelApplied.ok) {
      return;
    }
    expect(cancelApplied.value.status).toBe("cancelled");
    expect(isSelfAdvanceActiveBoardItem(cancelApplied.value)).toBe(false);

    // refuse cancel on already cancelled
    const again = await cancelBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: cancelApplied.value.itemId,
        actorId: "ops",
      },
      { cfg },
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("invalid_status");
    }
  });
  it("rankModeBInventoryActiveBoardItems: published in inventory; terminals excluded", () => {
    const ranked = rankModeBInventoryActiveBoardItems([
      boardItem({
        itemId: "pub",
        status: "published",
        publishedAt: 50,
        intendedClaimantIds: ["exec"],
      }),
      boardItem({ itemId: "prog", status: "in_progress", inProgressAt: 5, claimantId: "p" }),
      boardItem({ itemId: "done", status: "accepted" }),
      boardItem({ itemId: "cx", status: "cancelled" }),
      boardItem({ itemId: "bl", status: "blocked" }),
    ]);
    expect(ranked.map((i) => i.itemId)).toEqual(["prog", "pub"]);
    expect(isModeBInventoryActiveBoardItem(boardItem({ itemId: "pub", status: "published" }))).toBe(
      true,
    );
    expect(isSelfAdvanceActiveBoardItem(boardItem({ itemId: "pub", status: "published" }))).toBe(
      false,
    );
    expect(planContinueAfterRound({ enabled: true, boardItems: ranked }).primary?.itemId).toBe(
      "prog",
    );
  });

  it("isIntendedClaimantId: case-insensitive match (no hard-coded team ids)", () => {
    expect(isIntendedClaimantId(["Bot", "bot-2"], "bot")).toBe(true);
    expect(isIntendedClaimantId(["bot-2"], "BOT-2")).toBe(true);
    expect(isIntendedClaimantId(["bot-2"], "bot")).toBe(false);
  });

  it("tryClaimPublishedInventoryLead + continue: unclaimed published → claim lead", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);

    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_any",
        taskId: seedTask.taskId,
        title: "longrun published",
        remainingWork: "deliver",
        acceptanceCriteria: ["pdf"],
        intendedClaimantIds: ["bot:exec", "bot:backup"],
        publishedBy: "cli",
        skipChallengeWindow: true,
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const claim = await tryClaimPublishedInventoryLead(auth, {
      boardItems: [published.value],
      cfg,
      nowMs: 1_700_000_000_000,
    });
    expect(claim.claimed).toBe(true);
    expect(claim.leadAgentId).toBe("bot:exec");
    expect(claim.item?.status).toBe("claimed");
    expect(claim.item?.claimantId).toBe("bot:exec");

    const loaded = await loadBoardClaimItem(auth, {
      taskId: seedTask.taskId,
      itemId: published.value.itemId,
    });
    expect(loaded?.status).toBe("claimed");
    expect(loaded?.claimantId).toBe("bot:exec");

    // Fresh publish for continue-after-round path
    const pub2 = await publishBoardItem(
      auth,
      {
        groupId: "grp_any",
        taskId: seedTask.taskId,
        title: "continue published",
        remainingWork: "deliver",
        acceptanceCriteria: ["pdf"],
        intendedClaimantIds: ["bot:lead"],
        publishedBy: "cli",
        skipChallengeWindow: true,
      },
      { cfg },
    );
    expect(pub2.ok).toBe(true);
    if (!pub2.ok) {
      return;
    }

    const cont = await maybeContinueAfterRoundComplete({
      authority: auth,
      roundId: "round_continue_pub",
      roundState: "ROUND_COMPLETE",
      cfg,
      nowMs: 1_700_000_000_100,
      loadBoardItems: async () => [pub2.value],
      skipSelfAdvance: true,
    });
    expect(cont.decision.enabled).toBe(true);
    expect(cont.decision.reason).toBe("active_board_inventory");
    expect(cont.decision.claimRecorded).toBe(true);
    expect(cont.decision.claimedByAgentId).toBe("bot:lead");
    expect(cont.decision.activeBoardCount).toBeGreaterThanOrEqual(1);
    expect(cont.decision.wakeRecorded).toBe(true);

    const after = await loadBoardClaimItem(auth, {
      taskId: seedTask.taskId,
      itemId: pub2.value.itemId,
    });
    expect(after?.status).toBe("claimed");
    expect(after?.claimantId).toBe("bot:lead");
  });

  it("jsonl loader preserves intended → tryClaimPublishedInventoryLead claims bot not cli", async () => {
    // Tip #753 smoke FAIL: latestItemsFromBoardClaimJsonl dropped intendedClaimantIds,
    // Mode B lead fell back to publishedBy=cli, claimBoardItem rejected by intended list.
    const { cfg } = await useConfig();
    const auth = authority(cfg);

    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_any",
        taskId: seedTask.taskId,
        title: "loader intended round-trip",
        remainingWork: "deliver",
        acceptanceCriteria: ["pdf"],
        intendedClaimantIds: ["bot", "bot-2"],
        publishedBy: "cli",
        skipChallengeWindow: true,
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const loaded = await loadBoardClaimItemsFromDir(boardClaimsDir(auth));
    const fromLoader = loaded.find((item) => item.itemId === published.value.itemId);
    expect(fromLoader).toBeTruthy();
    expect(fromLoader?.status).toBe("published");
    expect(fromLoader?.publishedBy).toBe("cli");
    expect(fromLoader?.publishedAt).toEqual(expect.any(Number));
    expect([...(fromLoader?.intendedClaimantIds ?? [])]).toEqual(["bot", "bot-2"]);

    const claim = await tryClaimPublishedInventoryLead(auth, {
      boardItems: loaded as GroupBoardClaimItem[],
      cfg,
      nowMs: 1_700_000_000_200,
    });
    expect(claim.claimed).toBe(true);
    expect(claim.leadAgentId).toBe("bot");
    expect(claim.leadAgentId).not.toBe("cli");
    expect(claim.item?.status).toBe("claimed");
    expect(claim.item?.claimantId).toBe("bot");
  });
});
