/**
 * Stage 4 pin 单拍运行时 E3 (P0 G2 flag-gated single-beat Episode runtime).
 *
 * Proposition (Stage 4 / P0 G2): behind `collaboration.episodeStore` (default
 * off), a single-beat runtime creates/advances one Episode on the existing
 * transition table, stops after at most one Beat (`next_beat` refused), keeps
 * Episode files out of the rounds directory, and when the flag is off leaves
 * the G8 round path unchanged (no episode write; recover is a no-op).
 * Not Stage 4 overall PASS. Knowledge archive restore stays open.
 * stage8_eligible stays false.
 *
 * Companion product tests: `episode-single-beat-runtime.g2.test.ts` (6).
 * Wire: `chat.ts` wraps `executeCollaborationRound` with
 * `runSingleBeatEpisodeAroundRound`.
 */
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../src/config/config.js";
import type { OpenBotConfig } from "../../src/config/types.js";
import { episodeIdForClientRun } from "../../src/gateway/collaboration-dispatch/collaboration-event-key.js";
import { runSingleBeatEpisodeAroundRound } from "../../src/gateway/collaboration-dispatch/episode-single-beat-runtime.js";
import {
  episodeEventsPath,
  isCollabEpisodeStoreEnabled,
  readPersistedEpisode,
  recoverIncompleteEpisodes,
} from "../../src/gateway/collaboration-dispatch/episode-store.js";

const tempRoots: string[] = [];
const storeOn: OpenBotConfig = { collaboration: { episodeStore: true } };

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  await Promise.all(
    tempRoots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true })),
  );
});

function layout(): { episodesDir: string; roundsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-pin-single-shot-"));
  tempRoots.push(root);
  const episodesDir = path.join(root, "episodes");
  const roundsDir = path.join(root, "rounds");
  fs.mkdirSync(episodesDir);
  fs.mkdirSync(roundsDir);
  return { episodesDir, roundsDir };
}

function decision() {
  return {
    mentionUnmatched: false,
    executionBots: [{ agentId: "bot-a" }],
    primaryQueue: ["bot-a"],
    responseMode: "lead_plus_supplement",
    mentionMode: "single_primary" as const,
    roundPlan: {
      participants: [{ agentId: "bot-a", contributionRole: "lead", reasonText: "lead" }],
    },
  };
}

async function transitions(episodesDir: string, episodeId: string): Promise<string[]> {
  const raw = await fsPromises.readFile(episodeEventsPath(episodesDir, episodeId), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { transition: string }).transition);
}

describe("Stage 4 pin single-shot runtime (E3)", () => {
  it("episodeStore stays default off; chat wires single-beat wrap around G8", () => {
    expect(isCollabEpisodeStoreEnabled({})).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: {} })).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: { episodeStore: false } })).toBe(false);
    expect(isCollabEpisodeStoreEnabled(storeOn)).toBe(true);

    const schema = fs.readFileSync(
      new URL("../../src/config/zod-schema.ts", import.meta.url),
      "utf8",
    );
    expect(schema).toContain("episodeStore: z.boolean().optional()");
    expect(schema).not.toContain("episodeStore: z.boolean().default(true)");

    const chat = fs.readFileSync(
      new URL("../../src/gateway/server-methods/chat.ts", import.meta.url),
      "utf8",
    );
    expect(chat).toContain("runSingleBeatEpisodeAroundRound");
    expect(chat).toContain("executeCollaborationRound");
    const wrapAt = chat.indexOf("runSingleBeatEpisodeAroundRound({");
    expect(wrapAt).toBeGreaterThan(-1);
    const window = chat.slice(wrapAt, wrapAt + 1200);
    expect(window).toContain("executeRound:");
    expect(window).toContain("executeCollaborationRound(authority, facts, {");
  });

  it("flag off: round callback runs; no episode written; recover is a no-op", async () => {
    setRuntimeConfigSnapshot({});
    const { episodesDir } = layout();
    const roundId = "stage4-flag-off";
    const episodeId = episodeIdForClientRun(roundId);
    let ran = 0;
    const result = await runSingleBeatEpisodeAroundRound({
      cfg: {},
      groupId: "g-stage4",
      episodeId,
      roundId,
      policySnapshotId: "pss_off",
      episodesDir,
      decision: decision(),
      executeRound: async () => {
        ran += 1;
        return { state: "ROUND_COMPLETE" as const };
      },
    });
    expect(ran).toBe(1);
    expect(result).toEqual({ state: "ROUND_COMPLETE" });
    await expect(readPersistedEpisode({ episodesDir, episodeId })).resolves.toBeNull();
    expect(await recoverIncompleteEpisodes({ episodesDir, cfg: {} })).toEqual({
      recovered: 0,
      scanned: 0,
    });
    expect(fs.readdirSync(episodesDir)).toEqual([]);
  });

  it("flag on: seeds episode, advances to EPISODE_CLOSED with one beat, refuses next_beat", async () => {
    setRuntimeConfigSnapshot({});
    const { episodesDir, roundsDir } = layout();
    const roundId = "stage4-flag-on";
    const episodeId = episodeIdForClientRun(roundId);
    const result = await runSingleBeatEpisodeAroundRound({
      cfg: storeOn,
      groupId: "g-stage4",
      episodeId,
      roundId,
      policySnapshotId: "pss_on",
      episodesDir,
      decision: decision(),
      executeRound: async () => ({ state: "ROUND_COMPLETE" as const }),
    });
    expect(result).toEqual({ state: "ROUND_COMPLETE" });
    const episode = await readPersistedEpisode({ episodesDir, episodeId });
    expect(episode?.state).toBe("EPISODE_CLOSED");
    expect(episode?.closeReason).toBe("completed");
    expect(episode?.beats).toHaveLength(1);
    expect(episode?.beats[0]?.beatIndex).toBe(0);
    expect(episode?.beats[0]?.roundId).toBe(roundId);
    expect(await transitions(episodesDir, episodeId)).not.toContain("next_beat");
    expect((await transitions(episodesDir, episodeId)).length).toBeGreaterThan(0);

    const roundNames = fs.readdirSync(roundsDir);
    expect(roundNames.filter((n) => n.includes("ep_") || n.includes("episode"))).toEqual([]);
  });

  it("flag on: second wrap of same episodeId does not open another beat", async () => {
    setRuntimeConfigSnapshot({});
    const { episodesDir } = layout();
    const roundId = "stage4-idempotent";
    const episodeId = episodeIdForClientRun(roundId);
    const run = () =>
      runSingleBeatEpisodeAroundRound({
        cfg: storeOn,
        groupId: "g-stage4",
        episodeId,
        roundId,
        policySnapshotId: "pss_on",
        episodesDir,
        decision: decision(),
        executeRound: async () => ({ state: "ROUND_COMPLETE" as const }),
      });
    await run();
    await run();
    const episode = await readPersistedEpisode({ episodesDir, episodeId });
    expect(episode?.state).toBe("EPISODE_CLOSED");
    expect(episode?.beats).toHaveLength(1);
  });
});
