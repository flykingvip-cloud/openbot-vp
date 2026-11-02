/**
 * Post-publish intended-claim handoff — consumable wake path.
 *
 * Positive proof starts at the real CEO `activateCollaborationTask` entry.
 * Only the woken executor run (inside WakeRoundDispatcher) may call claim →
 * apply → propose via production entries/tools. Tests must not manually seed
 * those steps outside the dispatcher to paper over a missing consumer.
 *
 * Handoff audit (`recordHandoffWake`) is kept; consumable wake reuses source
 * `nudge` (already in WAKE_ROUND_DISPATCH_SOURCES) — no allowlist expansion,
 * no executor impersonation, no new scheduler.
 */
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
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { loadBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import { listWakeEvents } from "../collaboration-dispatch/wake-contract.js";
import {
  setWakeRoundDispatcher,
  type WakeRoundDispatcher,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import { activateCollaborationTask } from "./activate-collaboration-task.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  listCollaborationBoardItems,
  proposeCollaborationTodolist,
} from "./claim-contract-entry.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import {
  buildPostPublishHandoffOpKey,
  tryClaimAfterBoardPublish,
} from "./try-claim-after-board-publish.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

afterEach(async () => {
  setWakeRoundDispatcher(null);
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const GROUP_ID = "grp_post_publish_handoff";
const CEO = "human:ceo";
const EXECUTOR = "bot-exec";

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
        selfAdvance: { mode: "execute", executeGroupAllowlist: [GROUP_ID] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-post-publish-handoff-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_post_publish_handoff" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_post_publish_handoff",
    tenant: { tenantId: "tenant-post-publish-handoff", trust: "none" },
    groupId: GROUP_ID,
    profile: "personal_local",
    cfg,
  });
}

async function seedMappedMembership(params: {
  cfg: OpenBotConfig;
  groupId: string;
  memberIds: readonly string[];
  ownerUserId?: string;
}): Promise<void> {
  const stores = createWorkspaceCollaborationStores(params.cfg);
  const owner = params.ownerUserId ?? CEO;
  const state = makeOperatingState({
    groupId: params.groupId,
    governance: {
      ownerUserId: owner,
      coordinatorBotId: "",
      adminUserIds: [],
    },
  });
  state.memberRoleMap = params.memberIds.map((memberId) => ({
    memberId,
    memberKind: memberId.startsWith("human:") ? "human" : "bot",
    governanceRole: memberId === owner ? "owner" : "member",
    collaborationRole: null,
    status: "active",
  }));
  await writeGroupOperatingState({
    fileStore: stores.fileStore,
    groupId: params.groupId,
    state,
    writeKind: "auth",
  });
}

/** Production entries invoked only from inside the woken dispatcher (executor run). */
function createExecutorToolDispatcher(params: {
  cfg: OpenBotConfig;
  groupId: string;
  taskId: string;
  executor: string;
  onDispatch?: () => void;
}): WakeRoundDispatcher {
  return async (req) => {
    params.onDispatch?.();
    const itemId = (req.itemId ?? "").trim();
    if (!itemId) {
      return { ok: false, reason: "missing_item_id", sideEffectClass: "not_started" };
    }
    // claim_item → apply_claim → propose_todolist via production organizer entries
    // (same backends the collaboration-board tool uses). Actor = intended executor.
    const claimed = await claimCollaborationBoardItem({
      groupId: params.groupId,
      taskId: params.taskId,
      itemId,
      claimantId: params.executor,
      actor: params.executor,
      cfg: params.cfg,
    });
    if (claimed.status !== "claimed" && claimed.status !== "applied") {
      return {
        ok: false,
        reason: `claim_failed:${claimed.status}`,
        sideEffectClass: "started_or_unknown",
      };
    }
    const applied = await applyCollaborationBoardClaim({
      groupId: params.groupId,
      taskId: params.taskId,
      itemId,
      actor: params.executor,
      cfg: params.cfg,
    });
    if (applied.item.status !== "applied") {
      return {
        ok: false,
        reason: `apply_failed:${applied.item.status}`,
        sideEffectClass: "started_or_unknown",
      };
    }
    const proposed = await proposeCollaborationTodolist({
      groupId: params.groupId,
      taskId: params.taskId,
      boardItemId: itemId,
      ownerMemberId: params.executor,
      actor: params.executor,
      steps: [{ title: "draft handoff markdown" }],
      cfg: params.cfg,
    });
    if (!proposed.todolist?.todolistId) {
      return {
        ok: false,
        reason: "propose_failed",
        sideEffectClass: "started_or_unknown",
      };
    }
    return {
      ok: true,
      roundId: `handoff-round:${params.taskId}:${itemId}`,
      sideEffectClass: "completed_with_receipt",
    };
  };
}

