/**
 * WP-02 — Gateway handoff-recovery boot: crash roll-forward + idempotent re-run.
 * Exercises recoverPendingHandoffTxnsAtGatewayBoot (startup path), not only the
 * direct recoverPendingHandoffTxns unit path in handoff-invariant.test.ts.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import type { OpenBotConfig } from "../config/types.js";
import {
  acceptHandoff,
  applyApprovedHandoff,
  approveHandoff,
  handoffTaskOverlayPath,
  handoffTxnPath,
  proposeHandoff,
  type HandoffTask,
} from "./collaboration-dispatch/handoff-contract.js";
import { createRoundPolicySnapshot } from "./collaboration-dispatch/round-policy-snapshot.js";
import { writeJsonDurable } from "./collaboration-dispatch/round-store-io.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "./collaboration-dispatch/runtime-authority.js";
import {
  discoverPendingHandoffGroups,
  recoverPendingHandoffTxnsAtGatewayBoot,
} from "./handoff-recovery-boot.js";

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

function flagConfig(root: string, handoffContract: boolean): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { handoffContract },
    },
  } as OpenBotConfig;
}

async function useConfig(handoffContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-handoff-boot-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, handoffContract);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId = "grp_boot_handoff"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_handoff_boot_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_handoff_boot",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function taskOf(groupId = "grp_boot_handoff"): HandoffTask {
  return {
    taskId: "task-boot-1",
    groupId,
    title: "Boot recover owner",
    status: "in_progress",
    ownerMemberId: "bot-a",
    assignedMemberIds: ["bot-a"],
    createdAtMs: 1,
    updatedAtMs: 1,
    responsibility: {
      owner: "bot-a",
      executors: ["bot-a"],
      decisionAuthority: "human",
    },
  };
}

const proposeInput = {
  taskId: "task-boot-1",
  kind: "owner_transfer" as const,
  from: { agentId: "bot-a", responsibilityRole: "owner" as const },
  to: { agentId: "bot-b", responsibilityRole: "owner" as const },
  remainingWork: "finish the review",
  acceptanceCriteria: ["signed off"],
  completedArtifacts: ["draft"],
  proposedBy: "bot-a",
};

async function readOverlay(auth: RuntimeAuthority): Promise<HandoffTask | null> {
  try {
    const raw = await fs.readFile(
      handoffTaskOverlayPath(auth.namespace.handoffsDir, "task-boot-1"),
      "utf8",
    );
    return JSON.parse(raw) as HandoffTask;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

describe("handoff-recovery-boot (gateway startup path)", () => {
  test("flag off is a no-op even when a txn file exists on disk", async () => {
    const { cfg } = await useConfig(false);
    const auth = authority(cfg);
    await fs.mkdir(auth.namespace.handoffsDir, { recursive: true });
    await fs.writeFile(
      path.join(auth.namespace.handoffsDir, "task-boot-1.txn"),
      JSON.stringify({ taskId: "task-boot-1", handoffId: "h_fake" }),
      "utf8",
    );
    const result = await recoverPendingHandoffTxnsAtGatewayBoot({ cfg });
    expect(result).toEqual({ rolledForward: [], groupsScanned: 0, groupsRecovered: 0 });
    await expect(
      fs.access(path.join(auth.namespace.handoffsDir, "task-boot-1.txn")),
    ).resolves.toBeUndefined();
  });

  test("crash after fact: gateway boot discovers group and rolls forward; repeat is idempotent", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const task = taskOf();
    await writeJsonDurable(handoffTaskOverlayPath(auth.namespace.handoffsDir, task.taskId), task);

    const proposed = await proposeHandoff(auth, proposeInput, { cfg, nowMs: 20 });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    const accepted = await acceptHandoff(
      auth,
      proposed.value,
      { type: "bot", id: "bot-b" },
      { cfg, nowMs: 21 },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    const approved = await approveHandoff(
      auth,
      accepted.value,
      { type: "human", id: "owner-1" },
      { cfg, nowMs: 22 },
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      return;
    }

    await expect(
      applyApprovedHandoff(auth, approved.value, task, {
        cfg,
        nowMs: 23,
        hooks: {
          afterFactBeforeTask: () => {
            throw new Error("crash-after-fact-boot");
          },
        },
      }),
    ).rejects.toThrow(/crash-after-fact-boot/);

    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-a");
    await expect(
      fs.access(handoffTxnPath(auth.namespace.handoffsDir, task.taskId)),
    ).resolves.toBeUndefined();

    const pending = await discoverPendingHandoffGroups(cfg);
    expect(pending.some((g) => g.groupId === auth.groupId)).toBe(true);

    const first = await recoverPendingHandoffTxnsAtGatewayBoot({ cfg });
    expect(first.rolledForward).toEqual([approved.value.handoffId]);
    expect(first.groupsRecovered).toBe(1);
    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-b");
    expect((await readOverlay(auth))?.ownerMemberId).toBe("bot-b");
    await expect(
      fs.access(handoffTxnPath(auth.namespace.handoffsDir, task.taskId)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const second = await recoverPendingHandoffTxnsAtGatewayBoot({ cfg });
    expect(second.rolledForward).toEqual([]);
    expect(second.groupsScanned).toBe(0);
    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-b");
  });
});
