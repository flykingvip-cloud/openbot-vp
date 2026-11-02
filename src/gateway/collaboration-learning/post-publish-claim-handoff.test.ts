/**
 * Post-publish intended-claim handoff — consumable wake path.
 *
 * Positive proof: CEO `activateCollaborationTask` → production nudge consumer →
 * `createModeBWakeRoundDispatcher` + `resolveModeBWakeRoundContext` (Mode B boot) →
 * mock **model** returns structured `collaboration_board` tool calls only →
 * production tool runner (`createCollaborationBoardTool().execute`) runs
 * claim_item → apply_claim → propose_todolist (real entry backends). ACL stays
 * on via production boot (`enforceAcl: true`). Forbidden: (1) custom
 * WakeRoundDispatcher that performs formal steps; (2) calling claim/apply/propose
 * (or writing formal business state) inside the model mock.
 *
 * Mock boundary disclosure (honest):
 * - Model: mocked via `getReplyFromConfig` — emits tool-call shapes only.
 * - Space list: `listGatewayCollaborationSpaces` stays stubbed for Mode B boot
 *   membership surface (harness); this is NOT "only mock model". Documented here
 *   and in SUMMARY — do not claim full end-to-end without this caveat.
 * - Trusted-team resolve for the board tool is bound to the same personal_local
 *   workspace stores activate uses (harness SoT), so formal writes land on the
 *   live board; production claim/apply/propose entry functions are not stubbed.
 *
 * Handoff audit (`recordHandoffWake`) is kept; consumable wake reuses source
 * `nudge` (already in WAKE_ROUND_DISPATCH_SOURCES) — no allowlist expansion.
 *
 * Status taxonomy: `wakeDispatched` = durable settle only; `wakeDispatcherAccepted`
 * = clear acceptance only (same durable settle here — NOT unknown/in-flight/mere
 * pending); `wakePendingVerification` kept separate and must not auto-retry or
 * look like success/accepted.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLABORATION_BOARD_TOOL,
  createCollaborationBoardTool,
  type CollaborationBoardToolDeps,
} from "../../agents/tools/collaboration-board-tool.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { loadBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { createModeBWakeRoundDispatcher } from "../collaboration-dispatch/mode-b-wake-round-dispatcher.js";
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
import {
  resolveModeBWakeRoundContext,
  unbindGatewayWakeRoundDispatcher,
} from "../wake-round-dispatcher-boot.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { activateCollaborationTask } from "./activate-collaboration-task.js";
import { listCollaborationBoardItems } from "./claim-contract-entry.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";
import {
  buildPostPublishHandoffOpKey,
  tryClaimAfterBoardPublish,
} from "./try-claim-after-board-publish.js";

const getReplyFromConfig = vi.hoisted(() => vi.fn());
const listGatewayCollaborationSpaces = vi.hoisted(() => vi.fn());

vi.mock("../../auto-reply/reply.js", () => ({
  getReplyFromConfig: (...args: unknown[]) => getReplyFromConfig(...args),
}));

vi.mock("./space-store.js", () => ({
  listGatewayCollaborationSpaces: (...args: unknown[]) => listGatewayCollaborationSpaces(...args),
}));

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

beforeEach(() => {
  getReplyFromConfig.mockReset();
  listGatewayCollaborationSpaces.mockReset();
  getReplyFromConfig.mockResolvedValue({ text: "noop" });
  listGatewayCollaborationSpaces.mockResolvedValue({ spaces: [] });
});

afterEach(async () => {
  setWakeRoundDispatcher(null);
  unbindGatewayWakeRoundDispatcher();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  vi.clearAllMocks();
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
    tenant: { tenantId: null, trust: "none" },
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

function seedPersonalSpace(params?: { includeExecutor?: boolean }) {
  const includeExecutor = params?.includeExecutor !== false;
  listGatewayCollaborationSpaces.mockResolvedValue({
    spaces: [
      {
        id: GROUP_ID,
        groupId: GROUP_ID,
        title: GROUP_ID,
        tenantId: null,
        members: {
          humans: [{ userId: CEO, name: CEO }],
          bots: includeExecutor ? [{ agentId: EXECUTOR, name: EXECUTOR, status: "active" }] : [],
        },
        operatingState: null,
        coordinatorBotId: null,
      },
    ],
  });
}

type BoardToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

function parseWakePromptToken(body: unknown, key: string): string | null {
  const text = typeof body === "string" ? body : "";
  const matched = text.match(new RegExp(`\\b${key}=([^\\s]+)`));
  return matched?.[1]?.trim() || null;
}

/**
 * Bind production collaboration_board tool to the same personal_local trusted
 * locator activate uses (harness SoT). claim/apply/propose entry deps stay
 * production defaults — not stubbed.
 */
