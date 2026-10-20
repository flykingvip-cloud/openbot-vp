import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendCollaborationContextScopeRecord,
  appendCollaborationDispatchRecord,
  appendCollaborationExecutionRecord,
  appendCollaborationQualityRecord,
} from "../collaboration-ledger/writer.js";
import {
  beatIdForEpisode,
  buildCollaborationEventKey,
  episodeIdForClientRun,
  isCompleteCollaborationEventKey,
} from "./collaboration-event-key.js";
import { buildPolicyDecisionRecord } from "./policy-decision-record.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import type { ParticipationDecision } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

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
    executionBots: [
      {
        agentId: "bot-a",
        name: "Bot A",
        sessionKey: "agent:bot-a:main:space:g1",
        updatedAt: 1,
      },
    ],
    roundPlan: {
      roundId,
      sessionKey: "space:g1",
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

describe("collaboration-event-key (P0.0b)", () => {
  it("episodeId / beatId conventions and complete 7-field key", () => {
    const episodeId = episodeIdForClientRun("run-abc");
    expect(episodeId).toBe("ep_run-abc");
    expect(beatIdForEpisode(episodeId, 0)).toBe("ep_run-abc:b0");
    const snap = createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_k1" });
    const key = buildCollaborationEventKey({
      tenantId: "001",
      groupId: "g1",
      episodeId,
      beatId: beatIdForEpisode(episodeId, 0),
      snapshot: snap,
    });
    expect(isCompleteCollaborationEventKey(key)).toBe(true);
    expect(key).toEqual({
      tenantId: "001",
      groupId: "g1",
      episodeId: "ep_run-abc",
      beatId: "ep_run-abc:b0",
      policySnapshotId: "pss_k1",
      policyHash: snap.policyHash,
      compilerRevision: snap.compilerRevision,
    });
  });

  it("dispatch / execution / quality / context_scope / PDR share the same key within a round", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "p00b-event-key-"));
    tempDirs.push(root);
    vi.stubEnv("OPENBOT_HOME", root);
    vi.stubEnv("OPENBOT_STATE_DIR", root);

    const snap = createRoundPolicySnapshot(
      { maxVisibleBotRepliesPerRound: 3 },
      { now: 1, idGen: () => "pss_same" },
    );
    const episodeId = episodeIdForClientRun("round-same");
    const key = buildCollaborationEventKey({
      tenantId: null,
      groupId: "g1",
      episodeId,
      beatId: beatIdForEpisode(episodeId, 0),
      snapshot: snap,
    });
    const decision = fakeDecision("round-same");

    const dispatch = await appendCollaborationDispatchRecord({
      groupId: "g1",
      message: "hello",
      decision,
      key,
    });
    const execution = await appendCollaborationExecutionRecord({
      groupId: "g1",
      sessionKey: "space:g1",
      roundId: "round-same",
      agentId: "bot-a",
      agentName: "Bot A",
      tier: "mention",
      status: "completed",
      key,
    });
    const quality = await appendCollaborationQualityRecord({
      groupId: "g1",
      event: "turn",
      outcome: "completed",
      roundId: "round-same",
      key,
    });
    const context = await appendCollaborationContextScopeRecord({
      groupId: "g1",
      sessionKey: "space:g1",
      roundId: "round-same",
      mode: "group",
      confidentialityMaxLevel: "internal",
      allowedSources: [],
      deniedSources: [],
      budgetMaxTokens: 1000,
      budgetMaxFiles: 10,
      key,
    });
    const pdr = buildPolicyDecisionRecord({
      decision,
      effective: snap.effective as never,
      key,
    });

    expect(dispatch.key).toEqual(key);
    expect(execution.key).toEqual(key);
    expect(quality.key).toEqual(key);
    expect(context.key).toEqual(key);
    expect(pdr.key).toEqual(key);
    expect(isCompleteCollaborationEventKey(dispatch.key)).toBe(true);
    expect(isCompleteCollaborationEventKey(pdr.key)).toBe(true);
  });
});