describe("post-publish claim handoff (activate → consumable nudge dispatch)", () => {
  it("CEO activate schedules intended bot; production dispatcher/tools claim→apply→propose", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-post-publish-handoff";
    let dispatchCalls = 0;
    const dispatcher = createExecutorToolDispatcher({
      cfg,
      groupId: GROUP_ID,
      taskId,
      executor: EXECUTOR,
      onDispatch: () => {
        dispatchCalls += 1;
      },
    });

    // Membership surface must map CEO + intended executor or consume fails auth_revoked
    // (task owner is a duty candidate). Do not claim here — only auth mapping.
    await seedMappedMembership({
      cfg,
      groupId: GROUP_ID,
      memberIds: [CEO, EXECUTOR],
    });

    // Real CEO activate entry — do NOT pre-claim or manually call claim outside dispatcher.
    const activated = await activateCollaborationTask({
      groupId: GROUP_ID,
      taskId,
      title: "建板后受控接力",
      message: "请发布看板并由唯一 intended 执行者接手起草，验收标题与正文",
      actor: CEO,
      goal: "handoff wake 被消费且执行者自行认领提计划",
      acceptanceCriteria: ["has title", "has body"],
      constraints: ["publish≠publisher claim", "不扩 source 清单"],
      suggestedClaimantIds: [EXECUTOR],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
      roundDispatcher: dispatcher,
    });

    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    // Activate envelope never flips dispatched (建板 ≠ 派工验收).
    expect(activated.dispatched).toBe(false);

    const formalClaim = activated.formalClaim;
    expect(formalClaim).toBeTruthy();
    if (!formalClaim) {
      throw new Error("formalClaim missing");
    }
    expect(formalClaim.outcome).toBe("scheduled");
    if (formalClaim.outcome !== "scheduled") {
      throw new Error(`expected scheduled, got ${JSON.stringify(formalClaim)}`);
    }
    expect(formalClaim.scheduledClaimantId).toBe(EXECUTOR);
    expect(formalClaim.claimantId).toBeNull();
    expect(formalClaim.wakeRecorded).toBe(true);
    expect(formalClaim.wakeDispatched, `formalClaim.reason=${formalClaim.reason}`).toBe(true);
    expect(formalClaim.reason).toContain("wake_dispatched");
    expect(formalClaim.reason).not.toContain("recorded_not_dispatched");
    expect(dispatchCalls).toBe(1);

    // Board/responsibility advanced only because dispatcher ran production tools.
    const listed = await listCollaborationBoardItems({
      groupId: GROUP_ID,
      taskId,
      cfg,
    });
    const live = listed.find((row) => row.itemId === activated.boardItemId);
    expect(live).toBeTruthy();
    expect(live?.claimantId).toBe(EXECUTOR);
    expect(["claimed", "applied", "in_progress"]).toContain(live?.status ?? "");

    const auth = authority(cfg);
    const wakes = await listWakeEvents(auth, { groupId: GROUP_ID, taskId });
    const handoff = wakes.filter((w) => w.source === "handoff" && w.toAgentIds.includes(EXECUTOR));
    const nudge = wakes.filter((w) => w.source === "nudge" && w.toAgentIds.includes(EXECUTOR));
    expect(handoff.length).toBeGreaterThan(0);
    expect(nudge.length).toBeGreaterThan(0);
  });

  it("dispatcher unavailable → recorded_not_dispatched; no claim/responsibility", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-handoff-no-consumer";
    await seedMappedMembership({
      cfg,
      groupId: GROUP_ID,
      memberIds: [CEO, EXECUTOR],
    });

    const activated = await activateCollaborationTask({
      groupId: GROUP_ID,
      taskId,
      title: "无消费派发",
      message: "请发布看板；dispatcher 不可用时应仅记账不派发，验收无认领",
      actor: CEO,
      goal: "recorded but not dispatched",
      acceptanceCriteria: ["无认领", "无责任投影"],
      constraints: ["仅记账不派发", "禁止自动代认领"],
      suggestedClaimantIds: [EXECUTOR],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
      roundDispatcher: null,
    });

    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    expect(activated.dispatched).toBe(false);
    const formalClaim = activated.formalClaim;
    expect(formalClaim?.outcome).toBe("scheduled");
    if (formalClaim?.outcome !== "scheduled") {
      throw new Error(`expected scheduled, got ${JSON.stringify(formalClaim)}`);
    }
    expect(formalClaim.wakeRecorded).toBe(true);
    expect(formalClaim.wakeDispatched).toBe(false);
    expect(formalClaim.reason).toContain("recorded_not_dispatched");
    expect(formalClaim.reason).toContain("no_consumer");
    expect(formalClaim.claimantId).toBeNull();
    expect(formalClaim.item.claimantId == null || formalClaim.item.claimantId === "").toBe(true);

    const listed = await listCollaborationBoardItems({ groupId: GROUP_ID, taskId, cfg });
    const live = listed.find((row) => row.itemId === activated.boardItemId);
    expect(live?.status).toBe("published");
    expect(live?.claimantId == null || live?.claimantId === "").toBe(true);

    const stores = createWorkspaceCollaborationStores(cfg);
    const task = await stores.objectStorage.readObject<Task>(GROUP_ID, "task", taskId);
    const responsibility = (task as { responsibility?: { executors?: string[] } } | null)
      ?.responsibility;
    const executors = responsibility?.executors ?? [];
    expect(executors.includes(EXECUTOR)).toBe(false);
  });

  it("target de-authorized → recorded_not_dispatched; dispatcher not invoked; no claim", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-handoff-auth-revoked";
    const stores = createWorkspaceCollaborationStores(cfg);

    // Membership surface present but executor not mapped → auth_revoked at consume.
    const revoked = makeOperatingState({
      groupId: GROUP_ID,
      governance: { ownerUserId: CEO, coordinatorBotId: "", adminUserIds: [] },
    });
    revoked.memberRoleMap = [
      {
        memberId: CEO,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: GROUP_ID,
      state: revoked,
      writeKind: "auth",
    });

    let dispatchCalls = 0;
    const activated = await activateCollaborationTask({
      groupId: GROUP_ID,
      taskId,
      title: "撤权不派发",
      message: "请发布看板；目标撤权后应记账不派发，验收无认领",
      actor: CEO,
      goal: "auth_revoked recorded_not_dispatched",
      acceptanceCriteria: ["无认领", "dispatcher未调用"],
      constraints: ["目标撤权不得派发", "禁止代认领"],
      suggestedClaimantIds: [EXECUTOR],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
      roundDispatcher: async () => {
        dispatchCalls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
    });

    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    expect(activated.dispatched).toBe(false);
    const formalClaim = activated.formalClaim;
    expect(formalClaim?.outcome).toBe("scheduled");
    if (formalClaim?.outcome !== "scheduled") {
      throw new Error(`expected scheduled, got ${JSON.stringify(formalClaim)}`);
    }
    expect(formalClaim.wakeRecorded).toBe(true);
    expect(formalClaim.wakeDispatched).toBe(false);
    expect(formalClaim.reason).toContain("recorded_not_dispatched");
    expect(formalClaim.reason).toContain("auth_revoked");
    expect(dispatchCalls).toBe(0);

    const listed = await listCollaborationBoardItems({ groupId: GROUP_ID, taskId, cfg });
    const live = listed.find((row) => row.itemId === activated.boardItemId);
    expect(live?.status).toBe("published");
    expect(live?.claimantId == null || live?.claimantId === "").toBe(true);
  });

  it("retry / concurrent publish does not double-wake (stable opKey)", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-handoff-idempotent";
    const auth = authority(cfg);
    await seedMappedMembership({
      cfg,
      groupId: GROUP_ID,
      memberIds: [CEO, EXECUTOR],
    });

    // Publish via activate with a counting dispatcher (no tool side effects needed).
    let dispatchCalls = 0;
    const counting: WakeRoundDispatcher = async (req) => {
      dispatchCalls += 1;
      return {
        ok: true,
        roundId: `idem-${req.itemId ?? "x"}`,
        sideEffectClass: "completed_with_receipt",
      };
    };

    const activated = await activateCollaborationTask({
      groupId: GROUP_ID,
      taskId,
      title: "幂等接力",
      message: "请发布看板；重复 tryClaim 不得二次唤醒，验收单次派发",
      actor: CEO,
      goal: "no double wake",
      acceptanceCriteria: ["单次派发", "opKey幂等"],
      constraints: ["禁止重复唤醒", "稳定 opKey"],
      suggestedClaimantIds: [EXECUTOR],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
      roundDispatcher: counting,
    });
    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    const formalClaim = activated.formalClaim;
    expect(formalClaim?.outcome).toBe("scheduled");
    if (formalClaim?.outcome !== "scheduled") {
      throw new Error(JSON.stringify(formalClaim));
    }
    expect(formalClaim.wakeDispatched).toBe(true);
    expect(dispatchCalls).toBe(1);

    const itemId = activated.boardItemId;
    const expectedOpKey = buildPostPublishHandoffOpKey({
      groupId: GROUP_ID,
      taskId,
      itemId,
      intendedClaimantId: EXECUTOR,
    });
    expect(expectedOpKey).toContain("post_publish_intended_claim_handoff");

    // Second tryClaim with the same published snapshot + same opKey consumer path.
    const liveItem = (await loadBoardClaimItem(auth, { taskId, itemId })) ?? formalClaim.item;
    const again = await tryClaimAfterBoardPublish({
      groupId: GROUP_ID,
      taskId,
      item: { ...liveItem, status: "published", claimantId: null },
      actorId: CEO,
      authority: auth,
      cfg,
      roundDispatcher: counting,
    });
    expect(again.outcome).toBe("scheduled");
    if (again.outcome !== "scheduled") {
      throw new Error(JSON.stringify(again));
    }
    // Consumable path reuses durable wake-op — no second dispatcher invoke.
    expect(again.wakeRecorded).toBe(true);
    expect(again.wakeDispatched).toBe(true);
    expect(again.reason).toMatch(/idempotent_reuse|wake_dispatched/);
    expect(dispatchCalls).toBe(1);
  });
});
