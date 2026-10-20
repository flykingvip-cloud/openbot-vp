/**
 * P0 G3 — Facilitator control plane on the G2 single-beat observation point.
 *
 * Flag off: chat still calls executeCollaborationRound once and the episode
 * store is not written. Flag on: FACILITATOR_OBSERVE records facilitator[]
 * outcomes and does not change the G8 participant list.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { executeCollaborationRoundForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { episodeIdForClientRun } from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import {
  EPISODE_FACILITATOR_GATE_KINDS,
  type EpisodeFacilitatorGateKind,
} from "./episode-decision-record.js";
import { runSingleBeatEpisodeAroundRound } from "./episode-single-beat-runtime.js";
import { createPersistedEpisode, readPersistedEpisode } from "./episode-store.js";
import {
  gateFacilitatorControl,
  recordFacilitatorObservation,
  type FacilitatorControlRequest,
} from "./facilitator-control.js";
import { LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR } from "./legacy-production-executor.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  vi.restoreAllMocks();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
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

function createBot(agentId: string, name: string, groupId: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:${groupId}`,
    updatedAt: 1,
  };
}

function decision(roundId: string, patch?: Partial<ParticipationDecision>): ParticipationDecision {
  const groupId = "g3-group";
  const botA = createBot("bot-a", "Bot A", groupId);
  const botB = createBot("bot-b", "Bot B", groupId);
  return {
    roundId,
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA, botB],
    tier2: [],
    executionBots: [botA, botB],
    roundPlan: {
      roundId,
      sessionKey: `space:${groupId}`,
      responseMode: "lead_plus_supplement",
      summaryText: "g3",
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
    ...patch,
  };
}

function scopeFor(bots: CollaborationBotTarget[]): CollaborationDispatchScope {
  return {
    groupId: "g3-group",
    rawSessionKey: "space:g3-group",
    title: "G3",
    bots,
  };
}

async function layout(): Promise<{ episodesDir: string; roundsDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g3-"));
  tempDirs.push(root);
  const episodesDir = path.join(root, "episodes");
  const roundsDir = path.join(root, "rounds");
  await fs.mkdir(episodesDir);
  await fs.mkdir(roundsDir);
  return { episodesDir, roundsDir };
}

function flagConfig(
  root: string,
  flags: { decisionRecords?: boolean; episodeStore?: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      episodeStore: flags.episodeStore ?? false,
      ledger: { decisionRecords: flags.decisionRecords ?? false },
    },
  } as OpenBotConfig;
}

async function useConfig(flags: {
  decisionRecords?: boolean;
  episodeStore?: boolean;
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g3-cfg-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, flags);
  setRuntimeConfigSnapshot(cfg, cfg);
  return { root, cfg };
}

async function transitions(episodesDir: string, episodeId: string): Promise<string[]> {
  const raw = await fs.readFile(path.join(episodesDir, episodeId, "events.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { transition: string }).transition);
}

describe("P0 G3 facilitator control plane", () => {
  test("gate outcomes stay the existing three and do not grow the enum", () => {
    expect([...EPISODE_FACILITATOR_GATE_KINDS]).toEqual([
      "authorized",
      "denied",
      "route_to_task_governance",
    ]);
    const record = fsSync.readFileSync(
      new URL("./episode-decision-record.ts", import.meta.url),
      "utf8",
    );
    const literal = record.match(
      /export const EPISODE_FACILITATOR_GATE_KINDS = \[([\s\S]*?)\] as const;/,
    );
    expect(literal?.[1]).toContain('"authorized"');
    expect(literal?.[1]).toContain('"denied"');
    expect(literal?.[1]).toContain('"route_to_task_governance"');
    const forbidden = ["CHALLENGE", "REQUEST_EVIDENCE"];
    for (const file of [
      "facilitator-control.ts",
      "episode-single-beat-runtime.ts",
      "episode-state.ts",
      "episode-decision-record.ts",
    ]) {
      const source = fsSync.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const word of forbidden) {
        expect(source).not.toContain(word);
      }
    }
    const schema = fsSync.readFileSync(
      new URL("../../config/zod-schema.ts", import.meta.url),
      "utf8",
    );
    expect(schema).toContain("episodeStore: z.boolean().optional()");
    expect(schema).not.toContain("episodeStore: z.boolean().default(true)");
  });

  test("control actions do not change the participant list and deny beat re-entry", () => {
    const participantIds = ["bot-a", "bot-b"];
    const requests: FacilitatorControlRequest[] = [
      { actionId: "stop_loop", event: "stop_loop" },
      { actionId: "next_beat", event: "next_beat" },
      { actionId: "redirect", event: "redirect" },
      { actionId: "authorized_action", event: "authorized_action" },
      { actionId: "handoff_proposed", event: "handoff_proposed" },
      { actionId: "route_to_task_governance", event: "route_to_task_governance" },
    ];
    const gated = gateFacilitatorControl({ requests, participantIds });
    expect(participantIds).toEqual(["bot-a", "bot-b"]);
    expect(gated.participantIds).toEqual(["bot-a", "bot-b"]);
    expect(gated.participantIds).not.toBe(participantIds);
    expect(gated.leaveEvent).toBe("route_to_task_governance");
    expect(gated.facilitator).toEqual([
      { actionId: "stop_loop", outcome: "authorized" },
      { actionId: "next_beat", outcome: "denied" },
      { actionId: "redirect", outcome: "denied" },
      { actionId: "authorized_action", outcome: "denied" },
      { actionId: "handoff_proposed", outcome: "denied" },
      { actionId: "route_to_task_governance", outcome: "route_to_task_governance" },
    ]);
    const outcomes = new Set<EpisodeFacilitatorGateKind>(EPISODE_FACILITATOR_GATE_KINDS);
    for (const entry of gated.facilitator) {
      expect(outcomes.has(entry.outcome)).toBe(true);
    }

    const engine = fsSync.readFileSync(new URL("./decision-engine.ts", import.meta.url), "utf8");
    expect(engine).toContain("if (!resolveWrapEnabled(params.effective))");
    expect(engine).toContain("params.tier0.length + params.tier1.length <= 1");
    const plane = fsSync.readFileSync(new URL("./facilitator-control.ts", import.meta.url), "utf8");
    expect(plane).not.toContain("decideParticipants");
    expect(plane).not.toContain("decision-engine");
    const runtime = fsSync.readFileSync(
      new URL("./episode-single-beat-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(runtime).not.toContain("decideParticipants");
    expect(runtime).not.toMatch(/from ["']\.\/episode-decision-record\.js["']/);
  });

  test("flag off does not write and leaves the G8 round path unchanged", async () => {
    const chat = fsSync.readFileSync(new URL("../server-methods/chat.ts", import.meta.url), "utf8");
    expect(chat.match(/executeCollaborationRound\(/g) ?? []).toHaveLength(1);
    expect(chat).not.toContain("writeBeatDecisionRecords");
    expect(chat).not.toContain("episode-decision-record");
    expect(chat).toContain("productionExecutor: resolveProductionCollaborationExecutor");

    const { episodesDir, roundsDir } = await layout();
    const roundId = "g3-off";
    const chosen = decision(roundId);
    const before = structuredClone(chosen);
    const roles: string[] = [];
    const round = await runSingleBeatEpisodeAroundRound({
      cfg: {},
      groupId: "g3-group",
      episodeId: episodeIdForClientRun(roundId),
      roundId,
      policySnapshotId: "pss_off",
      episodesDir,
      decision: chosen,
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor(chosen.executionBots),
          decision: chosen,
          message: "请分析这个方案并给出结论",
          sessionKey: "space:g3-group",
          roundsDir,
          productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
          runBot: async ({ role }) => {
            roles.push(role);
            return { text: "结论：应当继续推进，并给出明确下一步。" };
          },
        }),
    });
    expect(roles).toEqual(["primary", "supplement"]);
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(chosen).toEqual(before);
    expect(chosen.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a", "bot-b"]);
    expect(chosen.tier2).toEqual([]);
    await expect(
      readPersistedEpisode({ episodesDir, episodeId: episodeIdForClientRun(roundId) }),
    ).resolves.toBeNull();

    const missing = path.join(episodesDir, "missing");
    const skipped = await recordFacilitatorObservation({
      cfg: {},
      episodesDir: missing,
      episode: createPersistedEpisode({
        episodeId: "ep_skip",
        groupId: "g3-group",
        state: "FACILITATOR_OBSERVE",
      }),
      requests: [{ actionId: "stop_loop", event: "stop_loop" }],
      participantIds: ["bot-a", "bot-b"],
      admittedIds: ["bot-a"],
      groupId: "g3-group",
      episodeId: "ep_skip",
      roundId,
      policySnapshotId: "pss_off",
    });
    expect(skipped.enabled).toBe(false);
    expect(skipped.wroteDecisionRecord).toBe(false);
    expect(skipped.participantIds).toEqual(["bot-a", "bot-b"]);
    await expect(fs.access(missing)).rejects.toThrow();
  });

  test("observe point writes stop_loop as authorized and does not open another beat", async () => {
    const { episodesDir, roundsDir } = await layout();
    const roundId = "g3-stop";
    const chosen = decision(roundId);
    const before = structuredClone(chosen);
    const bots = chosen.executionBots;
    const roles: string[] = [];
    const round = await runSingleBeatEpisodeAroundRound({
      cfg: { collaboration: { episodeStore: true } },
      groupId: "g3-group",
      episodeId: episodeIdForClientRun(roundId),
      roundId,
      policySnapshotId: "pss_g3",
      episodesDir,
      decision: chosen,
      controlActions: [{ actionId: "next_beat", event: "next_beat" }],
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor(chosen.executionBots),
          decision: chosen,
          message: "请分析这个方案并给出结论",
          sessionKey: "space:g3-group",
          roundsDir,
          productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
          runBot: async ({ role }) => {
            roles.push(role);
            return { text: "结论：应当继续推进，并给出明确下一步。" };
          },
        }),
    });
    expect(roles).toEqual(["primary", "supplement"]);
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(chosen).toEqual(before);
    expect(chosen.executionBots).toBe(bots);
    const episode = await readPersistedEpisode({
      episodesDir,
      episodeId: episodeIdForClientRun(roundId),
    });
    expect(episode?.state).toBe("EPISODE_CLOSED");
    expect(episode?.closeReason).toBe("completed");
    expect(episode?.protocol).toBe("legacy");
    expect(episode?.beats).toHaveLength(1);
    expect(episode?.facilitator).toEqual([
      { actionId: "stop_loop", outcome: "authorized" },
      { actionId: "next_beat", outcome: "denied" },
    ]);
    const events = await transitions(episodesDir, episodeIdForClientRun(roundId));
    expect(events).toContain("beat_done");
    expect(events).toContain("stop_loop");
    expect(events).not.toContain("next_beat");
    expect(events).not.toContain("redirect");
    expect(events.filter((event) => event === "admitted")).toHaveLength(1);
  });

  test("route_to_task_governance is recorded and still keeps one beat", async () => {
    const { episodesDir, roundsDir } = await layout();
    const roundId = "g3-route";
    const chosen = decision(roundId);
    const beforeIds = chosen.roundPlan.participants.map((participant) => participant.agentId);
    await runSingleBeatEpisodeAroundRound({
      cfg: { collaboration: { episodeStore: true } },
      groupId: "g3-group",
      episodeId: episodeIdForClientRun(roundId),
      roundId,
      policySnapshotId: "pss_g3",
      episodesDir,
      decision: chosen,
      controlActions: [{ actionId: "route_to_task_governance", event: "route_to_task_governance" }],
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor(chosen.executionBots),
          decision: chosen,
          message: "请分析这个方案并给出结论",
          sessionKey: "space:g3-group",
          roundsDir,
          productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
          runBot: async () => ({ text: "结论：交给任务治理，名单不变。" }),
        }),
    });
    expect(chosen.roundPlan.participants.map((participant) => participant.agentId)).toEqual(
      beforeIds,
    );
    expect(chosen.tier2).toEqual([]);
    const episode = await readPersistedEpisode({
      episodesDir,
      episodeId: episodeIdForClientRun(roundId),
    });
    expect(episode?.beats).toHaveLength(1);
    expect(episode?.facilitator).toEqual([
      { actionId: "stop_loop", outcome: "authorized" },
      { actionId: "route_to_task_governance", outcome: "route_to_task_governance" },
    ]);
    const events = await transitions(episodesDir, episodeIdForClientRun(roundId));
    expect(events).toContain("route_to_task_governance");
    expect(events).not.toContain("stop_loop");
    expect(events).not.toContain("next_beat");
  });

  test("ledger flag copies facilitator[] onto the episode decision record", async () => {
    const { cfg } = await useConfig({ decisionRecords: true, episodeStore: true });
    const snap = createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_g3" });
    const roundId = "g3-edr";
    const episodeId = episodeIdForClientRun(roundId);
    const chosen = decision(roundId);
    const facts = resolveCollaborationRuntimeFactPaths({
      groupId: "g3-group",
      tenantId: null,
      cfg,
    });
    await runSingleBeatEpisodeAroundRound({
      cfg,
      groupId: "g3-group",
      episodeId,
      roundId,
      policySnapshotId: snap.policySnapshotId,
      policyHash: snap.policyHash,
      provenanceHash: snap.provenanceHash,
      compilerRevision: snap.compilerRevision,
      effective: snap.effective as EffectiveCollaborationPolicy,
      message: "请分析这个方案并给出结论",
      decision: chosen,
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor(chosen.executionBots),
          decision: chosen,
          message: "请分析这个方案并给出结论",
          sessionKey: "space:g3-group",
          roundsDir: facts.roundsDir,
          productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
          runBot: async ({ role }) => {
            expect(role === "primary" || role === "supplement").toBe(true);
            return { text: "结论：应当继续推进，并给出明确下一步。" };
          },
        }),
    });
    const episodesDir = facts.namespace?.episodesDir;
    expect(episodesDir).toBeTruthy();
    const episode = await readPersistedEpisode({ episodesDir: episodesDir!, episodeId });
    expect(episode?.facilitator).toEqual([{ actionId: "stop_loop", outcome: "authorized" }]);
    const raw = await fs.readFile(facts.ledgerFile, "utf8");
    const records = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            kind?: string;
            facilitator?: unknown;
            protocol?: string;
            legacy?: { admitted?: string[] };
            floor?: unknown;
          },
      );
    const edr = records.filter((record) => record.kind === "episode_decision");
    expect(edr).toHaveLength(1);
    expect(edr[0]?.protocol).toBe("legacy");
    expect(edr[0]?.floor).toBeUndefined();
    expect(edr[0]?.facilitator).toEqual(episode?.facilitator);
    expect(edr[0]?.legacy?.admitted).toEqual(["bot-a"]);
    expect(chosen.primaryQueue).toEqual(["bot-a"]);
    expect(chosen.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a", "bot-b"]);
  });
});
