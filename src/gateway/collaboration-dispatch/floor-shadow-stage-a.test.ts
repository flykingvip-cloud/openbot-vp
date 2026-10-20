/**
 * Floor Runtime v2.1 §5.8 P2-A — Shadow-A.
 * Flag default off leaves decision bytes alone. Stage A attaches floorShadow
 * and can compare it onto an EDR without changing participant lists.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import { FIELD_LABELS } from "../../config/schema.labels.js";
import type { OpenBotConfig } from "../../config/types.js";
import { validateConfigObject } from "../../config/validation.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import {
  decideParticipantsForTest,
  testAuthorityFromScope,
} from "./__fixtures__/runtime-authority-test-utils.js";
import { admit } from "./admission.js";
import { beatIdForEpisode, buildCollaborationEventKey } from "./collaboration-event-key.js";
import {
  legacyAdmittedSpeakersFromDecision,
  recordFloorShadowStageAAfterRound,
  writeBeatDecisionRecords,
  type BeatDecisionWriteInput,
} from "./episode-decision-record.js";
import { computeFloorShadowA } from "./floor-shadow-plan.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import type { L0Route } from "./router-l0.js";
import { routeL0 } from "./router-l0.js";
import type { L1Route } from "./router-l1.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:shadow-a`,
    updatedAt: 1,
  };
}

function createScope(params?: {
  bots?: CollaborationBotTarget[];
  blockedAgentIds?: string[];
  observers?: Array<{ agentId: string; name: string }>;
  maxVisible?: number;
}): CollaborationDispatchScope {
  const bots = params?.bots ?? [
    createBot("alpha", "Alpha"),
    createBot("beta", "Beta"),
    createBot("gamma", "Gamma"),
  ];
  const observers = params?.observers ?? [];
  return {
    groupId: "shadow-a",
    rawSessionKey: "space:shadow-a",
    title: "Shadow A",
    bots,
    ...(params?.blockedAgentIds ? { blockedAgentIds: params.blockedAgentIds } : {}),
    members: {
      humans: [{ userId: "user-1", name: "Owner", status: "active" }],
      bots: bots.map((bot) => ({
        agentId: bot.agentId,
        name: bot.name,
        status: "active" as const,
      })),
    },
    operatingState: {
      groupId: "shadow-a",
      groupProfile: {
        displayName: "Shadow A",
        expectedOutputs: ["task"],
        successCriteria: [],
        collaborationMode: "discussion_driven",
      },
      governance: {
        ownerUserId: "user-1",
        adminUserIds: [],
        coordinatorBotId: "alpha",
      },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: false,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRound: params?.maxVisible ?? 3,
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
        ...observers.map((observer) => ({
          memberId: observer.agentId,
          memberKind: "bot" as const,
          label: observer.name,
          governanceRole: "observer" as const,
          collaborationRole: "contributor" as const,
          status: "active" as const,
        })),
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

function admittedIds(
  scope: CollaborationDispatchScope,
  message: string,
  explicitMentions?: string[],
) {
  const { authority, facts } = testAuthorityFromScope(scope, { roundId: "shadow-round" });
  const shadow = computeFloorShadowA(authority, facts, {
    message,
    ...(explicitMentions ? { explicitMentions } : {}),
  });
  return shadow.admission.admitted.map((row) => row.agentId);
}

describe("L0 shadow fixtures", () => {
  test("@ mentions are admitted and observers and blocked agents are excluded", () => {
    const scope = createScope({
      blockedAgentIds: ["gamma"],
      observers: [{ agentId: "beta", name: "Beta" }],
    });
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "l0" });
    const l0 = routeL0(authority, facts, {
      message: "@Alpha 你怎么看",
      explicitMentions: ["Alpha"],
    });
    expect(l0.mustAdmit.map((row) => row.agentId)).toContain("alpha");
    expect(l0.excluded).toEqual(
      expect.arrayContaining([
        { agentId: "beta", reason: "observer" },
        { agentId: "gamma", reason: "blocked" },
      ]),
    );
    const admitted = admittedIds(scope, "@Alpha 你怎么看", ["Alpha"]);
    expect(admitted).toContain("alpha");
    expect(admitted).not.toContain("beta");
    expect(admitted).not.toContain("gamma");
  });

  test("an explicit @ still admits a blocked non-observer", () => {
    const scope = createScope({ blockedAgentIds: ["gamma"] });
    const admitted = admittedIds(scope, "@Gamma 你在吗", ["Gamma"]);
    expect(admitted).toContain("gamma");
  });

  test("an @ observer stays excluded", () => {
    const scope = createScope({ observers: [{ agentId: "beta", name: "Beta" }] });
    const admitted = admittedIds(scope, "@Beta 你在吗", ["Beta"]);
    expect(admitted).not.toContain("beta");
  });

  test("roll-call admits every eligible member and drops observer and blocked", () => {
    const scope = createScope({
      blockedAgentIds: ["gamma"],
      observers: [{ agentId: "beta", name: "Beta" }],
    });
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "roll" });
    const shadow = computeFloorShadowA(authority, facts, { message: "点名" });
    expect(shadow.l0.rollCall).toBe(true);
    expect(shadow.l1.clear).toEqual([]);
    expect(shadow.l1.ambiguous).toEqual([]);
    const admitted = shadow.admission.admitted.map((row) => row.agentId);
    expect(admitted).toEqual(["alpha"]);
    expect(admitted).not.toContain("beta");
    expect(admitted).not.toContain("gamma");
    expect(shadow.admission.admitted.length).toBeLessThanOrEqual(12);
    expect(shadow.admission.fuseTripped).toBe(false);
  });

  test("roll-call admission stays within the fuse of 12", () => {
    const bots = Array.from({ length: 13 }, (_, index) =>
      createBot(`bot-${index}`, `Bot ${index}`),
    );
    const scope = createScope({ bots, maxVisible: 5 });
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "fuse" });
    const shadow = computeFloorShadowA(authority, facts, { message: "点名" });
    expect(shadow.admission.admitted).toHaveLength(12);
    expect(shadow.admission.fuseTripped).toBe(true);
    expect(shadow.admission.rejected.some((row) => row.reason === "fuse")).toBe(true);
  });
});

describe("Admission signals", () => {
  test("selfAssessment cannot push a candidate over the novelty gate", () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "admit" });
    const l0: L0Route = {
      intent: "discussion",
      rollCall: false,
      mustAdmit: [],
      pool: ["alpha", "gamma"],
      excluded: [],
    };
    const l1: L1Route = {
      clear: [
        { agentId: "alpha", capabilityFit: 0.9, band: "clear" },
        { agentId: "gamma", capabilityFit: 0.8, band: "clear" },
      ],
      ambiguous: [{ agentId: "beta", capabilityFit: 0.2, band: "ambiguous" }],
      below: [],
    };
    const result = admit(authority, l0, l1, [
      {
        agentId: "alpha",
        selfAssessment: { novelty: 1, confidence: 1 },
        admissionSignals: { novelty: 0.1, duplicateSimilarity: 0, capabilityFit: 0.9 },
      },
      {
        agentId: "gamma",
        selfAssessment: { novelty: 0, confidence: 0 },
        admissionSignals: { novelty: 0.9, duplicateSimilarity: 0.1, capabilityFit: 0.8 },
      },
    ]);
    const admitted = result.admitted.map((row) => row.agentId);
    expect(admitted).not.toContain("alpha");
    expect(admitted).toContain("gamma");
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        { agentId: "alpha", reason: "novelty" },
        { agentId: "beta", reason: "ambiguous" },
      ]),
    );
  });
});

describe("shadowStage flag", () => {
  test("defaults off, accepts A, and rejects an unknown stage", () => {
    expect(validateConfigObject({}).ok).toBe(true);
    expect(validateConfigObject({ collaboration: { floor: { shadowStage: "A" } } }).ok).toBe(true);
    expect(validateConfigObject({ collaboration: { floor: { shadowStage: "C" } } }).ok).toBe(false);
    expect(FIELD_HELP["collaboration.floor.shadowStage"]).toMatch(/default unset = off/);
    expect(FIELD_LABELS["collaboration.floor.shadowStage"]).toBeTruthy();
  });

  test("flag-off decision has no floorShadow and flag-on keeps participant lists", () => {
    const scope = createScope();
    const message = "@Alpha 你怎么看";
    const off = decideParticipantsForTest({
      message,
      scope,
      roundId: "gold-round",
      explicitMentions: ["Alpha"],
    });
    expect(off.floorShadow).toBeUndefined();
    setRuntimeConfigSnapshot({
      collaboration: { floor: { shadowStage: "A", protocol: "legacy" } },
    });
    const on = decideParticipantsForTest({
      message,
      scope,
      roundId: "gold-round",
      explicitMentions: ["Alpha"],
    });
    expect(on.floorShadow?.stage).toBe("A");
    expect(on.floorShadow?.admission.admitted.map((row) => row.agentId)).toContain("alpha");
    expect(on.primaryQueue).toEqual(off.primaryQueue);
    expect(on.executionBots.map((bot) => bot.agentId)).toEqual(
      off.executionBots.map((bot) => bot.agentId),
    );
    expect(on.responseMode).toBe(off.responseMode);
    expect(on.mentionMode).toBe(off.mentionMode);
    expect(on.primaryMode).toBe(off.primaryMode);
  });

  test("Shadow-A compute stays within the 20ms p95 budget", () => {
    const bots = Array.from({ length: 8 }, (_, index) => createBot(`bot-${index}`, `Bot ${index}`));
    const scope = createScope({ bots });
    const { authority, facts } = testAuthorityFromScope(scope, { roundId: "perf" });
    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const started = performance.now();
      computeFloorShadowA(authority, facts, { message: "请分析一下这个方案" });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
    expect(p95).toBeLessThanOrEqual(20);
  });
});

describe("EDR floor compare", () => {
  test("stage A after-round compare is not gated on protocol shadow", () => {
    const source = readFileSync(new URL("./round-runtime.ts", import.meta.url), "utf8");
    const finish = source.slice(source.indexOf("const finishShadow"));
    const protocolGate = finish.indexOf("if (floorShadowOn)");
    const stageA = finish.indexOf("recordFloorShadowStageAAfterRound");
    expect(protocolGate).toBeGreaterThan(-1);
    expect(stageA).toBeGreaterThan(protocolGate);
    const gateBlock = finish.slice(protocolGate, stageA);
    expect(gateBlock).toContain("observeFloorShadowAfterRound");
    expect(gateBlock).not.toContain("return settled");
  });

  test("flag-off writer ignores floorShadow", async () => {
    const { cfg } = await useConfig({ decisionRecords: true, shadowStage: undefined });
    const input = beatInput(cfg);
    input.floorShadow = computeSampleShadow();
    const result = await writeBeatDecisionRecords(input);
    expect(result.wroteEpisodeDecision).toBe(true);
    const archive = await readCollaborationLedgerArchive({ groupId: "grp-shadow-a-off" });
    const edr = archive.records.find((record) => record.kind === "episode_decision");
    expect(edr && "floorCompare" in edr).toBe(false);
  });

  test("stage A writes legacy-vs-floor compare and does not change legacy admitted", async () => {
    const { cfg } = await useConfig({ decisionRecords: true, shadowStage: "A" });
    const shadow = computeSampleShadow();
    const input = beatInput(cfg);
    input.floorShadow = shadow;
    const result = await writeBeatDecisionRecords(input);
    expect(result.wroteEpisodeDecision).toBe(true);
    const archive = await readCollaborationLedgerArchive({ groupId: "grp-shadow-a-on" });
    const edr = archive.records.find((record) => record.kind === "episode_decision");
    expect(edr?.kind).toBe("episode_decision");
    if (!edr || edr.kind !== "episode_decision") {
      return;
    }
    expect(edr.legacy.admitted).toEqual(["bot-a"]);
    expect(edr.floorCompare?.stage).toBe("A");
    expect(edr.floorCompare?.floorAdmitted).toEqual(["alpha"]);
    expect(edr.floorCompare?.onlyLegacy).toEqual(["bot-a"]);
    expect(edr.floorCompare?.onlyFloor).toEqual(["alpha"]);
    expect(edr.floor?.admission.admitted.map((row) => row.agentId)).toEqual(["alpha"]);
    expect(edr.protocol).toBe("legacy");
  });

  test("stage A without decision records does not write", async () => {
    const scope = createScope();
    const { authority } = testAuthorityFromScope(scope, { roundId: "noop" });
    const { cfg } = await useConfig({ decisionRecords: false, shadowStage: "A" });
    const decision = decideParticipantsForTest({
      message: "@Alpha 看看",
      scope,
      roundId: "noop",
      explicitMentions: ["Alpha"],
    });
    const result = await recordFloorShadowStageAAfterRound({
      authority,
      decision: { ...decision, floorShadow: computeSampleShadow() },
      round: { roundId: "noop", dispatches: [] } as never,
      cfg,
    });
    expect(result.wrote).toBe(false);
  });
});

test("legacyAdmittedSpeakersFromDecision prefers executionBots over primaryQueue", () => {
  const lead = createBot("bot-a", "Bot A");
  const supplement = createBot("bot-b", "Bot B");
  const decision = {
    roundId: "adm-speakers",
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [lead, supplement],
    tier2: [],
    executionBots: [lead, supplement],
    roundPlan: {
      roundId: "adm-speakers",
      sessionKey: "space:shadow-a",
      responseMode: "lead_plus_supplement",
      summaryText: "speakers",
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
          tier: "relevance",
          contributionRole: "supplement",
          reasonText: "supplement",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "single_primary",
    primaryQueue: ["bot-a"],
  } as ParticipationDecision;
  expect(legacyAdmittedSpeakersFromDecision(decision)).toEqual(["bot-a", "bot-b"]);
  expect(decision.primaryQueue).toEqual(["bot-a"]);
});

test("stage A after-round writes full executionBots as legacy.admitted", async () => {
  const scope = createScope();
  const { authority } = testAuthorityFromScope(scope, { roundId: "speakers-a" });
  const { cfg } = await useConfig({ decisionRecords: true, shadowStage: "A" });
  const lead = createBot("bot-a", "Bot A");
  const supplement = createBot("bot-b", "Bot B");
  const decision = {
    roundId: "speakers-a",
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [lead, supplement],
    tier2: [],
    executionBots: [lead, supplement],
    roundPlan: {
      roundId: "speakers-a",
      sessionKey: "space:shadow-a",
      responseMode: "lead_plus_supplement",
      summaryText: "speakers",
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
          tier: "relevance",
          contributionRole: "supplement",
          reasonText: "supplement",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "single_primary",
    primaryQueue: ["bot-a"],
    floorShadow: computeSampleShadow(),
  } as ParticipationDecision;
  const result = await recordFloorShadowStageAAfterRound({
    authority,
    decision,
    round: { roundId: "speakers-a", dispatches: [] } as never,
    cfg,
  });
  expect(result.wrote).toBe(true);
  const archive = await readCollaborationLedgerArchive({ groupId: "shadow-a" });
  const edr = archive.records.find((record) => record.kind === "episode_decision");
  expect(edr?.kind).toBe("episode_decision");
  if (!edr || edr.kind !== "episode_decision") {
    return;
  }
  expect(edr.legacy.admitted).toEqual(["bot-a", "bot-b"]);
  expect(edr.legacy.primaryQueue).toEqual(["bot-a"]);
  expect(edr.floorCompare?.legacyAdmitted).toEqual(["bot-a", "bot-b"]);
  expect(edr.floorCompare?.stage).toBe("A");
});

function computeSampleShadow() {
  const scope = createScope();
  const { authority, facts } = testAuthorityFromScope(scope, { roundId: "sample" });
  const shadow = computeFloorShadowA(authority, facts, {
    message: "@Alpha 你怎么看",
    explicitMentions: ["Alpha"],
  });
  return {
    ...shadow,
    admission: {
      ...shadow.admission,
      admitted: shadow.admission.admitted.filter((row) => row.agentId === "alpha"),
    },
  };
}

async function useConfig(flags: {
  decisionRecords: boolean;
  shadowStage?: "A";
}): Promise<{ cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-a-"));
  tempDirs.push(root);
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      ledger: { decisionRecords: flags.decisionRecords },
      floor: {
        protocol: "legacy" as const,
        ...(flags.shadowStage ? { shadowStage: flags.shadowStage } : {}),
      },
    },
  } as OpenBotConfig;
  setRuntimeConfigSnapshot(cfg, cfg);
  return { cfg };
}

function beatInput(cfg: OpenBotConfig): BeatDecisionWriteInput {
  const groupId =
    cfg.collaboration?.floor?.shadowStage === "A" ? "grp-shadow-a-on" : "grp-shadow-a-off";
  const snap = createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_shadow_a" });
  const episodeId = "ep_shadow_a";
  return {
    key: buildCollaborationEventKey({
      tenantId: null,
      groupId,
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
      admitted: ["bot-a"],
      primaryQueue: ["bot-a"],
      dropped: [],
    },
    need: { agentIds: ["alpha"], source: "mention" },
    facilitator: [],
    outcome: {
      roundId: "round-shadow-a",
      respondedAgentIds: ["bot-a"],
      usefulAgentIds: [],
      noReply: [],
      duplicates: [],
      timeouts: [],
      qualityClassifierVersion: "useful-v1",
    },
    roundId: "round-shadow-a",
    mode: snap.effective.strategy.id,
    policyConstraints: snap.effective.clamps,
    participants: [{ agentId: "bot-a", tier: "primary", reason: "lead" }],
    provenance: snap.effective.provenance,
    cfg,
  };
}