function bindPersonalLocalBoardTool(cfg: OpenBotConfig) {
  const groupLocator = resolveTrustedGroupLocator({
    groupId: GROUP_ID,
    tenantId: null,
    profile: "personal_local",
    cfg,
  });
  const groupsRoot = path.dirname(groupLocator);
  const trusted = { groupsRoot, groupLocator };
  const stores = createTrustedGroupStores(trusted);
  const actorId = EXECUTOR.startsWith("bot:") ? EXECUTOR : `bot:${EXECUTOR}`;
  return createCollaborationBoardTool({
    requesterAgentIdOverride: EXECUTOR,
    agentSessionKey: `agent:${EXECUTOR}:main:space:${GROUP_ID}`,
    agentGroupId: GROUP_ID,
    config: cfg,
    deps: {
      isEnabled: () => true,
      resolveActor: async () => EXECUTOR,
      resolveTrustedTeam: (async () => ({
        ok: true as const,
        auth: {
          ok: true as const,
          profile: "personal_local" as const,
          tenantId: "_local",
          actor: actorId,
          groupLocator,
          groupsRoot,
          governanceRole: "member" as const,
          memberStatus: "active" as const,
        },
        stores,
        trusted,
        tenant: { tenantId: "_local", trust: "local" as const },
        groupsRoot,
        groupLocator,
      })) as CollaborationBoardToolDeps["resolveTrustedTeam"],
      // Intentionally omit claimItem / applyClaim / proposeTodolist — production entries.
    },
  });
}

/** Production tool runner: executes structured collaboration_board tool calls only. */
async function runBoardToolCallsThroughProductionTool(params: {
  tool: ReturnType<typeof createCollaborationBoardTool>;
  toolCalls: readonly BoardToolCall[];
  toolTrace: string[];
}): Promise<void> {
  for (const tc of params.toolCalls) {
    if (tc.name !== COLLABORATION_BOARD_TOOL) {
      throw new Error(`unexpected tool name: ${tc.name}`);
    }
    const result = await params.tool.execute(tc.id, tc.arguments);
    const details = (result as { details?: Record<string, unknown> }).details ?? {};
    const actionRaw = tc.arguments.action;
    const action = typeof actionRaw === "string" ? actionRaw : "";
    params.toolTrace.push(`${action}:${details.ok === false ? "fail" : "ok"}`);
    if (details.ok === false) {
      throw new Error(`board tool ${action} failed: ${JSON.stringify(details)}`);
    }
  }
}

/** Production Mode B dispatcher — boot resolves identity/scope; ACL enforce stays on. */
function createProductionModeBDispatcher(cfg: OpenBotConfig): WakeRoundDispatcher {
  return createModeBWakeRoundDispatcher(async (request) =>
    resolveModeBWakeRoundContext(request, cfg),
  );
}

