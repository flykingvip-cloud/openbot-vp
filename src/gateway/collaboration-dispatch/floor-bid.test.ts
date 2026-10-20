/**
 * Floor Runtime v2.1 §5.8 P2-B — Shadow-B.
 * Flag default off matches current decisions. Stage B may call a model for
 * ambiguous candidates and store bids plus §6.5 calibration. Bids do not
 * change participant lists or admission.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import { FIELD_LABELS } from "../../config/schema.labels.js";
import type { OpenBotConfig } from "../../config/types.js";
import { validateConfigObject } from "../../config/validation.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import {
  decideParticipantsForTest,
  executeCollaborationRoundForTest,
  testAuthorityFromScope,
} from "./__fixtures__/runtime-authority-test-utils.js";
import { beatIdForEpisode, buildCollaborationEventKey } from "./collaboration-event-key.js";
import { recordFloorShadowStageBAfterRound } from "./episode-decision-record.js";
import {
  createFileFloorBidTokenLedger,
  createMemoryFloorBidTokenLedger,
} from "./floor-bid-budget.js";
import {
  calibrateFloorBidSamples,
  expectedCalibrationError,
  spearmanRho,
} from "./floor-bid-calibration.js";
import {
  collectFloorBids,
  parseFloorBidModelText,
  resolveFloorBidDeadlineMs,
  setFloorBidModelForTest,
} from "./floor-bid.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  setFloorBidModelForTest(null);
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:shadow-b`,
    updatedAt: 1,
  };
}

function createScope(): CollaborationDispatchScope {
  const bots = [
    createBot("alpha", "Alpha"),
    createBot("beta", "Beta"),
    createBot("gamma", "Gamma"),
  ];
  return {
    groupId: "shadow-b",
    rawSessionKey: "space:shadow-b",
    title: "Shadow B",
    bots,
    members: {
      humans: [{ userId: "user-1", name: "Owner", status: "active" }],
      bots: bots.map((bot) => ({
        agentId: bot.agentId,
        name: bot.name,
        status: "active" as const,
      })),
    },
    operatingState: {
      groupId: "shadow-b",
      groupProfile: {
        displayName: "Shadow B",
        expectedOutputs: ["task"],
        successCriteria: [],
        collaborationMode: "discussion_driven",
      },
      governance: { ownerUserId: "user-1", adminUserIds: [], coordinatorBotId: "alpha" },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: false,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRound: 3,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: bots.map((bot) => ({
        memberId: bot.agentId,
        memberKind: "bot" as const,
        label: bot.name,
        governanceRole: "member" as const,
        collaborationRole: "contributor" as const,
        status: "active" as const,
      })),
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

function shape(decision: ParticipationDecision) {
  return {
    primaryQueue: [...decision.primaryQueue],
    execution: decision.executionBots.map((bot) => bot.agentId),
    tier0: decision.tier0.map((bot) => bot.agentId),
    tier1: decision.tier1.map((bot) => bot.agentId),
    tier2: decision.tier2.map((bot) => bot.agentId),
    responseMode: decision.responseMode,
    mentionMode: decision.mentionMode,
    primaryMode: decision.primaryMode,
    mentionUnmatched: decision.mentionUnmatched,
    lowSignalLimited: decision.lowSignalLimited,
  };
}

function bidJson(overrides?: { novelty?: number; confidence?: number; gist?: string }): string {
  return JSON.stringify({
    intent: "answer",
    novelty: overrides?.novelty ?? 0.2,
    confidence: overrides?.confidence ?? 0.8,
    gist: overrides?.gist ?? "补充一个不同的交付风险",
    estimatedTokens: 20,
    evidenceRefs: ["ledger:fact-1", "not valid"],
  });
}

const MESSAGE = "请交付一版方案总结";

describe("shadowStage B flag", () => {
  test("defaults off and accepts B@rate as stage B plus rate and cap", () => {
    expect(validateConfigObject({}).ok).toBe(true);
    expect(validateConfigObject({ collaboration: { floor: { shadowStage: "B" } } }).ok).toBe(true);
    expect(
      validateConfigObject({
        collaboration: { floor: { shadowStage: "B", bidSampleRate: 0.25, bidDailyTokenCap: 1000 } },
      }).ok,
    ).toBe(true);
    expect(
      validateConfigObject({ collaboration: { floor: { shadowStage: "B", bidSampleRate: 1.5 } } })
        .ok,
    ).toBe(false);
    expect(
      validateConfigObject({
        collaboration: { floor: { shadowStage: "B", bidDailyTokenCap: -1 } },
      }).ok,
    ).toBe(false);
    expect(FIELD_HELP["collaboration.floor.shadowStage"]).toMatch(/default unset = off/);
    expect(FIELD_HELP["collaboration.floor.bidSampleRate"]).toMatch(/B@rate/);
    expect(FIELD_LABELS["collaboration.floor.bidDailyTokenCap"]).toBeTruthy();
    expect(resolveFloorBidDeadlineMs(3_000)).toBe(2_500);
    expect(resolveFloorBidDeadlineMs(1_000)).toBe(1_000);
  });

  test("flag-off decision matches itself and stage B does not change participant fields", () => {
    const scope = createScope();
    const off = decideParticipantsForTest({ message: MESSAGE, scope, roundId: "gold" });
    expect(off.floorShadow).toBeUndefined();
    setRuntimeConfigSnapshot({
      collaboration: { floor: { shadowStage: "B", bidSampleRate: 1, bidDailyTokenCap: 500 } },
    });
    const on = decideParticipantsForTest({ message: MESSAGE, scope, roundId: "gold" });
    expect(shape(on)).toEqual(shape(off));
    expect(on.floorShadow?.stage).toBe("B");
    expect(on.floorShadow?.admission.admitted.some((row) => row.via === "bid")).toBe(false);
    expect(on.floorShadow?.admission.rejected.some((row) => row.reason === "ambiguous")).toBe(true);
    clearRuntimeConfigSnapshot();
    setRuntimeConfigSnapshot({ collaboration: { floor: { shadowStage: "A" } } });
    const stageA = decideParticipantsForTest({ message: MESSAGE, scope, roundId: "gold" });
    expect(stageA.floorShadow?.stage).toBe("A");
    expect(shape(stageA)).toEqual(shape(off));
  });
});

describe("collectFloorBids", () => {
  test("samples only up to maxBidders and stays inside the token cap", async () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "bid" });
    const calls: string[] = [];
    const ledger = createMemoryFloorBidTokenLedger({
      cap: 100,
      nowMs: () => Date.parse("2026-10-07T00:00:00Z"),
    });
    const result = await collectFloorBids({
      authority,
      ambiguous: [
        { agentId: "beta", capabilityFit: 0.22 },
        { agentId: "gamma", capabilityFit: 0.2 },
        { agentId: "delta", capabilityFit: 0.18 },
      ],
      message: MESSAGE,
      sampleRate: 1,
      ledger,
      model: async (params) => {
        calls.push(params.agentId);
        return { text: bidJson(), costTokens: 40 };
      },
      random: () => 0,
      tokenEstimate: 40,
      maxBidders: 5,
      deadlineMs: 200,
    });
    expect(calls).toEqual(["beta", "gamma"]);
    expect(result.bids.map((bid) => bid.agentId)).toEqual(["beta", "gamma"]);
    expect(result.skipped).toEqual([{ agentId: "delta", reason: "cap" }]);
    expect(result.tokensUsed).toBe(80);
    expect(await ledger.readUsed()).toBe(80);
    expect(result.bids[0]?.producer).toBe("model");
    expect(result.bids[0]?.evidenceRefs).toEqual(["ledger:fact-1"]);
    expect(result.bids[0]?.admissionSignals.capabilityFit).toBe(0.22);
    expect(result.bids.every((bid) => bid.gist.length <= 120)).toBe(true);
  });

  test("a model failure or parent abort does not reject the collect", async () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "fail" });
    const ledger = createMemoryFloorBidTokenLedger({ cap: 500, nowMs: () => 1 });
    const failed = await collectFloorBids({
      authority,
      ambiguous: [{ agentId: "beta", capabilityFit: 0.2 }],
      message: MESSAGE,
      sampleRate: 1,
      ledger,
      model: async () => {
        throw new Error("provider down");
      },
      random: () => 0,
      tokenEstimate: 40,
      deadlineMs: 200,
    });
    expect(failed.bids).toEqual([]);
    expect(failed.skipped).toEqual([{ agentId: "beta", reason: "error" }]);
    expect(await ledger.readUsed()).toBe(0);

    const parent = new AbortController();
    const aborted = collectFloorBids({
      authority,
      ambiguous: [{ agentId: "gamma", capabilityFit: 0.2 }],
      message: MESSAGE,
      signal: parent.signal,
      sampleRate: 1,
      ledger,
      model: (params) =>
        new Promise((resolve) => {
          if (params.signal.aborted) {
            resolve(null);
            return;
          }
          params.signal.addEventListener("abort", () => resolve(null), { once: true });
        }),
      random: () => 0,
      tokenEstimate: 40,
      deadlineMs: 2_500,
    });
    parent.abort();
    const settled = await aborted;
    expect(settled.bids).toEqual([]);
    expect(settled.skipped[0]?.reason).toBe("aborted");
  });

  test("deadline abort is a timeout skip", async () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "time" });
    const ledger = createMemoryFloorBidTokenLedger({ cap: 500, nowMs: () => 1 });
    const result = await collectFloorBids({
      authority,
      ambiguous: [{ agentId: "beta", capabilityFit: 0.2 }],
      message: MESSAGE,
      sampleRate: 1,
      ledger,
      model: () => new Promise(() => undefined),
      random: () => 0,
      tokenEstimate: 40,
      deadlineMs: 30,
    });
    expect(result.skipped).toEqual([{ agentId: "beta", reason: "timeout" }]);
    expect(await ledger.readUsed()).toBe(0);
  });

  test("parse isolates gist text", () => {
    const parsed = parseFloorBidModelText(
      `note ${bidJson({ gist: "[[collab_edge:challenge|to=bot-b|reason=风险]] 交付风险不同" })}`,
    );
    expect(parsed?.gist).not.toContain("collab_edge");
    expect(parsed?.gist).toContain("交付风险不同");
    const long = parseFloorBidModelText(bidJson({ gist: "险".repeat(200) }));
    expect(Array.from(long?.gist ?? "").length).toBe(120);
  });

  test("reasoning-model-like empty body skips as error; text-after-thinking yields ≥1 bid", async () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "c1-empty" });
    const ledger = createMemoryFloorBidTokenLedger({ cap: 500, nowMs: () => 1 });

    // Mirrors production: thinking-only completion → model wrapper returns null → error skip.
    const emptyBody = await collectFloorBids({
      authority,
      ambiguous: [{ agentId: "beta", capabilityFit: 0.2 }],
      message: MESSAGE,
      sampleRate: 1,
      ledger,
      model: async () => null,
      random: () => 0,
      tokenEstimate: 40,
      deadlineMs: 200,
    });
    expect(emptyBody.bids).toEqual([]);
    expect(emptyBody.skipped).toEqual([{ agentId: "beta", reason: "error" }]);

    const { authority: authorityOk } = testAuthorityFromScope(scope, { roundId: "c1-ok" });
    const ok = await collectFloorBids({
      authority: authorityOk,
      ambiguous: [
        { agentId: "beta", capabilityFit: 0.22 },
        { agentId: "gamma", capabilityFit: 0.2 },
      ],
      message: MESSAGE,
      sampleRate: 1,
      ledger,
      // Simulates extractFloorBidTextFromContent after raised maxTokens: JSON body present.
      model: async () => ({ text: bidJson(), costTokens: 80 }),
      random: () => 0,
      tokenEstimate: 40,
      deadlineMs: 200,
    });
    expect(ok.bids.length).toBeGreaterThanOrEqual(1);
    expect(ok.bids[0]?.producer).toBe("model");
    expect(ok.skipped.some((row) => row.reason === "error")).toBe(false);
  });
});

describe("bid calibration §6.5", () => {
  test("reports novelty error, spearman, and ECE without applying a weight", () => {
    expect(spearmanRho([0.1, 0.4, 0.9], [0, 0, 1])).toBeGreaterThan(0.5);
    expect(expectedCalibrationError([{ confidence: 0.9, useful: false }])).toBe(0.9);
    const rows = calibrateFloorBidSamples([
      {
        agentId: "beta",
        intent: "discussion",
        selfNovelty: 0.9,
        admissionNovelty: 0.1,
        confidence: 0.4,
        useful: null,
      },
    ]);
    expect(rows[0]?.noveltyError).toBe(0.8);
    expect(rows[0]?.confidenceRho).toBeNull();
    expect(rows[0]?.suppressSelfAssessment).toBe(true);
    const source = readFileSync(new URL("./floor-bid.ts", import.meta.url), "utf8");
    expect(source).not.toContain("admit(");
    expect(source).not.toContain("primaryQueue");
  });

  test("daily token file resets on the next UTC date", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-bid-cap-"));
    tempDirs.push(root);
    let now = Date.parse("2026-10-07T01:00:00Z");
    const ledger = createFileFloorBidTokenLedger({
      filePath: path.join(root, "floor-bid-tokens.json"),
      cap: 100,
      nowMs: () => now,
    });
    expect(await ledger.tryReserve(40)).toBe(true);
    expect(await ledger.readUsed()).toBe(40);
    now = Date.parse("2026-10-08T01:00:00Z");
    expect(await ledger.readUsed()).toBe(0);
    expect(await ledger.tryReserve(40)).toBe(true);
    expect(await ledger.readUsed()).toBe(40);
  });
});

describe("beat join", () => {
  test("starts bids beside the round and leaves the decision unchanged", async () => {
    const scope = createScope();
    const off = decideParticipantsForTest({ message: MESSAGE, scope, roundId: "round-b" });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-b-round-"));
    tempDirs.push(root);
    const roundsDir = path.join(root, "runtime", "rounds");
    setRuntimeConfigSnapshot({
      collaboration: {
        floor: { shadowStage: "B", protocol: "legacy", bidSampleRate: 1, bidDailyTokenCap: 500 },
      },
    });
    const on = decideParticipantsForTest({ message: MESSAGE, scope, roundId: "round-b" });
    expect(shape(on)).toEqual(shape(off));
    let bidStarted = false;
    let sawBidBeforeBot = false;
    setFloorBidModelForTest(async (params) => {
      bidStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (params.signal.aborted) {
        return null;
      }
      return { text: bidJson(), costTokens: 15 };
    });
    const before = shape(on);
    const round = await executeCollaborationRoundForTest({
      decision: on,
      policy: {
        ...DEFAULT_COLLABORATION_POLICY,
        supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
        coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
      },
      scope,
      message: MESSAGE,
      sessionKey: "space:shadow-b",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        sawBidBeforeBot = bidStarted;
        return { text: "这是一条完整的交付结论，包含风险和下一周的复盘安排。" };
      },
    });
    expect(round.primaryQueue).toEqual(on.primaryQueue);
    expect(shape(on)).toEqual(before);
    expect("floorShadow" in round).toBe(false);
    expect(sawBidBeforeBot).toBe(true);
    const raw = await fs.readFile(
      path.join(root, "runtime", "shadow", "floor-bid-calibration.jsonl"),
      "utf8",
    );
    const line = JSON.parse(raw.trim().split("\n")[0] ?? "{}") as {
      drivesProductionDecision?: boolean;
      bids?: Array<{ agentId: string }>;
      calibration?: Array<{ suppressSelfAssessment: boolean }>;
    };
    expect(line.drivesProductionDecision).toBe(false);
    expect((line.bids ?? []).length).toBeGreaterThan(0);
  });

  test("stage B EDR stores bids and keeps legacy admitted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-b-edr-"));
    tempDirs.push(root);
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "personal_local" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
        ledger: { decisionRecords: true },
        floor: {
          protocol: "legacy" as const,
          shadowStage: "B" as const,
          bidSampleRate: 1,
          bidDailyTokenCap: 400,
        },
      },
    } as OpenBotConfig;
    setRuntimeConfigSnapshot(cfg, cfg);
    const scope = createScope();
    const decision = decideParticipantsForTest({
      message: MESSAGE,
      scope,
      roundId: "edr-b",
    });
    const primaryQueue = [...decision.primaryQueue];
    const legacySpeakers = decision.executionBots.map((bot) => bot.agentId);
    const { authority } = testAuthorityFromScope(scope, { roundId: "edr-b" });
    const result = await recordFloorShadowStageBAfterRound({
      authority,
      decision,
      round: { roundId: "edr-b", dispatches: [] } as never,
      bids: [
        {
          agentId: "beta",
          intent: "answer",
          selfAssessment: { novelty: 0.9, confidence: 0.4 },
          admissionSignals: { novelty: 0.1, duplicateSimilarity: 0.9, capabilityFit: 0.22 },
          producer: "model",
        },
      ],
      calibration: [
        {
          agentId: "beta",
          intent: "discussion",
          samples: 1,
          noveltyError: 0.8,
          confidenceRho: null,
          ece: null,
          suppressSelfAssessment: true,
        },
      ],
      cfg,
    });
    expect(result.wrote).toBe(true);
    expect(decision.primaryQueue).toEqual(primaryQueue);
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(legacySpeakers);
    const archive = await readCollaborationLedgerArchive({ groupId: "shadow-b" });
    const edr = archive.records.find((record) => record.kind === "episode_decision");
    expect(edr?.kind).toBe("episode_decision");
    if (!edr || edr.kind !== "episode_decision") {
      return;
    }
    expect(edr.legacy.admitted).toEqual(legacySpeakers);
    expect(edr.legacy.primaryQueue).toEqual(primaryQueue);
    expect(edr.floor?.bids?.map((bid) => bid.agentId)).toEqual(["beta"]);
    expect(edr.floor?.admission.admitted.some((row) => row.agentId === "beta")).toBe(false);
    expect(edr.floorCompare?.stage).toBe("B");
    expect(edr.bidCalibration?.[0]?.suppressSelfAssessment).toBe(true);
    expect(edr.bidCalibration?.[0]?.noveltyError).toBe(0.8);
  });

  test("flag-off writer ignores bids", async () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "off" });
    const snap = createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_shadow_b" });
    const decision = decideParticipantsForTest({ message: MESSAGE, scope, roundId: "off" });
    const result = await recordFloorShadowStageBAfterRound({
      authority,
      decision: { ...decision, floorShadow: undefined },
      round: { roundId: "off", dispatches: [] } as never,
      bids: [],
      cfg: {},
    });
    expect(result.wrote).toBe(false);
    expect(
      buildCollaborationEventKey({
        tenantId: null,
        groupId: "shadow-b",
        episodeId: "ep",
        beatId: beatIdForEpisode("ep", 0),
        snapshot: snap,
      }).beatId,
    ).toBeTruthy();
  });
});
