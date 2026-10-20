/**
 * P0 G1 — Floor is not the live orchestration path.
 *
 * Default config keeps the original decision and leaves the shadow sink off.
 * Shadow A/B may compare lists. Production speakers and visible replies stay
 * on G8. protocol=floor and any single collaboration boolean cannot sign the
 * cutover. This suite does not flip the default and does not rewrite speakers.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import type { OpenBotConfig } from "../../config/types.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import {
  decideParticipantsForTest,
  executeCollaborationRoundForTest,
  testAuthorityFromScope,
} from "./__fixtures__/runtime-authority-test-utils.js";
import { beatIdForEpisode, buildCollaborationEventKey } from "./collaboration-event-key.js";
import { resolveTimeoutTaskType } from "./completion-contract.js";
import {
  writeBeatDecisionRecords,
  type BeatDecisionWriteInput,
} from "./episode-decision-record.js";
import {
  assertBidDoesNotDriveProduction,
  assertFloorShadowDidNotReplaceSpeakers,
  FLOOR_LIVE_CUTOVER_DEFAULT,
  FloorLiveCutoverRefusedError,
  floorLiveProductionRefusal,
  guardFloorProductionSpeakers,
  LEGACY_PRODUCTION_SPEAKER_SOURCE,
  promoteFloorAdmittedToProductionSpeakers,
  type FloorLiveCutoverReceipt,
} from "./floor-live-cutover.js";
import { attachFloorShadow, compareLegacyFloorAdmission } from "./floor-shadow-plan.js";
import { FLOOR_SHADOW_FILE_NAME, isCollabFloorShadowEnabled } from "./floor-shadow.js";
import {
  LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
  resolveProductionCollaborationExecutor,
} from "./legacy-production-executor.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

const tempDirs: string[] = [];
const VISIBLE_REPLY = "G1可见回复来自G8执行器。";

const SIGNED_RECEIPT: FloorLiveCutoverReceipt = {
  confirmSingleBeatGate: true,
  namespaceN2Signed: true,
  singleBeatGateSigned: true,
  shadowCompareNonRewriting: true,
};

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

function observerScope(): CollaborationDispatchScope {
  const groupId = "g1-observer";
  const bots = [
    createBot("alpha", "Alpha", groupId),
    createBot("beta", "Beta", groupId),
    createBot("gamma", "Gamma", groupId),
  ];
  return {
    groupId,
    rawSessionKey: `space:${groupId}`,
    title: "G1",
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
        displayName: "G1",
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
  const botA = createBot("bot-a", "Bot A", "g1-round");
  const botB = createBot("bot-b", "Bot B", "g1-round");
  return {
    roundId,
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA, botB],
    tier2: [],
    executionBots: [botA, botB],
    roundPlan: {
      roundId,
      sessionKey: "space:g1-round",
      responseMode: "lead_plus_supplement",
      summaryText: "g1",
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

async function useLedgerConfig(params: {
  groupLabel: string;
  shadowStage: "A" | "B";
}): Promise<OpenBotConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `openbot-g1-${params.groupLabel}-`));
  tempDirs.push(root);
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      ledger: { decisionRecords: true },
      floor: { protocol: "legacy" as const, shadowStage: params.shadowStage },
    },
  } as OpenBotConfig;
  setRuntimeConfigSnapshot(cfg, cfg);
  return cfg;
}

function beatInput(params: {
  cfg: OpenBotConfig;
  groupId: string;
  shadow: ParticipationDecision["floorShadow"];
}): BeatDecisionWriteInput {
  const snap = createRoundPolicySnapshot({}, { now: 1, idGen: () => `pss_${params.groupId}` });
  const episodeId = `ep_${params.groupId}`;
  return {
    key: buildCollaborationEventKey({
      tenantId: null,
      groupId: params.groupId,
      episodeId,
      beatId: beatIdForEpisode(episodeId, 0),
      snapshot: snap,
    }),
    at: 5,
    protocol: "legacy",
    intent: "mention_only",
    provenanceHash: snap.provenanceHash,
    decideBranch: "legacy",
    legacy: {
      admitted: ["bot-a", "bot-b"],
      primaryQueue: ["bot-a"],
      dropped: [],
    },
    need: { agentIds: ["alpha"], source: "mention" },
    facilitator: [],
    outcome: {
      roundId: `round-${params.groupId}`,
      respondedAgentIds: ["bot-a", "bot-b"],
      usefulAgentIds: [],
      noReply: [],
      duplicates: [],
      timeouts: [],
      qualityClassifierVersion: "useful-v1",
    },
    roundId: `round-${params.groupId}`,
    mode: snap.effective.strategy.id,
    policyConstraints: snap.effective.clamps,
    participants: [
      { agentId: "bot-a", tier: "primary", reason: "lead" },
      { agentId: "bot-b", tier: "contributor", reason: "supplement" },
    ],
    provenance: snap.effective.provenance,
    floorShadow: params.shadow,
    cfg: params.cfg,
  };
}

describe("P0 G1 floor live cutover gate", () => {
  test("default config keeps the original decision and the shadow sink off", () => {
    expect(FLOOR_LIVE_CUTOVER_DEFAULT).toBe(false);
    setRuntimeConfigSnapshot({});
    expect(isCollabFloorShadowEnabled({})).toBe(false);
    expect(isCollabFloorShadowEnabled()).toBe(false);
    expect(resolveProductionCollaborationExecutor({})).toBe(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR);
    expect(guardFloorProductionSpeakers({})).toBe(LEGACY_PRODUCTION_SPEAKER_SOURCE);

    const scope = observerScope();
    const message = "@Alpha @Beta 请分析这个方案";
    const explicitMentions = ["Alpha", "Beta"];
    const decision = decideParticipantsForTest({
      message,
      scope,
      roundId: "g1-default",
      explicitMentions,
    });
    expect(decision.floorShadow).toBeUndefined();
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "g1-default" });
    expect(attachFloorShadow(authority, facts, { message, explicitMentions }, decision)).toBe(
      decision,
    );
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(
      expect.arrayContaining(["alpha", "beta"]),
    );
  });

  test("shadow A compares lists and the round still speaks from G8", async () => {
    const scope = observerScope();
    const message = "@Alpha @Beta 请分析这个方案";
    const explicitMentions = ["Alpha", "Beta"];
    setRuntimeConfigSnapshot({});
    const legacy = decideParticipantsForTest({
      message,
      scope,
      roundId: "g1-shadow-a",
      explicitMentions,
    });
    setRuntimeConfigSnapshot({
      collaboration: { floor: { protocol: "shadow", shadowStage: "A" } },
    });
    expect(isCollabFloorShadowEnabled()).toBe(true);
    const decision = decideParticipantsForTest({
      message,
      scope,
      roundId: "g1-shadow-a",
      explicitMentions,
    });
    expect(decision).not.toBe(legacy);
    expect(decision.floorShadow?.stage).toBe("A");
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(
      legacy.executionBots.map((bot) => bot.agentId),
    );
    expect(decision.primaryQueue).toEqual(legacy.primaryQueue);
    expect(decision.tier0.map((bot) => bot.agentId)).toEqual(
      legacy.tier0.map((bot) => bot.agentId),
    );
    expect(decision.tier1.map((bot) => bot.agentId)).toEqual(
      legacy.tier1.map((bot) => bot.agentId),
    );
    expect(decision.roundPlan.participants).toEqual(legacy.roundPlan.participants);
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "g1-shadow-a" });
    const sealed = attachFloorShadow(authority, facts, { message, explicitMentions }, decision);
    expect(sealed.executionBots).toBe(decision.executionBots);
    expect(sealed.primaryQueue).toBe(decision.primaryQueue);
    expect(sealed.roundPlan).toBe(decision.roundPlan);

    const floorIds = decision.floorShadow?.admission.admitted.map((row) => row.agentId) ?? [];
    const legacyIds = decision.executionBots.map((bot) => bot.agentId);
    expect(floorIds).toContain("alpha");
    expect(floorIds).not.toContain("beta");
    expect(legacyIds).toContain("beta");
    const compared = compareLegacyFloorAdmission({
      legacyAdmitted: legacyIds,
      floorAdmitted: floorIds,
      needAgentIds: ["alpha", "beta"],
      stage: "A",
    });
    expect(compared.onlyLegacy).toContain("beta");
    expect(compared.onlyFloor).not.toContain("beta");

    const roundRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g1-round-a-"));
    tempDirs.push(roundRoot);
    const roundsDir = path.join(roundRoot, "runtime", "rounds");
    await fs.mkdir(roundsDir, { recursive: true });
    const calls: Array<{ agentId: string; role: string; text: string }> = [];
    const round = await executeCollaborationRoundForTest({
      scope,
      decision,
      message,
      sessionKey: "space:g1-observer",
      roundsDir,
      productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
      runBot: async ({ bot, role }) => {
        const text = VISIBLE_REPLY;
        calls.push({ agentId: bot.agentId, role, text });
        return { text };
      },
    });
    expect(calls.map((call) => call.agentId).toSorted()).toEqual(legacyIds.toSorted());
    expect(calls.every((call) => call.text === VISIBLE_REPLY)).toBe(true);
    expect(calls.some((call) => call.agentId === "beta")).toBe(true);
    expect(calls.every((call) => legacyIds.includes(call.agentId))).toBe(true);
    expect(round.primaryQueue).toEqual(decision.primaryQueue);
    expect(round.dispatches.map((dispatch) => dispatch.agentId).toSorted()).toEqual(
      legacyIds.toSorted(),
    );
    expect(round.state).toBe("ROUND_COMPLETE");

    const shadowFile = path.join(roundRoot, "runtime", "shadow", FLOOR_SHADOW_FILE_NAME);
    const lines = (await fs.readFile(shadowFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { admittedAgentIds: string[]; protocol: string });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.protocol).toBe("shadow");
      expect(line.admittedAgentIds).toEqual(decision.primaryQueue);
    }
  });

  test("shadow B and protocol=floor still dispatch G8 speakers", async () => {
    const scope = observerScope();
    const message = "@Alpha @Beta 请分析这个方案";
    const explicitMentions = ["Alpha", "Beta"];
    setRuntimeConfigSnapshot({
      collaboration: { floor: { protocol: "floor", shadowStage: "B" } },
    });
    expect(isCollabFloorShadowEnabled()).toBe(false);
    const decision = decideParticipantsForTest({
      message,
      scope,
      roundId: "g1-shadow-b",
      explicitMentions,
    });
    expect(decision.floorShadow?.stage).toBe("B");
    const floorIds = decision.floorShadow?.admission.admitted.map((row) => row.agentId) ?? [];
    expect(floorIds).not.toContain("beta");
    expect(decision.executionBots.map((bot) => bot.agentId)).toContain("beta");
    expect(resolveProductionCollaborationExecutor()).toBe(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR);
    expect(guardFloorProductionSpeakers({ protocol: "floor", shadowStage: "B" })).toBe(
      LEGACY_PRODUCTION_SPEAKER_SOURCE,
    );

    const roundRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g1-round-b-"));
    tempDirs.push(roundRoot);
    const roundsDir = path.join(roundRoot, "runtime", "rounds");
    await fs.mkdir(roundsDir, { recursive: true });
    const replied: string[] = [];
    const round = await executeCollaborationRoundForTest({
      scope,
      decision,
      message,
      sessionKey: "space:g1-observer",
      roundsDir,
      productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
      runBot: async ({ bot }) => {
        replied.push(bot.agentId);
        return { text: VISIBLE_REPLY };
      },
    });
    expect(replied).toEqual(decision.executionBots.map((bot) => bot.agentId));
    expect(replied).toContain("beta");
    expect(round.primaryQueue).toEqual(decision.primaryQueue);
    await expect(
      fs.access(path.join(roundRoot, "runtime", "shadow", FLOOR_SHADOW_FILE_NAME)),
    ).rejects.toThrow();
  });

  test("stage A and B ledger jsonl compare lists without rewriting legacy admitted", async () => {
    const scope = observerScope();
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "g1-edr" });
    setRuntimeConfigSnapshot({ collaboration: { floor: { shadowStage: "A" } } });
    const attached = attachFloorShadow(
      authority,
      facts,
      { message: "@Alpha 你怎么看", explicitMentions: ["Alpha"] },
      roundDecision("g1-edr"),
    );
    expect(attached.floorShadow?.stage).toBe("A");

    const cfgA = await useLedgerConfig({ groupLabel: "edr-a", shadowStage: "A" });
    const wroteA = await writeBeatDecisionRecords(
      beatInput({
        cfg: cfgA,
        groupId: "g1-edr-a",
        shadow: attached.floorShadow,
      }),
    );
    expect(wroteA.wroteEpisodeDecision).toBe(true);
    const archiveA = await readCollaborationLedgerArchive({ groupId: "g1-edr-a" });
    const edrA = archiveA.records.find((record) => record.kind === "episode_decision");
    expect(edrA?.kind).toBe("episode_decision");
    if (edrA && edrA.kind === "episode_decision") {
      expect(edrA.protocol).toBe("legacy");
      expect(edrA.legacy.admitted).toEqual(["bot-a", "bot-b"]);
      expect(edrA.floorCompare?.stage).toBe("A");
      expect(edrA.floorCompare?.legacyAdmitted).toEqual(["bot-a", "bot-b"]);
      expect(edrA.floorCompare?.floorAdmitted).toEqual(
        attached.floorShadow?.admission.admitted.map((row) => row.agentId),
      );
      expect(edrA.legacy.admitted).not.toEqual(edrA.floorCompare?.floorAdmitted);
    }

    const cfgB = await useLedgerConfig({ groupLabel: "edr-b", shadowStage: "B" });
    const shadowB = attached.floorShadow
      ? { ...attached.floorShadow, stage: "B" as const }
      : undefined;
    const wroteB = await writeBeatDecisionRecords(
      beatInput({ cfg: cfgB, groupId: "g1-edr-b", shadow: shadowB }),
    );
    expect(wroteB.wroteEpisodeDecision).toBe(true);
    const archiveB = await readCollaborationLedgerArchive({ groupId: "g1-edr-b" });
    const edrB = archiveB.records.find((record) => record.kind === "episode_decision");
    if (edrB && edrB.kind === "episode_decision") {
      expect(edrB.protocol).toBe("legacy");
      expect(edrB.legacy.admitted).toEqual(["bot-a", "bot-b"]);
      expect(edrB.floorCompare?.stage).toBe("B");
      expect(edrB.floorCompare?.legacyAdmitted).not.toEqual(edrB.floorCompare?.floorAdmitted);
    }
  });

  test("the cutover gate refuses production Floor without a signed receipt", () => {
    expect(floorLiveProductionRefusal(null)).toMatch(/cutover default is off/);
    expect(floorLiveProductionRefusal(null)).toMatch(/unsigned/);
    expect(floorLiveProductionRefusal({ protocol: "floor" })).toMatch(
      /casual flags ignored: protocol=floor/,
    );
    expect(floorLiveProductionRefusal({ shadowStage: "A" })).toMatch(/shadowStage=A/);
    expect(floorLiveProductionRefusal({ episodeStore: true })).toMatch(/episodeStore/);
    expect(floorLiveProductionRefusal({ runtimeNamespace: true })).toMatch(/runtimeNamespace/);
    expect(floorLiveProductionRefusal({ handoffContract: true })).toMatch(/handoffContract/);
    expect(floorLiveProductionRefusal({ drivesProductionDecision: true })).toMatch(
      /drivesProductionDecision/,
    );
    expect(floorLiveProductionRefusal({ receipt: { confirmSingleBeatGate: true } })).toMatch(
      /unsigned namespaceN2Signed/,
    );
    expect(
      floorLiveProductionRefusal({
        protocol: "floor",
        shadowStage: "B",
        episodeStore: true,
        runtimeNamespace: true,
        handoffContract: true,
        drivesProductionDecision: true,
        receipt: SIGNED_RECEIPT,
      }),
    ).toMatch(/cutover default is off/);

    expect(() =>
      promoteFloorAdmittedToProductionSpeakers({
        legacySpeakers: ["bot-a", "bot-b"],
        floorAdmittedAgentIds: ["alpha"],
        protocol: "floor",
      }),
    ).toThrow(FloorLiveCutoverRefusedError);
    expect(() =>
      promoteFloorAdmittedToProductionSpeakers({
        legacySpeakers: ["bot-a", "bot-b"],
        floorAdmittedAgentIds: ["alpha"],
        receipt: SIGNED_RECEIPT,
      }),
    ).toThrow(/cutover default is off/);
    expect(() => guardFloorProductionSpeakers({ drivesProductionDecision: true })).toThrow(
      FloorLiveCutoverRefusedError,
    );
    expect(() => assertBidDoesNotDriveProduction(true)).toThrow(FloorLiveCutoverRefusedError);
    expect(() => assertBidDoesNotDriveProduction(false)).not.toThrow();

    const legacy = roundDecision("g1-seal");
    expect(assertFloorShadowDidNotReplaceSpeakers(legacy, legacy)).toBe(legacy);
    expect(
      assertFloorShadowDidNotReplaceSpeakers(legacy, { ...legacy, floorShadow: undefined }),
    ).toEqual(legacy);
    expect(() =>
      assertFloorShadowDidNotReplaceSpeakers(legacy, {
        ...legacy,
        primaryQueue: ["alpha"],
      }),
    ).toThrow(FloorLiveCutoverRefusedError);

    expect(FIELD_HELP["collaboration.floor.protocol"]).toMatch(/default unset = legacy/);
    expect(FIELD_HELP["collaboration.floor.protocol"]).toMatch(/is not wired/);
    expect(FIELD_HELP["collaboration.floor.protocol"]).toMatch(
      /protocol is still not floor|is not floor/i,
    );
  });

  test("source locks keep Floor unwired and the checklist does not call it live", () => {
    const cutover = readFileSync(new URL("./floor-live-cutover.ts", import.meta.url), "utf8");
    const floorBid = readFileSync(new URL("./floor-bid.ts", import.meta.url), "utf8");
    const chat = readFileSync(new URL("../server-methods/chat.ts", import.meta.url), "utf8");
    const decision = readFileSync(new URL("./decision-engine.ts", import.meta.url), "utf8");
    const roundRuntime = readFileSync(new URL("./round-runtime.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../../config/zod-schema.ts", import.meta.url), "utf8");
    const plan = readFileSync(new URL("./floor-shadow-plan.ts", import.meta.url), "utf8");
    const checklist = readFileSync(
      new URL(
        "../../../docs/design/collaboration-runtime-alignment/P0-主路径收敛清单.md",
        import.meta.url,
      ),
      "utf8",
    );
    const g1 = checklist.slice(checklist.indexOf("## G1"));

    expect(cutover).toContain("FLOOR_LIVE_CUTOVER_DEFAULT = false");
    expect(cutover).not.toContain("FLOOR_LIVE_CUTOVER_DEFAULT = true");
    expect(cutover).not.toContain('protocol: "floor"');
    expect(floorBid).toContain("drivesProductionDecision: false");
    expect(floorBid).not.toContain("drivesProductionDecision: true");
    expect(chat.match(/executeCollaborationRound\(/g)).toHaveLength(1);
    expect(chat).not.toContain('protocol === "floor"');
    expect(chat).not.toContain("promoteFloorAdmittedToProductionSpeakers");
    expect(decision).toContain("attachFloorShadow");
    expect(decision).not.toContain("promoteFloorAdmittedToProductionSpeakers");
    expect(roundRuntime).toContain("guardFloorProductionSpeakers");
    expect(roundRuntime).toContain("assertBidDoesNotDriveProduction");
    expect(roundRuntime).not.toMatch(/primaryQueue\s*=\s*[^\n;]*floorShadow/);
    expect(roundRuntime).not.toMatch(/executionBots\s*=\s*[^\n;]*admission/);
    expect(plan).toContain("assertFloorShadowDidNotReplaceSpeakers");
    expect(schema).toContain('protocol: z.enum(["legacy", "shadow", "floor"]).optional()');
    expect(schema).not.toContain(
      'protocol: z.enum(["legacy", "shadow", "floor"]).default("floor")',
    );
    expect(g1).toMatch(/尚未成为 live/);
    expect(g1).toMatch(/仍不是 `floor`/);
    expect(g1).toMatch(/本项保持开放/);
    expect(g1).toContain("FLOOR_LIVE_CUTOVER_DEFAULT");
  });
});

describe("chitchat soft-timeout visible delivery", () => {
  function chitchatPolicy() {
    return {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
      fallback: {
        ...DEFAULT_COLLABORATION_POLICY.fallback,
        timeoutPolicy: {
          ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy,
          byTaskType: {
            ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType,
            chitchat: 50,
          },
        },
      },
    };
  }

  function chitchatScope(): CollaborationDispatchScope {
    return {
      groupId: "g1-round",
      rawSessionKey: "space:g1-round",
      title: "G1",
      bots: [createBot("bot-a", "Bot A", "g1-round"), createBot("bot-b", "Bot B", "g1-round")],
    };
  }

  test("late greeting after the chitchat budget stays visibleReply true", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g1-chitchat-late-"));
    tempDirs.push(roundsDir);
    const calls: string[] = [];
    let deadlineFired = false;
    const round = await executeCollaborationRoundForTest({
      decision: roundDecision("round-chitchat-timeout"),
      policy: chitchatPolicy(),
      scope: chitchatScope(),
      message: "你好",
      sessionKey: "space:g1-round",
      roundsDir,
      isAborted: () => false,
      onPrimaryDeadline: () => {
        deadlineFired = true;
      },
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        // Past the 5s chitchat floor so soft-timeout wins, then the body lands.
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        return { text: "你好，我在。" };
      },
    });
    expect(deadlineFired).toBe(true);
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.abortReason).toBeUndefined();
    expect(calls).toEqual(["round-chitchat-timeout:primary:bot-a"]);
    expect(round.completion).toMatchObject({
      responseStatus: "complete",
      visibleReply: true,
    });
    const events = await fs.readFile(
      path.join(roundsDir, "round-chitchat-timeout.events.jsonl"),
      "utf8",
    );
    expect(events).toContain('"lateVisibleReply":true');
    expect(events).toContain('"visibleReply":true');
    expect(events).not.toContain("SUPPLEMENT_DISPATCHED");
  }, 20_000);

  test("chitchat soft-timeout with an empty body stays visibleReply false", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g1-chitchat-empty-"));
    tempDirs.push(roundsDir);
    const round = await executeCollaborationRoundForTest({
      decision: roundDecision("round-chitchat-empty"),
      policy: chitchatPolicy(),
      scope: chitchatScope(),
      message: "你好",
      sessionKey: "space:g1-round",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        return { text: "" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.abortReason).toBeUndefined();
    expect(round.completion?.visibleReply).toBe(false);
    const events = await fs.readFile(
      path.join(roundsDir, "round-chitchat-empty.events.jsonl"),
      "utf8",
    );
    expect(events).not.toContain("lateVisibleReply");
  }, 20_000);
});

describe("hard primary timeout delivers a late visible body", () => {
  const LATE_BODY = "当前正在整理本周任务清单，完成后同步。";

  function genericScope(): CollaborationDispatchScope {
    return {
      groupId: "g1-round",
      rawSessionKey: "space:g1-round",
      title: "G1",
      bots: [createBot("bot-a", "Bot A", "g1-round"), createBot("bot-b", "Bot B", "g1-round")],
    };
  }

  function shortBudget(taskType: "analysis" | "knowledge") {
    return {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
      fallback: {
        ...DEFAULT_COLLABORATION_POLICY.fallback,
        allowSecondaryTakeover: true,
        timeoutPolicy: {
          ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy,
          byTaskType: {
            ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType,
            [taskType]: 50,
          },
        },
      },
    };
  }

  function decisionFor(
    roundId: string,
    responseMode: ParticipationDecision["responseMode"],
    withSecondary: boolean,
  ): ParticipationDecision {
    const decision = roundDecision(roundId);
    const lead = decision.executionBots[0];
    if (!lead) {
      throw new Error("missing lead bot");
    }
    return {
      ...decision,
      responseMode,
      executionBots: withSecondary ? decision.executionBots : [lead],
      roundPlan: {
        ...decision.roundPlan,
        responseMode,
        participants: withSecondary
          ? decision.roundPlan.participants
          : decision.roundPlan.participants.filter(
              (participant) => participant.agentId === lead.agentId,
            ),
      },
    };
  }

  test.each([
    {
      taskType: "analysis" as const,
      responseMode: "lead_plus_supplement" as const,
      message: "当前你们在执行什么任务？",
      inboundDepth: undefined,
    },
    {
      taskType: "knowledge" as const,
      responseMode: "single_owner" as const,
      message: "请说明当前进展",
      inboundDepth: "retrieve" as const,
    },
  ])(
    "$taskType late body after the budget stays visibleReply true and skips abort",
    async (fixture) => {
      expect(
        resolveTimeoutTaskType({
          responseMode: fixture.responseMode,
          inboundDepth: fixture.inboundDepth,
          message: fixture.message,
        }),
      ).toBe(fixture.taskType);
      const roundsDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `openbot-g1-late-${fixture.taskType}-`),
      );
      tempDirs.push(roundsDir);
      const calls: string[] = [];
      let deadlineFired = false;
      const round = await executeCollaborationRoundForTest({
        decision: decisionFor(`round-late-${fixture.taskType}`, fixture.responseMode, true),
        policy: shortBudget(fixture.taskType),
        scope: genericScope(),
        message: fixture.message,
        sessionKey: "space:g1-round",
        roundsDir,
        inboundDepth: fixture.inboundDepth,
        isAborted: () => false,
        onPrimaryDeadline: () => {
          deadlineFired = true;
        },
        runBot: async ({ dispatchId, role }) => {
          calls.push(`${role}:${dispatchId}`);
          if (role === "primary") {
            // Past the 5s task-type floor so the hard deadline wins, then the body lands.
            await new Promise((resolve) => setTimeout(resolve, 6_000));
            return { text: LATE_BODY };
          }
          return { text: "结论：候补接管。" };
        },
      });
      expect(deadlineFired).toBe(true);
      expect(round.state).toBe("ROUND_COMPLETE");
      expect(round.abortReason).toBeUndefined();
      expect(calls).toEqual([`primary:round-late-${fixture.taskType}:primary:bot-a`]);
      expect(round.completion).toMatchObject({
        responseStatus: "complete",
        visibleReply: true,
      });
      const events = await fs.readFile(
        path.join(roundsDir, `round-late-${fixture.taskType}.events.jsonl`),
        "utf8",
      );
      expect(events).toContain(`"taskType":"${fixture.taskType}"`);
      expect(events).toContain('"lateVisibleReply":true');
      expect(events).toContain('"visibleReply":true');
      expect(events).toContain('"softComplete":true');
      expect(events).not.toContain("PRIMARY_TIMEOUT");
      expect(events).not.toContain("FALLBACK_STARTED");
      expect(events).not.toContain("ROUND_ABORTED");
      expect(events).not.toContain("SUPPLEMENT_DISPATCHED");
    },
    20_000,
  );

  test("analysis hard timeout with an empty body stays visibleReply false and aborts", async () => {
    const message = "当前你们在执行什么任务？";
    expect(
      resolveTimeoutTaskType({
        responseMode: "lead_plus_supplement",
        message,
      }),
    ).toBe("analysis");
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g1-late-empty-"));
    tempDirs.push(roundsDir);
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: decisionFor("round-late-empty", "lead_plus_supplement", false),
      policy: shortBudget("analysis"),
      scope: genericScope(),
      message,
      sessionKey: "space:g1-round",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId, role }) => {
        calls.push(`${role}:${dispatchId}`);
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        return { text: "" };
      },
    });
    expect(round.state).toBe("ROUND_ABORTED");
    expect(round.abortReason).toBe("fatal");
    expect(calls).toEqual(["primary:round-late-empty:primary:bot-a"]);
    expect(round.completion?.visibleReply).toBe(false);
    const events = await fs.readFile(path.join(roundsDir, "round-late-empty.events.jsonl"), "utf8");
    expect(events).toContain("PRIMARY_TIMEOUT");
    expect(events).toContain("ROUND_ABORTED");
    expect(events).not.toContain("lateVisibleReply");
    expect(events).not.toContain('"visibleReply":true');
  }, 20_000);
});
