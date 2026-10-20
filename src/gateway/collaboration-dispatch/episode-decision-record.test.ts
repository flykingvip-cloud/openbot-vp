/**
 * Floor Runtime v2.1 §2.11 / §5.6 P1-B② — EDR + PDR v2 writers.
 * Flag off: no-op, record-class bytes unchanged, live hot paths unwired.
 * Flag on: exactly one EDR and one PDR per beat, complete key, recover on entry.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import { FIELD_LABELS } from "../../config/schema.labels.js";
import type { OpenBotConfig } from "../../config/types.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import {
  beatIdForEpisode,
  buildCollaborationEventKey,
  isCompleteCollaborationEventKey,
  type CollaborationEventKey,
} from "./collaboration-event-key.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import {
  buildEpisodeDecisionRecord,
  buildPolicyDecisionRecordV2,
  DecisionRecordWriteError,
  isCollabLedgerDecisionRecordsEnabled,
  writeBeatDecisionRecords,
  type BeatDecisionWriteInput,
  type CollaborationEpisodeDecisionRecord,
  type CollaborationPolicyDecisionRecord,
} from "./episode-decision-record.js";
import {
  createPersistedEpisode,
  episodeSnapshotPath,
  readPersistedEpisode,
} from "./episode-store.js";
import { buildPolicyDecisionRecord } from "./policy-decision-record.js";
import { createRoundPolicySnapshot, type RoundPolicySnapshot } from "./round-policy-snapshot.js";
import { writeJsonDurable } from "./round-store-io.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import type { ParticipationDecision } from "./types.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
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

function flagConfig(
  root: string,
  flags: {
    decisionRecords?: boolean;
    episodeStore?: boolean;
    runtimeNamespace?: boolean;
  },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: flags.runtimeNamespace ?? true,
      episodeStore: flags.episodeStore ?? false,
      ledger: { decisionRecords: flags.decisionRecords ?? false },
    },
  } as OpenBotConfig;
}

async function useConfig(flags: {
  decisionRecords?: boolean;
  episodeStore?: boolean;
  runtimeNamespace?: boolean;
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-edr-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, flags);
  setRuntimeConfigSnapshot(cfg, cfg);
  return { root, cfg };
}

function snapshot(): RoundPolicySnapshot {
  return createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_edr_test" });
}

function beatInput(params: {
  snap: RoundPolicySnapshot;
  cfg: OpenBotConfig;
  groupId: string;
  episodeId: string;
  beatIndex?: number;
  roundId: string;
  at: number;
  beatId?: string | null;
}): BeatDecisionWriteInput {
  const episodeId = params.episodeId;
  const beatIndex = params.beatIndex ?? 0;
  const key = buildCollaborationEventKey({
    tenantId: null,
    groupId: params.groupId,
    episodeId,
    beatId: params.beatId === undefined ? beatIdForEpisode(episodeId, beatIndex) : params.beatId,
    snapshot: params.snap,
  });
  return {
    key,
    at: params.at,
    protocol: "legacy",
    intent: "discussion",
    provenanceHash: params.snap.provenanceHash,
    decideBranch: "open_discussion",
    legacy: {
      admitted: ["bot-a"],
      primaryQueue: ["bot-a"],
      dropped: [{ agentId: "bot-c", reason: "over_cap" }],
    },
    need: { agentIds: ["bot-a"], source: "mention" },
    facilitator: [],
    outcome: {
      roundId: params.roundId,
      respondedAgentIds: ["bot-a"],
      usefulAgentIds: ["bot-a"],
      noReply: [],
      duplicates: [],
      timeouts: [],
      firstUsefulAtMs: 40,
      qualityClassifierVersion: "useful-v1",
    },
    roundId: params.roundId,
    mode: params.snap.effective.strategy.id,
    policyConstraints: params.snap.effective.clamps,
    participants: [{ agentId: "bot-a", tier: "primary", reason: "lead" }],
    provenance: params.snap.effective.provenance,
    cfg: params.cfg,
  };
}

function fakeDecision(roundId: string): ParticipationDecision {
  return {
    roundId,
    responseMode: "lead_plus_supplement",
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    mentionUnmatched: false,
    mentionConfirm: null,
    lowSignalLimited: false,
    tier0: [],
    tier1: [],
    tier2: [],
    executionBots: [],
    roundPlan: {
      roundId,
      sessionKey: "space:g",
      summaryText: "test",
      responseMode: "lead_plus_supplement",
      participants: [
        {
          agentId: "bot-a",
          displayName: "Bot A",
          tier: "mention",
          contributionRole: "lead",
          reasonText: "lead",
        },
      ],
    },
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function expectCompleteKey(
  key: CollaborationEventKey,
  expected: { groupId: string; episodeId: string; beatId: string; snap: RoundPolicySnapshot },
) {
  expect(isCompleteCollaborationEventKey(key)).toBe(true);
  expect(key.tenantId).toBeNull();
  expect(key.groupId).toBe(expected.groupId);
  expect(key.episodeId).toBe(expected.episodeId);
  expect(key.beatId).toBe(expected.beatId);
  expect(key.beatId && key.beatId.length).toBeGreaterThan(0);
  expect(key.policySnapshotId).toBe(expected.snap.policySnapshotId);
  expect(key.policyHash).toBe(expected.snap.policyHash);
  expect(key.compilerRevision).toBe(expected.snap.compilerRevision);
}

describe("collaboration.ledger.decisionRecords", () => {
  test("flag defaults off and help/label exist", () => {
    expect(isCollabLedgerDecisionRecordsEnabled({})).toBe(false);
    expect(isCollabLedgerDecisionRecordsEnabled({ collaboration: {} })).toBe(false);
    expect(isCollabLedgerDecisionRecordsEnabled({ collaboration: { ledger: {} } })).toBe(false);
    expect(
      isCollabLedgerDecisionRecordsEnabled({
        collaboration: { ledger: { decisionRecords: false } },
      }),
    ).toBe(false);
    expect(
      isCollabLedgerDecisionRecordsEnabled({
        collaboration: { ledger: { decisionRecords: true } },
      }),
    ).toBe(true);
    expect(FIELD_HELP["collaboration.ledger.decisionRecords"]).toMatch(/default false/);
    expect(FIELD_LABELS["collaboration.ledger.decisionRecords"]).toBeTruthy();
  });

  test("flag-off is a no-op: no ledger, no recover, v1 PDR bytes unchanged", async () => {
    const { cfg } = await useConfig({
      decisionRecords: false,
      episodeStore: true,
      runtimeNamespace: true,
    });
    const snap = snapshot();
    const groupId = "grp-edr-off";
    const episodeId = "ep_off";
    const facts = resolveCollaborationRuntimeFactPaths({ groupId, tenantId: null, cfg });
    expect(facts.namespace?.ledgerFile).toBe(facts.ledgerFile);
    await writeJsonDurable(
      episodeSnapshotPath(facts.namespace!.episodesDir, episodeId),
      createPersistedEpisode({ episodeId, groupId, state: "BEAT_ACTIVE" }),
    );
    const input = beatInput({
      snap,
      cfg,
      groupId,
      episodeId,
      roundId: "run-off",
      at: 10,
    });
    const v1Before = JSON.stringify(
      buildPolicyDecisionRecord({
        decision: fakeDecision("run-off"),
        effective: snap.effective as EffectiveCollaborationPolicy,
      }),
    );
    const result = await writeBeatDecisionRecords(input);
    expect(result).toEqual({
      enabled: false,
      wroteEpisodeDecision: false,
      wrotePolicyDecision: false,
      episodeDecisions: 0,
      policyDecisions: 0,
      recover: null,
    });
    expect(await exists(facts.ledgerFile)).toBe(false);
    expect(await exists(facts.roundsDir)).toBe(false);
    const still = await readPersistedEpisode({
      episodesDir: facts.namespace!.episodesDir,
      episodeId,
    });
    expect(still?.state).toBe("BEAT_ACTIVE");
    const v1After = JSON.stringify(
      buildPolicyDecisionRecord({
        decision: fakeDecision("run-off"),
        effective: snap.effective as EffectiveCollaborationPolicy,
      }),
    );
    expect(v1After).toBe(v1Before);
    expect(v1After).not.toContain("episode_decision");
    expect(v1After).not.toContain("policy_decision");

    const incomplete = await writeBeatDecisionRecords({
      ...input,
      key: { ...input.key, beatId: null },
    });
    expect(incomplete.enabled).toBe(false);
  });

  test("live hot paths and this module do not import round-store writes", async () => {
    const here = new URL(".", import.meta.url);
    const source = await fs.readFile(new URL("./episode-decision-record.ts", here), "utf8");
    const roundRuntime = await fs.readFile(new URL("./round-runtime.ts", here), "utf8");
    const chat = await fs.readFile(new URL("../server-methods/chat.ts", here), "utf8");
    expect(source).toMatch(/from ["']\.\/round-store-io\.js["']/);
    expect(source).not.toMatch(/from ["']\.\/round-store\.js["']/);
    expect(source).not.toMatch(/writePersistedRound|applyRoundTransition|commitRoundSnapshot/);
    expect(roundRuntime).not.toContain("episode-decision-record");
    expect(roundRuntime).not.toContain("writeBeatDecisionRecords");
    expect(chat).not.toContain("episode-decision-record");
    expect(chat).not.toContain("writeBeatDecisionRecords");
  });

  test("flag-on writes exactly one EDR and one PDR with a complete key", async () => {
    const { cfg } = await useConfig({
      decisionRecords: true,
      episodeStore: true,
      runtimeNamespace: true,
    });
    const snap = snapshot();
    const groupId = "grp-edr-on";
    const episodeId = "ep_on";
    const roundId = "run-on";
    const facts = resolveCollaborationRuntimeFactPaths({ groupId, tenantId: null, cfg });
    const episodesDir = facts.namespace!.episodesDir;
    await writeJsonDurable(
      episodeSnapshotPath(episodesDir, episodeId),
      createPersistedEpisode({ episodeId, groupId, state: "BEAT_ACTIVE" }),
    );
    await writeJsonDurable(
      episodeSnapshotPath(episodesDir, "ep_other"),
      createPersistedEpisode({ episodeId: "ep_other", groupId, state: "FACILITATOR_OBSERVE" }),
    );
    const input = beatInput({ snap, cfg, groupId, episodeId, roundId, at: 100 });
    const result = await writeBeatDecisionRecords(input);
    expect(result.enabled).toBe(true);
    expect(result.wroteEpisodeDecision).toBe(true);
    expect(result.wrotePolicyDecision).toBe(true);
    expect(result.episodeDecisions).toBe(1);
    expect(result.policyDecisions).toBe(1);
    expect(result.recover).toEqual({ recovered: 1, scanned: 2 });
    expect((await readPersistedEpisode({ episodesDir, episodeId }))?.state).toBe("BEAT_ACTIVE");
    expect((await readPersistedEpisode({ episodesDir, episodeId: "ep_other" }))?.state).toBe(
      "ABORTED_ON_RESTART",
    );
    expect(await exists(facts.roundsDir)).toBe(false);
    expect(facts.ledgerFile).toContain(
      `${path.sep}runtime${path.sep}ledger${path.sep}collaboration.jsonl`,
    );

    const archive = await readCollaborationLedgerArchive({ groupId });
    expect(archive.records).toHaveLength(2);
    const edr = archive.records.find(
      (record): record is CollaborationEpisodeDecisionRecord => record.kind === "episode_decision",
    );
    const pdr = archive.records.find(
      (record): record is CollaborationPolicyDecisionRecord => record.kind === "policy_decision",
    );
    expect(edr).toBeTruthy();
    expect(pdr).toBeTruthy();
    expect(edr).toMatchObject({
      kind: "episode_decision",
      schemaVersion: 2,
      at: 100,
      recordedAtMs: 100,
      protocol: "legacy",
      intent: "discussion",
      provenanceHash: snap.provenanceHash,
      decideBranch: "open_discussion",
      legacy: {
        admitted: ["bot-a"],
        primaryQueue: ["bot-a"],
        dropped: [{ agentId: "bot-c", reason: "over_cap" }],
      },
      need: { agentIds: ["bot-a"], source: "mention" },
      facilitator: [],
      outcome: {
        roundId,
        qualityClassifierVersion: "useful-v1",
        respondedAgentIds: ["bot-a"],
      },
    });
    expect(pdr).toMatchObject({
      kind: "policy_decision",
      schemaVersion: 2,
      at: 100,
      recordedAtMs: 100,
      roundId,
      protocolVersion: "1.1",
      effectivePolicyHash: snap.policyHash,
      provenanceHash: snap.provenanceHash,
      compilerRevision: snap.compilerRevision,
      decideBranch: "open_discussion",
      droppedAtDecide: [{ agentId: "bot-c", reason: "over_cap" }],
      mode: snap.effective.strategy.id,
    });
    expectCompleteKey(edr!.key, { groupId, episodeId, beatId: `${episodeId}:b0`, snap });
    expectCompleteKey(pdr!.key, { groupId, episodeId, beatId: `${episodeId}:b0`, snap });
    expect(pdr!.effectivePolicyHash).toBe(pdr!.key.policyHash);
    expect(pdr!.compilerRevision).toBe(pdr!.key.compilerRevision);
    expect(pdr!.provenance.collaborationMode).toBeTruthy();

    const again = await writeBeatDecisionRecords(input);
    expect(again.wroteEpisodeDecision).toBe(false);
    expect(again.wrotePolicyDecision).toBe(false);
    expect(again.episodeDecisions).toBe(1);
    expect(again.policyDecisions).toBe(1);
    const reread = await readCollaborationLedgerArchive({ groupId });
    expect(reread.records.filter((record) => record.kind === "episode_decision")).toHaveLength(1);
    expect(reread.records.filter((record) => record.kind === "policy_decision")).toHaveLength(1);
  });

  test("two beats each get their own pair; unknown ledger kinds are skipped", async () => {
    const { cfg } = await useConfig({ decisionRecords: true, runtimeNamespace: true });
    const snap = snapshot();
    const groupId = "grp-edr-beats";
    const episodeId = "ep_beats";
    const facts = resolveCollaborationRuntimeFactPaths({ groupId, tenantId: null, cfg });
    await writeBeatDecisionRecords(
      beatInput({ snap, cfg, groupId, episodeId, beatIndex: 0, roundId: "run-b0", at: 1 }),
    );
    await writeBeatDecisionRecords(
      beatInput({
        snap,
        cfg,
        groupId,
        episodeId,
        beatIndex: 1,
        roundId: `${episodeId}:b1`,
        at: 2,
      }),
    );
    await fs.appendFile(
      facts.ledgerFile,
      `${JSON.stringify({ kind: "fact", type: "FutureFact", recordedAtMs: 3 })}\n` +
        `${JSON.stringify({ kind: "not_a_real_kind", recordedAtMs: 4 })}\n`,
      "utf8",
    );
    const archive = await readCollaborationLedgerArchive({ groupId });
    expect(archive.records.map((record) => record.kind).toSorted()).toEqual([
      "episode_decision",
      "episode_decision",
      "policy_decision",
      "policy_decision",
    ]);
    const beatIds = new Set(
      archive.records.map((record) => ("key" in record ? record.key?.beatId : null)),
    );
    expect(beatIds).toEqual(new Set([`${episodeId}:b0`, `${episodeId}:b1`]));
    for (const beatId of beatIds) {
      const rows = archive.records.filter(
        (record) => "key" in record && record.key?.beatId === beatId,
      );
      expect(rows.filter((record) => record.kind === "episode_decision")).toHaveLength(1);
      expect(rows.filter((record) => record.kind === "policy_decision")).toHaveLength(1);
    }
    const onlyEdr = await readCollaborationLedgerArchive({
      groupId,
      kinds: ["episode_decision"],
    });
    expect(onlyEdr.records).toHaveLength(2);
    expect(onlyEdr.records.every((record) => record.kind === "episode_decision")).toBe(true);
  });

  test("concurrent writers still leave exactly one pair", async () => {
    const { cfg } = await useConfig({ decisionRecords: true, runtimeNamespace: true });
    const snap = snapshot();
    const groupId = "grp-edr-race";
    const input = beatInput({
      snap,
      cfg,
      groupId,
      episodeId: "ep_race",
      roundId: "run-race",
      at: 7,
    });
    const results = await Promise.all([
      writeBeatDecisionRecords(input),
      writeBeatDecisionRecords(input),
    ]);
    const wroteEdr = results.filter((result) => result.wroteEpisodeDecision).length;
    const wrotePdr = results.filter((result) => result.wrotePolicyDecision).length;
    expect(wroteEdr).toBe(1);
    expect(wrotePdr).toBe(1);
    const archive = await readCollaborationLedgerArchive({ groupId });
    expect(archive.records.filter((record) => record.kind === "episode_decision")).toHaveLength(1);
    expect(archive.records.filter((record) => record.kind === "policy_decision")).toHaveLength(1);
  });

  test("flag-on rejects an incomplete key before recover or ledger I/O", async () => {
    const { cfg } = await useConfig({
      decisionRecords: true,
      episodeStore: true,
      runtimeNamespace: true,
    });
    const snap = snapshot();
    const groupId = "grp-edr-badkey";
    const episodeId = "ep_bad";
    const facts = resolveCollaborationRuntimeFactPaths({ groupId, tenantId: null, cfg });
    await writeJsonDurable(
      episodeSnapshotPath(facts.namespace!.episodesDir, episodeId),
      createPersistedEpisode({ episodeId, groupId, state: "BEAT_ACTIVE" }),
    );
    const input = beatInput({
      snap,
      cfg,
      groupId,
      episodeId,
      roundId: "run-bad",
      at: 3,
      beatId: null,
    });
    await expect(writeBeatDecisionRecords(input)).rejects.toBeInstanceOf(DecisionRecordWriteError);
    expect(await exists(facts.ledgerFile)).toBe(false);
    expect(
      (await readPersistedEpisode({ episodesDir: facts.namespace!.episodesDir, episodeId }))?.state,
    ).toBe("BEAT_ACTIVE");
    expect(() => buildEpisodeDecisionRecord({ ...input, at: 3 })).toThrow(DecisionRecordWriteError);
    expect(() => buildPolicyDecisionRecordV2({ ...input, at: 3 })).toThrow(
      DecisionRecordWriteError,
    );
  });
});