describe("post-publish claim handoff (activate → consumable nudge dispatch)", () => {
  it("CEO activate → Mode B boot → model tool-calls → production board tool runner (ACL on)", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-post-publish-handoff";
    await seedMappedMembership({
      cfg,
      groupId: GROUP_ID,
      memberIds: [CEO, EXECUTOR],
    });
    // Space-list mock boundary (disclosed): Mode B boot membership surface only.
    // This is NOT "only mock model" — keep out of the model mock.
    seedPersonalSpace();

    const boardTool = bindPersonalLocalBoardTool(cfg);
    const toolTrace: string[] = [];
    const modelEmittedToolCalls: BoardToolCall[] = [];

    // MODEL MOCK: structured collaboration_board tool-call shapes only.
    // FORBIDDEN here: claim/apply/propose entry calls or any formal business write.
    const modelReplyToolCallsOnly = vi.fn(async (ctx: { Body?: string }) => {
      const itemId = parseWakePromptToken(ctx.Body, "board");
      const taskFromPrompt = parseWakePromptToken(ctx.Body, "task") ?? taskId;
      if (!itemId) {
        return { text: "no board item in wake prompt", toolCalls: [] as BoardToolCall[] };
      }
      const toolCalls: BoardToolCall[] = [
        {
          id: "tc-claim",
          name: COLLABORATION_BOARD_TOOL,
          arguments: {
            action: "claim_item",
            groupId: GROUP_ID,
            taskId: taskFromPrompt,
            itemId,
            claimantId: EXECUTOR,
          },
        },
        {
          id: "tc-apply",
          name: COLLABORATION_BOARD_TOOL,
          arguments: {
            action: "apply_claim",
            groupId: GROUP_ID,
            taskId: taskFromPrompt,
            itemId,
          },
        },
        {
          id: "tc-propose",
          name: COLLABORATION_BOARD_TOOL,
          arguments: {
            action: "propose_todolist",
            groupId: GROUP_ID,
            taskId: taskFromPrompt,
            boardItemId: itemId,
            steps: [{ title: "draft handoff markdown" }],
          },
        },
      ];
      return {
        text: "Mode B member model: collaboration_board tool calls only",
        toolCalls,
      };
    });

    // Harness stand-in for production agent tool loop: model reply → board tool.execute.
    // Separated from the model mock so formal writes never live inside modelReplyToolCallsOnly.
    getReplyFromConfig.mockImplementation(async (ctx: { Body?: string }) => {
      const reply = await modelReplyToolCallsOnly(ctx);
      const toolCalls = reply.toolCalls ?? [];
      modelEmittedToolCalls.push(...toolCalls);
      await runBoardToolCallsThroughProductionTool({
        tool: boardTool,
        toolCalls,
        toolTrace,
      });
      return reply;
    });

    const modeBDispatcher = createProductionModeBDispatcher(cfg);

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
      roundDispatcher: modeBDispatcher,
    });

    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    // Activate envelope never flips dispatched (建板 ≠ 派工验收).
    expect(activated.dispatched).toBe(false);

    const formalClaim = activated.formalClaim;
    expect(formalClaim).toBeTruthy();
    if (!formalClaim || formalClaim.outcome !== "scheduled") {
      throw new Error(`expected scheduled, got ${JSON.stringify(formalClaim)}`);
    }
    expect(formalClaim.scheduledClaimantId).toBe(EXECUTOR);
    expect(formalClaim.claimantId).toBeNull();
    expect(formalClaim.wakeRecorded).toBe(true);

    // Model emitted tool calls only; production board tool runner executed them.
    expect(modelReplyToolCallsOnly).toHaveBeenCalled();
    expect(getReplyFromConfig).toHaveBeenCalled();
    expect(modelEmittedToolCalls.map((c) => c.arguments.action)).toEqual([
      "claim_item",
      "apply_claim",
      "propose_todolist",
    ]);
    expect(toolTrace).toEqual(["claim_item:ok", "apply_claim:ok", "propose_todolist:ok"]);

    // Deterministic taxonomy: accepted ≠ pending/unknown.
    // wakeDispatcherAccepted only when wakeDispatched (durable settle); pending stays false.
    if (formalClaim.wakeDispatched) {
      expect(formalClaim.wakeDispatcherAccepted).toBe(true);
      expect(formalClaim.wakePendingVerification).toBe(false);
      expect(formalClaim.reason).toContain("wake_dispatched");
      expect(formalClaim.reason).not.toContain("recorded_pending_verification");
      expect(formalClaim.reason).not.toContain("recorded_not_dispatched");
    } else {
      expect(formalClaim.wakePendingVerification).toBe(true);
      expect(formalClaim.wakeDispatcherAccepted).toBe(false);
      expect(formalClaim.reason).toContain("recorded_pending_verification");
      expect(formalClaim.reason).not.toMatch(/:wake_dispatched:/);
    }

    // Board/responsibility advanced via production collaboration_board tool.execute chain.
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

  it("started_or_unknown is pending verification — not wakeDispatched; no blind re-dispatch", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-handoff-unknown-no-retry";
    await seedMappedMembership({
      cfg,
      groupId: GROUP_ID,
      memberIds: [CEO, EXECUTOR],
    });

    let dispatchCalls = 0;
    const unknownDispatcher: WakeRoundDispatcher = async () => {
      dispatchCalls += 1;
      return {
        ok: false,
        reason: "round_aborted:simulated_after_start",
        sideEffectClass: "started_or_unknown",
      };
    };

    const activated = await activateCollaborationTask({
      groupId: GROUP_ID,
      taskId,
      title: "unknown 不冒充成功",
      message: "请发布看板；副作用可能已启动但结果不明不得标成功，验收不重试",
      actor: CEO,
      goal: "pending verification not success",
      acceptanceCriteria: ["wakeDispatched=false", "不盲目重试"],
      constraints: ["unknown≠success", "禁止自动重派"],
      suggestedClaimantIds: [EXECUTOR],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
      roundDispatcher: unknownDispatcher,
    });

    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    expect(activated.dispatched).toBe(false);
    const formalClaim = activated.formalClaim;
    expect(formalClaim?.outcome).toBe("scheduled");
    if (formalClaim?.outcome !== "scheduled") {
      throw new Error(JSON.stringify(formalClaim));
    }
    expect(formalClaim.wakeRecorded).toBe(true);
    expect(formalClaim.wakeDispatched).toBe(false);
    expect(formalClaim.wakePendingVerification).toBe(true);
    // unknown / in-flight / mere pending must NOT report dispatcher accepted
    expect(formalClaim.wakeDispatcherAccepted).toBe(false);
    expect(formalClaim.wakeSideEffectClass).toBe("started_or_unknown");
    expect(formalClaim.reason).toContain("recorded_pending_verification");
    expect(formalClaim.reason).not.toContain("wake_dispatched");
    expect(dispatchCalls).toBe(1);

    // Second tryClaim must not blind re-execute (wake-op unknown suppresses).
    const auth = authority(cfg);
    const liveItem =
      (await loadBoardClaimItem(auth, {
        taskId,
        itemId: activated.boardItemId,
      })) ?? formalClaim.item;
    const again = await tryClaimAfterBoardPublish({
      groupId: GROUP_ID,
      taskId,
      item: { ...liveItem, status: "published", claimantId: null },
      actorId: CEO,
      authority: auth,
      cfg,
      roundDispatcher: unknownDispatcher,
    });
    expect(again.outcome).toBe("scheduled");
    if (again.outcome !== "scheduled") {
      throw new Error(JSON.stringify(again));
    }
    expect(again.wakeDispatched).toBe(false);
    expect(again.wakePendingVerification).toBe(true);
    expect(again.wakeDispatcherAccepted).toBe(false);
    expect(dispatchCalls).toBe(1);
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
    expect(formalClaim.wakePendingVerification).toBe(false);
    expect(formalClaim.wakeDispatcherAccepted).toBe(false);
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
    expect(formalClaim.wakePendingVerification).toBe(false);
    expect(formalClaim.wakeDispatcherAccepted).toBe(false);
    expect(formalClaim.reason).toContain("recorded_not_dispatched");
    expect(formalClaim.reason).toContain("auth_revoked");
    expect(dispatchCalls).toBe(0);

    const listed = await listCollaborationBoardItems({ groupId: GROUP_ID, taskId, cfg });
    const live = listed.find((row) => row.itemId === activated.boardItemId);
    expect(live?.status).toBe("published");
    expect(live?.claimantId == null || live?.claimantId === "").toBe(true);
  });

  it("retry / concurrent publish does not double-wake (stable opKey); confirmed settle only", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-handoff-idempotent";
    const auth = authority(cfg);
    await seedMappedMembership({
      cfg,
      groupId: GROUP_ID,
      memberIds: [CEO, EXECUTOR],
    });

    // Counting dispatcher with no epoch-bumping side effects → durable settle.
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
    expect(formalClaim.wakePendingVerification).toBe(false);
    expect(formalClaim.wakeDispatcherAccepted).toBe(true);
    expect(formalClaim.reason).toContain("wake_dispatched");
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
    expect(again.wakePendingVerification).toBe(false);
    expect(again.reason).toMatch(/idempotent_reuse|wake_dispatched/);
    expect(dispatchCalls).toBe(1);
  });
});
