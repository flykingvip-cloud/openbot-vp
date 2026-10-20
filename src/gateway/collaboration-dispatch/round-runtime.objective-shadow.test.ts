import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  OBJECTIVE_SHADOW_FLAG_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_ENV,
} from "../../objective-shadow/feature.js";
import { OBJECTIVE_SHADOW_LOG_ENV } from "../../objective-shadow/ingress-hook.js";
import { readShadowRecords } from "../../objective-shadow/log.js";
import {
  enableObjectiveShadowForTest,
  resolveShadowTestLogPath,
} from "../../objective-shadow/test-env.js";
import { executeCollaborationRoundForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import type { CollaborationDispatchScope, ParticipationDecision } from "./types.js";

const HMAC_KEY = "collab-shadow-hmac";

const botA = {
  agentId: "bot-a",
  name: "Bot A",
  sessionKey: "agent:bot-a:main:space:alpha",
  updatedAt: 1,
};

function policyWithoutWrap() {
  return {
    ...DEFAULT_COLLABORATION_POLICY,
    supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
    coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
  };
}

function createDecision(): ParticipationDecision {
  return {
    roundId: "round-shadow",
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA],
    tier2: [],
    executionBots: [botA],
    roundPlan: {
      roundId: "round-shadow",
      sessionKey: "space:alpha",
      responseMode: "lead_plus_supplement",
      summaryText: "test",
      participants: [
        {
          agentId: "bot-a",
          displayName: "Bot A",
          tier: "duty",
          contributionRole: "lead",
          reasonText: "lead",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
  };
}

function createScope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    bots: [botA],
  };
}

describe("executeCollaborationRound objective shadow wiring", () => {
  let roundsDir: string;
  let logPath: string;
  let previous: Record<string, string | undefined>;

  beforeEach(async () => {
    roundsDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-obj-shadow-"));
    logPath = resolveShadowTestLogPath(path.join(roundsDir, "objective-shadow.jsonl"));
    previous = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: process.env[OBJECTIVE_SHADOW_FLAG_ENV],
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV],
      [OBJECTIVE_SHADOW_LOG_ENV]: process.env[OBJECTIVE_SHADOW_LOG_ENV],
    };
    process.env[OBJECTIVE_SHADOW_LOG_ENV] = logPath;
    if (logPath === path.join(roundsDir, "objective-shadow.jsonl")) {
      delete process.env[OBJECTIVE_SHADOW_FLAG_ENV];
      delete process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(roundsDir, { recursive: true, force: true });
  });

  test("OFF writes no JSONL and still completes the round", async () => {
    const round = await executeCollaborationRoundForTest({
      decision: createDecision(),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "分析一下",
      sessionKey: "space:alpha",
      tenantId: "tenant-collab",
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "这是一条完整结论，足够通过完成合同。" }),
    });
    expect(round.state).toBeTruthy();
    expect(fs.existsSync(logPath)).toBe(false);
  });

  test("ON records discarded collaboration observation, not exclusive execute", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    await executeCollaborationRoundForTest({
      decision: createDecision(),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "分析一下",
      sessionKey: "space:alpha",
      tenantId: "tenant-collab",
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "这是一条完整结论，足够通过完成合同。" }),
    });
    await executeCollaborationRoundForTest({
      decision: createDecision(),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "再来一次",
      sessionKey: "space:alpha",
      tenantId: "tenant-collab",
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "这是一条完整结论，足够通过完成合同。" }),
    });
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.correlation.ingress).toBe("collaboration_turn");
    expect(records[0]?.proposed).toEqual([]);
    expect(records[0]?.rejectOrDiscardCodes).toContain("collab_deferred_phase3b");
    expect(records[0]?.correlation.objectiveId).toBeUndefined();
    expect(records[0]?.correlation.objectiveId).not.toBe("round-shadow");
    expect(records[0]?.resolveStatus).toBe("skipped");
  });
});
