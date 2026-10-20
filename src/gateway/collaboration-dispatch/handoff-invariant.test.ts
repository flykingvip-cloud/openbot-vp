/**
 * Floor Runtime v2.1 §2.10 / §5.6 P1-B③ — HandoffContract invariants.
 * Missing accept or approve leaves responsibility unchanged.
 * A crash after the ledger fact and before the task write rolls forward on recover.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  loadConfig,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import { FIELD_LABELS } from "../../config/schema.labels.js";
import type { OpenBotConfig } from "../../config/types.js";
import { validateConfigObject } from "../../config/validation.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import {
  acceptHandoff,
  applyApprovedHandoff,
  approveHandoff,
  handoffLogPath,
  handoffTaskOverlayPath,
  handoffTxnPath,
  proposeHandoff,
  recoverPendingHandoffTxns,
  type HandoffContract,
  type HandoffTask,
} from "./handoff-contract.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { appendJsonlDurable, writeJsonDurable } from "./round-store-io.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import * as taskRuntime from "./task-runtime.js";
import {
  applyTaskHandoff,
  asGovernedTask,
  HandoffContractRequiredError,
  isCollabTaskHandoffContractEnabled,
  normalizeTaskHandoff,
} from "./task-runtime.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-handoff-"));
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

function authority(cfg: OpenBotConfig, groupId = "grp_handoff"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_handoff_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_handoff",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function taskOf(): HandoffTask {
  return {
    taskId: "task-h1",
    groupId: "grp_handoff",
    title: "Roll the owner",
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
  taskId: "task-h1",
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
      handoffTaskOverlayPath(auth.namespace.handoffsDir, "task-h1"),
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

async function factTypes(groupId: string): Promise<string[]> {
  const archive = await readCollaborationLedgerArchive({ groupId });
  return archive.records
    .filter((record) => record.kind === "fact")
    .map((record) => (record.kind === "fact" ? record.type : ""));
}

async function useLearningHandoffConfig(
  handoffContract: boolean,
): Promise<{ root: string; cfg: OpenBotConfig; groupId: string }> {
  const { root, cfg } = await useConfig(handoffContract);
  return { root, cfg, groupId: "grp_sm_handoff" };
}

function learningSeedTask(groupId: string): Task {
  return {
    taskId: "task-sm-1",
    groupId,
    title: "P1 seam handoff",
    status: "in_progress",
    ownerMemberId: "bot-a",
    assignedMemberIds: ["bot-a"],
    createdBy: "bot-a",
    updatedBy: "bot-a",
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

const learningHandoffParams = {
  from: "bot-a",
  to: "bot-b",
  reason: "owner_transfer",
  remainingWork: "finish the review",
  acceptanceCriteria: ["signed off"],
  completedArtifacts: ["draft"],
  actor: "bot-a",
};

describe("collaboration.task.handoffContract", () => {
  test("defaults off and is documented", () => {
    expect(isCollabTaskHandoffContractEnabled({})).toBe(false);
    expect(isCollabTaskHandoffContractEnabled({ collaboration: {} })).toBe(false);
    expect(
      isCollabTaskHandoffContractEnabled({ collaboration: { task: { handoffContract: false } } }),
    ).toBe(false);
    expect(
      isCollabTaskHandoffContractEnabled({ collaboration: { task: { handoffContract: true } } }),
    ).toBe(true);
    expect(FIELD_HELP["collaboration.task.handoffContract"]).toMatch(/default false/);
    expect(FIELD_LABELS["collaboration.task.handoffContract"]).toBeTruthy();
    expect(validateConfigObject({ collaboration: { task: { handoffContract: false } } }).ok).toBe(
      true,
    );
    expect(validateConfigObject({ collaboration: { task: { handoffContract: "yes" } } }).ok).toBe(
      false,
    );
  });

  test("flag-off owner_transfer shortcut still changes owner", () => {
    const current = asGovernedTask({
      taskId: "task-h1",
      groupId: "grp_handoff",
      title: "Roll the owner",
      status: "in_progress",
      ownerMemberId: "bot-a",
      assignedMemberIds: ["bot-a"],
      createdAtMs: 1,
      updatedAtMs: 1,
    } satisfies Task);
    const responsibility = {
      owner: "bot-a",
      executors: ["bot-a"],
      decisionAuthority: "human",
    };
    const next = applyTaskHandoff({
      task: current,
      responsibility,
      cfg: { collaboration: { task: { handoffContract: false } } },
      handoff: normalizeTaskHandoff({
        taskId: current.taskId,
        from: "bot-a",
        to: "bot-b",
        reason: "owner_transfer",
        remainingWork: "finish the review",
        acceptanceCriteria: ["signed off"],
      }),
    });
    expect(next.responsibility.owner).toBe("bot-b");
    expect(responsibility.owner).toBe("bot-a");
  });

  test("flag-on owner_transfer shortcut does not change responsibility", () => {
    const current = asGovernedTask({
      taskId: "task-h1",
      groupId: "grp_handoff",
      title: "Roll the owner",
      status: "in_progress",
      ownerMemberId: "bot-a",
      assignedMemberIds: ["bot-a"],
      createdAtMs: 1,
      updatedAtMs: 1,
    } satisfies Task);
    const responsibility = {
      owner: "bot-a",
      executors: ["bot-a"],
      decisionAuthority: "human",
    };
    expect(() =>
      applyTaskHandoff({
        task: current,
        responsibility,
        cfg: { collaboration: { task: { handoffContract: true } } },
        handoff: normalizeTaskHandoff({
          taskId: current.taskId,
          from: "bot-a",
          to: "bot-b",
          reason: "owner_transfer",
          remainingWork: "finish the review",
          acceptanceCriteria: ["signed off"],
        }),
      }),
    ).toThrow(HandoffContractRequiredError);
    expect(responsibility.owner).toBe("bot-a");
    expect(current.ownerMemberId).toBe("bot-a");
  });
});

describe("handoff contract invariants", () => {
  test("flag-on closed loop changes owner only after propose→accept→approve→apply", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const task = taskOf();
    await writeJsonDurable(handoffTaskOverlayPath(auth.namespace.handoffsDir, task.taskId), task);

    const proposed = await proposeHandoff(auth, proposeInput, { cfg, nowMs: 30 });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    const accepted = await acceptHandoff(
      auth,
      proposed.value,
      { type: "bot", id: "bot-b" },
      { cfg, nowMs: 31 },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    const approved = await approveHandoff(
      auth,
      accepted.value,
      { type: "human", id: "owner-1" },
      { cfg, nowMs: 32 },
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      return;
    }
    const applied = await applyApprovedHandoff(auth, approved.value, task, { cfg, nowMs: 33 });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value.task.responsibility?.owner).toBe("bot-b");
    expect(applied.value.task.ownerMemberId).toBe("bot-b");
    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-b");
    const types = await factTypes(auth.groupId);
    expect(types).toContain("TaskHandoffReceiverAccepted");
    expect(types).toContain("TaskHandoffApproved");
    expect(types).toContain("TaskResponsibilityChanged");
  });

  test("flag-off propose does not write under handoffs/", async () => {
    const { cfg } = await useConfig(false);
    const auth = authority(cfg);
    const proposed = await proposeHandoff(auth, proposeInput, { cfg });
    expect(proposed.ok).toBe(false);
    await expect(fs.access(auth.namespace.handoffsDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("missing accept or approve leaves responsibility unchanged", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const task = taskOf();
    await writeJsonDurable(handoffTaskOverlayPath(auth.namespace.handoffsDir, task.taskId), task);

    const proposed = await proposeHandoff(auth, proposeInput, { cfg, nowMs: 10 });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    expect(proposed.value.requiresApproval).toBe("human");
    expect(proposed.value.status).toBe("proposed");
    const logPath = handoffLogPath(auth.namespace.handoffsDir, task.taskId);
    expect(logPath.includes(`${path.sep}handoffs${path.sep}`)).toBe(true);

    const forged: HandoffContract = { ...proposed.value, status: "approved" };
    const skipped = await applyApprovedHandoff(auth, forged, task, { cfg, nowMs: 11 });
    expect(skipped.ok).toBe(false);
    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-a");
    expect(await factTypes(auth.groupId)).not.toContain("TaskResponsibilityChanged");

    const accepted = await acceptHandoff(
      auth,
      proposed.value,
      { type: "bot", id: "bot-b" },
      { cfg, nowMs: 12 },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    const botApproved = await approveHandoff(
      auth,
      accepted.value,
      { type: "bot", id: "bot-b" },
      { cfg, nowMs: 13 },
    );
    expect(botApproved.ok).toBe(false);
    const withoutApprove = await applyApprovedHandoff(auth, accepted.value, task, {
      cfg,
      nowMs: 14,
    });
    expect(withoutApprove.ok).toBe(false);
    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-a");
    expect((await readOverlay(auth))?.ownerMemberId).toBe("bot-a");
    const types = await factTypes(auth.groupId);
    expect(types).toContain("TaskHandoffReceiverAccepted");
    expect(types).not.toContain("TaskHandoffApproved");
    expect(types).not.toContain("TaskResponsibilityChanged");
  });

  test("crash after the fact and before the task write rolls forward", async () => {
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
            throw new Error("crash-after-fact");
          },
        },
      }),
    ).rejects.toThrow(/crash-after-fact/);

    expect((await readOverlay(auth))?.responsibility?.owner).toBe("bot-a");
    expect(await factTypes(auth.groupId)).toContain("TaskResponsibilityChanged");
    await expect(
      fs.access(handoffTxnPath(auth.namespace.handoffsDir, task.taskId)),
    ).resolves.toBeUndefined();

    const recovered = await recoverPendingHandoffTxns({ authority: auth, cfg });
    expect(recovered.rolledForward).toEqual([approved.value.handoffId]);
    const overlay = await readOverlay(auth);
    expect(overlay?.responsibility?.owner).toBe("bot-b");
    expect(overlay?.ownerMemberId).toBe("bot-b");
    const types = await factTypes(auth.groupId);
    expect(types.filter((type) => type === "TaskResponsibilityChanged")).toEqual([
      "TaskResponsibilityChanged",
    ]);
    await expect(
      fs.access(handoffTxnPath(auth.namespace.handoffsDir, task.taskId)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const ledgerPath = (await readCollaborationLedgerArchive({ groupId: auth.groupId })).sources[0];
    await appendJsonlDurable(ledgerPath, {
      kind: "not_a_real_ledger_kind",
      recordedAtMs: 99,
      groupId: auth.groupId,
    });
    const archive = await readCollaborationLedgerArchive({ groupId: auth.groupId });
    expect(
      archive.records.some((record) => (record.kind as string) === "not_a_real_ledger_kind"),
    ).toBe(false);
    expect(archive.records.some((record) => record.kind === "fact")).toBe(true);
  });
});

describe("handoffCollaborationTask × handoffContract (learning seam)", () => {
  test("flag-off keeps applyTaskHandoff shortcut and changes owner", async () => {
    const { cfg, groupId } = await useLearningHandoffConfig(false);
    const applySpy = vi.spyOn(taskRuntime, "applyTaskHandoff");
    const { createWorkspaceCollaborationStores } =
      await import("../collaboration-learning/shared.js");
    const { handoffCollaborationTask } = await import("../collaboration-learning/state-machine.js");
    const { objectStorage } = createWorkspaceCollaborationStores(cfg);
    await objectStorage.writeObject(groupId, "task", "task-sm-1", learningSeedTask(groupId));

    const updated = await handoffCollaborationTask({
      groupId,
      taskId: "task-sm-1",
      ...learningHandoffParams,
    });

    expect(applySpy).toHaveBeenCalled();
    expect(updated.ownerMemberId).toBe("bot-b");
    const stored = await objectStorage.readObject<Task>(groupId, "task", "task-sm-1");
    expect(stored?.ownerMemberId).toBe("bot-b");
  });

  test("flag-on never calls applyTaskHandoff and leaves responsibility unchanged", async () => {
    const { cfg, groupId } = await useLearningHandoffConfig(true);
    // Barrier: if the learning seam ever fell through to the shortcut, this mock
    // would surface as shortcut-should-not-run instead of HandoffContractRequiredError.
    vi.spyOn(taskRuntime, "applyTaskHandoff").mockImplementation(() => {
      throw new Error("shortcut-should-not-run");
    });
    const { createWorkspaceCollaborationStores } =
      await import("../collaboration-learning/shared.js");
    const { handoffCollaborationTask } = await import("../collaboration-learning/state-machine.js");
    const { objectStorage } = createWorkspaceCollaborationStores(cfg);
    await objectStorage.writeObject(groupId, "task", "task-sm-1", learningSeedTask(groupId));

    expect(isCollabTaskHandoffContractEnabled(cfg)).toBe(true);
    expect(isCollabTaskHandoffContractEnabled(loadConfig())).toBe(true);

    await expect(
      handoffCollaborationTask({
        groupId,
        taskId: "task-sm-1",
        ...learningHandoffParams,
      }),
    ).rejects.toBeInstanceOf(HandoffContractRequiredError);

    const stored = await objectStorage.readObject<Task>(groupId, "task", "task-sm-1");
    expect(stored?.ownerMemberId).toBe("bot-a");
    expect(stored?.assignedMemberIds).toEqual(["bot-a"]);
  });

  test("flag-on error points at the contract API sequence", async () => {
    const { cfg, groupId } = await useLearningHandoffConfig(true);
    const { createWorkspaceCollaborationStores } =
      await import("../collaboration-learning/shared.js");
    const { handoffCollaborationTask } = await import("../collaboration-learning/state-machine.js");
    const { objectStorage } = createWorkspaceCollaborationStores(cfg);
    await objectStorage.writeObject(groupId, "task", "task-sm-1", learningSeedTask(groupId));

    await expect(
      handoffCollaborationTask({
        groupId,
        taskId: "task-sm-1",
        ...learningHandoffParams,
      }),
    ).rejects.toThrow(/proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff/);
  });
});
