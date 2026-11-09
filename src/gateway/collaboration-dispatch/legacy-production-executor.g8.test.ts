/**
 * P0 G8 — Legacy Primary/Supplement stays the production collaboration executor.
 *
 * These checks fail if group chat stops calling `executeCollaborationRound`,
 * if a non-legacy executor id is accepted, or if default / unwired flags let
 * Floor or Episode choose participants.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, test } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  decideParticipantsForTest,
  executeCollaborationRoundForTest,
  testAuthorityFromScope,
} from "./__fixtures__/runtime-authority-test-utils.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { isCollabEpisodeStoreEnabled } from "./episode-store.js";
import { attachFloorShadow, computeFloorShadowA } from "./floor-shadow-plan.js";
import { isCollabFloorShadowEnabled } from "./floor-shadow.js";
import { toLegacyPolicyView } from "./legacy-policy-view.js";
import {
  assertLegacyProductionExecutor,
  FLOOR_DRIVES_PRODUCTION_DECISION,
  LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
  readCollaborationCutoverFlags,
  resolveProductionCollaborationExecutor,
} from "./legacy-production-executor.js";
import { resolveDispatchLanePolicyV1 } from "./policy-lane-dispatch.js";
import { resolvePolicyLaneMode, type PolicyLaneId } from "./policy-lane-divergence.js";
import { freezeCollaborationPolicy, hashCollaborationPolicy } from "./policy.js";
import { roundEventsPath } from "./round-store-io.js";
import { isCollabRuntimeNamespaceEnabled } from "./runtime-namespace.js";
import { isCollabFloorShadowStageA, isCollabFloorShadowStageB } from "./shadow-stage-flag.js";
import { isCollabTaskHandoffContractEnabled } from "./task-runtime.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

const tempDirs: string[] = [];
const LANES: readonly PolicyLaneId[] = [
  "context",
  "presentation",
  "participation",
  "dispatch",
  "governance",
];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function createBot(agentId: string, name: string, groupId: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:${groupId}`,
    updatedAt: 1,
  };
}

function cutoverOnConfig(): OpenBotConfig {
  return {
    collaboration: {
      floor: { protocol: "floor", shadowStage: "B" },
      episodeStore: true,
      runtimeNamespace: true,
      task: { handoffContract: true },
      lane: {
        context: "effective",
        presentation: "effective",
        participation: "effective",
        dispatch: "effective",
        governance: "effective",
      },
    },
  };
}

function observerScope(): CollaborationDispatchScope {
  const groupId = "g8-observer";
  const bots = [
    createBot("alpha", "Alpha", groupId),
    createBot("beta", "Beta", groupId),
    createBot("gamma", "Gamma", groupId),
  ];
  return {
    groupId,
    rawSessionKey: `space:${groupId}`,
    title: "G8",
    bots,
    blockedAgentIds: ["gamma"],
    members: {
      humans: [{ userId: "user-1", name: "Owner", status: "active" }],
      bots: bots.map((bot) => ({
        agentId: bot.agentId,
        name: bot.name,
        status: "active" as const,
      })),
    },
    operatingState: {
      groupId,
      groupProfile: {
        displayName: "G8",
        expectedOutputs: ["task"],
        successCriteria: [],
        collaborationMode: "discussion_driven",
      },
      governance: { ownerUserId: "user-1", adminUserIds: [], coordinatorBotId: "alpha" },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: true,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRound: 3,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [
        ...bots.map((bot) => ({
          memberId: bot.agentId,
          memberKind: "bot" as const,
          label: bot.name,
          governanceRole: "member" as const,
          collaborationRole: "contributor" as const,
          status: "active" as const,
        })),
        {
          memberId: "beta",
          memberKind: "bot" as const,
          label: "Beta",
          governanceRole: "observer" as const,
          collaborationRole: "contributor" as const,
          status: "active" as const,
        },
      ],
      activeContext: {
        currentOperatingPhase: "deliver",
        currentMission: "ship",
        waitingForHuman: false,
        summary: "test",
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    } as CollaborationDispatchScope["operatingState"],
  };
}

function roundDecision(roundId: string): ParticipationDecision {
  const botA = createBot("bot-a", "Bot A", "g8-round");
  const botB = createBot("bot-b", "Bot B", "g8-round");
  return {
    roundId,
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA, botB],
    tier2: [],
    executionBots: [botA, botB],
    roundPlan: {
      roundId,
      sessionKey: "space:g8-round",
      responseMode: "lead_plus_supplement",
      summaryText: "g8",
      participants: [
        {
          agentId: "bot-a",
          displayName: "Bot A",
          tier: "duty",
          contributionRole: "lead",
          reasonText: "lead",
        },
        {
          agentId: "bot-b",
          displayName: "Bot B",
          tier: "mention",
          contributionRole: "supplement",
          reasonText: "mention",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "single_primary",
    primaryQueue: ["bot-a"],
  };
}

describe("P0 G8 legacy primary production executor", () => {
  test("default flags stay off and explicit cutover flags do not select another executor", () => {
    const defaults = readCollaborationCutoverFlags({});
    expect(defaults).toEqual({
      floorProtocol: "unset",
      shadowStage: "unset",
      episodeStore: false,
      runtimeNamespace: false,
      handoffContract: false,
      dispatchLane: "unset",
      floorDrivesProductionDecision: false,
    });
    expect(FLOOR_DRIVES_PRODUCTION_DECISION).toBe(false);
    expect(resolveProductionCollaborationExecutor()).toBe(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR);
    expect(resolveProductionCollaborationExecutor({})).toBe(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR);
    expect(resolveProductionCollaborationExecutor(cutoverOnConfig())).toBe(
      LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
    );

    expect(isCollabFloorShadowEnabled({})).toBe(false);
    expect(isCollabFloorShadowEnabled({ collaboration: { floor: { protocol: "floor" } } })).toBe(
      false,
    );
    expect(isCollabFloorShadowStageA({})).toBe(false);
    expect(isCollabFloorShadowStageB({})).toBe(false);
    expect(isCollabEpisodeStoreEnabled({})).toBe(false);
    expect(isCollabRuntimeNamespaceEnabled({})).toBe(false);
    expect(isCollabTaskHandoffContractEnabled({})).toBe(false);
    for (const lane of LANES) {
      expect(resolvePolicyLaneMode(lane, {})).toBe("legacy");
    }

    const floorBid = readFileSync(new URL("./floor-bid.ts", import.meta.url), "utf8");
    expect(floorBid).toContain("drivesProductionDecision: false");
    expect(floorBid).not.toContain("drivesProductionDecision: true");
  });

  test("a non-legacy executor id is refused before any bot runs", async () => {
    expect(() => assertLegacyProductionExecutor(undefined)).not.toThrow();
    expect(() => assertLegacyProductionExecutor(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR)).not.toThrow();
    expect(() => assertLegacyProductionExecutor("floor")).toThrow(/P0 G8/);
    expect(() => assertLegacyProductionExecutor("episode")).toThrow(/legacy-primary-supplement/);

    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g8-refuse-"));
    tempDirs.push(roundsDir);
    const calls: string[] = [];
    await expect(
      executeCollaborationRoundForTest({
        scope: {
          groupId: "g8-round",
          rawSessionKey: "space:g8-round",
          title: "G8",
          bots: [createBot("bot-a", "Bot A", "g8-round")],
        },
        decision: roundDecision("g8-refuse"),
        message: "请分析这个方案并给出结论",
        sessionKey: "space:g8-round",
        roundsDir,
        productionExecutor: "floor",
        runBot: async () => {
          calls.push("ran");
          return { text: "结论：应当继续推进，并给出明确下一步。" };
        },
      }),
    ).rejects.toThrow(/P0 G8/);
    expect(calls).toEqual([]);
  });

  test("chat.ts dispatches the group round only through the legacy executor", () => {
    const chat = readFileSync(new URL("../server-methods/chat.ts", import.meta.url), "utf8");
    const calls = chat.match(/executeCollaborationRound\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const parsed = ts.createSourceFile("chat.ts", chat, ts.ScriptTarget.Latest, true);
    const executorOptions: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "executeCollaborationRound"
      ) {
        const options = node.arguments[2];
        if (options && ts.isObjectLiteralExpression(options)) {
          executorOptions.push(options.getText(parsed));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(executorOptions).toHaveLength(1);
    expect(executorOptions[0]).toContain(
      "productionExecutor: resolveProductionCollaborationExecutor(policySnapshotCfg)",
    );
    expect(chat).not.toContain("episode-store.js");
    expect(chat).not.toContain("episode-state-machine.js");
    expect(chat).not.toContain("floor-bid.js");
    expect(chat).not.toContain("transitionEpisodeState");
    expect(chat).not.toContain("recoverIncompleteEpisodes");
    expect(chat).not.toContain("collectFloorBids");
    expect(chat).not.toContain("startFloorBidShadow");
    expect(chat).not.toContain('protocol === "floor"');
  });

  test("round runtime keeps Floor bids behind the shadow stage and does not run Episode", () => {
    const source = readFileSync(new URL("./round-runtime.ts", import.meta.url), "utf8");
    expect(source).toContain("assertLegacyProductionExecutor(input.productionExecutor)");
    expect(source).not.toContain("episode-store");
    expect(source).not.toContain("transitionEpisodeState");
    expect(source).not.toMatch(/mode:\s*"effective"/);
    const gate = source.indexOf("if (stageB) {");
    expect(gate).toBeGreaterThan(-1);
    expect(source.slice(gate, gate + 500)).toContain("startFloorBidShadow(");
    const call = source.lastIndexOf("startFloorBidShadow(");
    expect(call).toBeGreaterThan(gate);
  });

  test("default flags and protocol=floor do not let Floor replace participants", () => {
    setRuntimeConfigSnapshot({});
    const scope = observerScope();
    const message = "@Alpha @Beta 请分析这个方案";
    const explicitMentions = ["Alpha", "Beta"];
    const decision = decideParticipantsForTest({
      message,
      scope,
      roundId: "g8-decide",
      explicitMentions,
    });
    expect(decision.floorShadow).toBeUndefined();
    const legacyIds = decision.executionBots.map((bot) => bot.agentId);
    expect(legacyIds).toContain("alpha");
    expect(legacyIds).toContain("beta");

    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "g8-decide" });
    expect(attachFloorShadow(authority, facts, { message, explicitMentions }, decision)).toBe(
      decision,
    );

    const floorIds = computeFloorShadowA(authority, facts, {
      message,
      explicitMentions,
    }).admission.admitted.map((row) => row.agentId);
    expect(floorIds).toContain("alpha");
    expect(floorIds).not.toContain("beta");
    expect(floorIds).not.toEqual(legacyIds);

    setRuntimeConfigSnapshot({
      collaboration: {
        floor: { protocol: "floor" },
        episodeStore: true,
        runtimeNamespace: true,
        task: { handoffContract: true },
      },
    });
    const protocolFloor = decideParticipantsForTest({
      message,
      scope,
      roundId: "g8-decide-floor",
      explicitMentions,
    });
    expect(protocolFloor.floorShadow).toBeUndefined();
    expect(protocolFloor.executionBots.map((bot) => bot.agentId)).toEqual(legacyIds);
    expect(protocolFloor.primaryQueue).toEqual(decision.primaryQueue);

    setRuntimeConfigSnapshot({
      collaboration: { floor: { shadowStage: "A", protocol: "legacy" } },
    });
    const attached = attachFloorShadow(authority, facts, { message, explicitMentions }, decision);
    expect(attached).not.toBe(decision);
    expect(attached.executionBots).toBe(decision.executionBots);
    expect(attached.primaryQueue).toBe(decision.primaryQueue);
    expect(attached.tier0).toBe(decision.tier0);
    expect(attached.tier1).toBe(decision.tier1);
    expect(attached.floorShadow?.admission.admitted.map((row) => row.agentId)).toEqual(floorIds);
    expect(attached.executionBots.map((bot) => bot.agentId)).toEqual(legacyIds);
  });

  test("a default-config round advances through PRIMARY and SUPPLEMENT via the legacy view", async () => {
    setRuntimeConfigSnapshot({});
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g8-round-"));
    tempDirs.push(roundsDir);
    const scope: CollaborationDispatchScope = {
      groupId: "g8-round",
      rawSessionKey: "space:g8-round",
      title: "G8 round",
      bots: [createBot("bot-a", "Bot A", "g8-round"), createBot("bot-b", "Bot B", "g8-round")],
    };
    const decision = roundDecision("g8-live");
    const { authority } = testAuthorityFromScope(scope, { roundId: decision.roundId });
    // authority.policy.effective is FrozenEffectivePolicy (DeepReadonly). Thaw a
    // mutable copy so it matches EffectiveCollaborationPolicy.systemInstructions: string[].
    const effective = structuredClone(authority.policy.effective) as EffectiveCollaborationPolicy;
    const view = toLegacyPolicyView(effective);
    const lane = resolveDispatchLanePolicyV1({
      effective,
      cfg: {},
    });
    expect(lane.mode).toBe("legacy");
    expect(lane.policy).toEqual(view);

    const roles: string[] = [];
    const round = await executeCollaborationRoundForTest({
      scope,
      decision,
      message: "请分析这个方案并给出结论",
      sessionKey: "space:g8-round",
      roundsDir,
      productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
      runBot: async ({ role }) => {
        roles.push(role);
        return { text: "结论：应当继续推进，并给出明确下一步。" };
      },
    });

    expect(roles).toEqual(["primary", "supplement"]);
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.dispatches.map((dispatch) => dispatch.role)).toEqual(["primary", "supplement"]);
    expect(round.policyHash).toBe(hashCollaborationPolicy(freezeCollaborationPolicy(view)));

    const events = (await fs.readFile(roundEventsPath(roundsDir, decision.roundId), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    const types = events.map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "PRIMARY_QUEUE_ENTERED",
        "PRIMARY_STARTED",
        "PRIMARY_COMPLETED",
        "SUPPLEMENT_WINDOW_OPENED",
        "SUPPLEMENT_DISPATCHED",
      ]),
    );
    expect(
      types.some(
        (type) =>
          type.startsWith("EPISODE_") || type === "BEAT_ACTIVE" || type === "FACILITATOR_OBSERVE",
      ),
    ).toBe(false);
    await expect(
      fs.access(path.join(path.dirname(roundsDir), "shadow", "floor-shadow.jsonl")),
    ).rejects.toThrow();
  });
});
