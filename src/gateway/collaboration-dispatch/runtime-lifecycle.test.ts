/**
 * Floor Runtime v2.1 §2.2 mechanical check (c) — CI blocking (N4/I1).
 *
 * After the parent AbortSignal aborts, every in-flight collaboration promise must
 * settle within 100ms of fake time (pre-P3: `executeCollaborationRound` and its
 * `runBot` dispatches), no further dispatch may start, and the active timer count
 * must return to its baseline once the request is over.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { executeCollaborationRoundForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import { type RoundDispatchRunner } from "./round-runtime.js";
import type { CollaborationDispatchScope, ParticipationDecision } from "./types.js";

const realSetTimeout = globalThis.setTimeout;
const bot = (id: string) => ({
  agentId: id,
  name: id,
  sessionKey: `agent:${id}:main:space:alpha`,
  updatedAt: 1,
});
const bots = [bot("bot-a"), bot("bot-b"), bot("bot-c")];

function decision(roundId: string, primaryQueue: string[]): ParticipationDecision {
  return {
    roundId,
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: bots,
    tier2: [],
    executionBots: bots.filter((b) => primaryQueue.includes(b.agentId)),
    roundPlan: {
      roundId,
      sessionKey: "space:alpha",
      responseMode: "lead_plus_supplement",
      summaryText: "lifecycle",
      participants: primaryQueue.map((agentId) => ({
        agentId,
        displayName: agentId,
        tier: "duty" as const,
        contributionRole: "lead" as const,
        reasonText: "lead",
      })),
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: primaryQueue.length > 1 ? "explicit_multi" : "single",
    mentionMode: primaryQueue.length > 1 ? "explicit" : "none",
    primaryQueue,
  } as ParticipationDecision;
}

const scope: CollaborationDispatchScope = {
  groupId: "alpha",
  rawSessionKey: "space:alpha",
  title: "Alpha",
  bots,
};

/** runBot bound to the parent signal, like chat.ts's per-bot dispatch. */
function abortAwareRunner(signal: AbortSignal, started: () => void, calls: string[]) {
  const runBot: RoundDispatchRunner = ({ dispatchId }) => {
    calls.push(dispatchId);
    started();
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(undefined);
        return;
      }
      signal.addEventListener("abort", () => resolve(undefined), { once: true });
    });
  };
  return runBot;
}

async function settlesWithoutMoreFakeTime<T>(promise: Promise<T>): Promise<boolean> {
  // Real-time bound only for fs I/O to drain; fake time is NOT advanced further.
  return await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => realSetTimeout(() => resolve(false), 5_000)),
  ]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("collaboration runtime lifecycle (§2.2 (c))", () => {
  for (const [label, queue] of [
    ["single primary", ["bot-a"]],
    ["explicit multi-primary", ["bot-a", "bot-b", "bot-c"]],
  ] as const) {
    test(`${label}: parent abort settles the round within 100ms and restores timers`, async () => {
      const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-lifecycle-"));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const baselineTimers = vi.getTimerCount();
      const parent = new AbortController();
      const calls: string[] = [];
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let settled = false;
      const roundPromise = executeCollaborationRoundForTest({
        decision: decision(`round-lifecycle-${queue.length}`, [...queue]),
        policy: {
          ...DEFAULT_COLLABORATION_POLICY,
          supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
          coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
        },
        scope,
        message: "请给出明确结论和建议下一步",
        sessionKey: "space:alpha",
        roundsDir,
        isAborted: () => parent.signal.aborted,
        runBot: abortAwareRunner(parent.signal, () => markStarted(), calls),
      }).finally(() => {
        settled = true;
      });

      await started;
      // The primary deadline timer is live while the bot runs.
      expect(vi.getTimerCount()).toBeGreaterThan(baselineTimers);
      parent.abort();
      await vi.advanceTimersByTimeAsync(100);
      expect(await settlesWithoutMoreFakeTime(roundPromise)).toBe(true);
      expect(settled).toBe(true);
      const round = await roundPromise;
      expect(round.state).toBe("ROUND_ABORTED");
      expect(round.occupancy).toBe("none");
      // No dispatch after the abort; request over → timer count back to baseline.
      expect(calls).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(baselineTimers);
      await fs.rm(roundsDir, { recursive: true, force: true });
    });
  }
});
