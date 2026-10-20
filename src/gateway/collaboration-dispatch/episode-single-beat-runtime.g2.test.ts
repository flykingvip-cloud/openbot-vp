/**
 * P0 G2 — single-beat Episode runtime behind collaboration.episodeStore.
 *
 * Flag off keeps the G8 round path and leaves recoverIncompleteEpisodes a no-op.
 * Flag on creates one Episode, advances it on the existing transition table,
 * and stops after at most one Beat. Store and round directories stay apart.
 */
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { executeCollaborationRoundForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { beatIdForEpisode, episodeIdForClientRun } from "./collaboration-event-key.js";
import {
  beginSingleBeatEpisodeRuntime,
  finishSingleBeatEpisodeRuntime,
  runSingleBeatEpisodeAroundRound,
  type SingleBeatEpisodeDecision,
} from "./episode-single-beat-runtime.js";
import { LEGACY_ONE_BEAT_HAPPY_PATH } from "./episode-state-machine.js";
import {
  createPersistedEpisode,
  episodeEventsPath,
  episodeSnapshotPath,
  isCollabEpisodeStoreEnabled,
  readPersistedEpisode,
  recoverIncompleteEpisodes,
} from "./episode-store.js";
import {
  LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
  resolveProductionCollaborationExecutor,
} from "./legacy-production-executor.js";
import { roundEventsPath, writeJsonDurable } from "./round-store-io.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

const tempDirs: string[] = [];
const storeOn: OpenBotConfig = { collaboration: { episodeStore: true } };

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function sha256(filePath: string): string {
  return createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex");
}

function createBot(agentId: string, name: string, groupId: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:${groupId}`,
    updatedAt: 1,
  };
}

function decision(roundId: string, patch?: Partial<ParticipationDecision>): ParticipationDecision {
  const botA = createBot("bot-a", "Bot A", "g2-group");
  const botB = createBot("bot-b", "Bot B", "g2-group");
  return {
    roundId,
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA, botB],
    tier2: [],
    executionBots: [botA, botB],
    roundPlan: {
      roundId,
      sessionKey: "space:g2-group",
      responseMode: "lead_plus_supplement",
      summaryText: "g2",
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
    groupId: "g2-group",
    rawSessionKey: "space:g2-group",
    title: "G2",
    bots,
  };
}

async function layout(): Promise<{ episodesDir: string; roundsDir: string; sentinel: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g2-"));
  tempDirs.push(root);
  const episodesDir = path.join(root, "episodes");
  const roundsDir = path.join(root, "rounds");
  await fs.mkdir(episodesDir);
  await fs.mkdir(roundsDir);
  const sentinel = path.join(roundsDir, "sentinel.txt");
  await fs.writeFile(sentinel, "round-sentinel\n", "utf8");
  return { episodesDir, roundsDir, sentinel };
}

async function transitions(episodesDir: string, episodeId: string): Promise<string[]> {
  const raw = await fs.readFile(episodeEventsPath(episodesDir, episodeId), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { transition: string }).transition);
}

function pathTouchesRounds(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.includes(`${path.sep}rounds${path.sep}`) || value.endsWith(`${path.sep}rounds`))
  );
}

function spyRoundPaths(): string[] {
  const touched: string[] = [];
  const track = (...args: unknown[]) => {
    for (const arg of args) {
      if (pathTouchesRounds(arg)) {
        touched.push(String(arg));
      }
    }
  };
  const watch = <T>(fn: T): T =>
    ((...args: unknown[]) => {
      track(...args);
      return (fn as (...inner: unknown[]) => unknown)(...args);
    }) as T;
  const orig = {
    readFile: fs.readFile.bind(fs),
    writeFile: fs.writeFile.bind(fs),
    open: fs.open.bind(fs),
    rename: fs.rename.bind(fs),
    unlink: fs.unlink.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    readdir: fs.readdir.bind(fs),
    openSync: fsSync.openSync.bind(fsSync),
    writeFileSync: fsSync.writeFileSync.bind(fsSync),
    unlinkSync: fsSync.unlinkSync.bind(fsSync),
    mkdirSync: fsSync.mkdirSync.bind(fsSync),
    statSync: fsSync.statSync.bind(fsSync),
    closeSync: fsSync.closeSync.bind(fsSync),
  };
  vi.spyOn(fs, "readFile").mockImplementation(watch(orig.readFile));
  vi.spyOn(fs, "writeFile").mockImplementation(watch(orig.writeFile));
  vi.spyOn(fs, "open").mockImplementation(watch(orig.open));
  vi.spyOn(fs, "rename").mockImplementation(watch(orig.rename));
  vi.spyOn(fs, "unlink").mockImplementation(watch(orig.unlink));
  vi.spyOn(fs, "mkdir").mockImplementation(watch(orig.mkdir));
  vi.spyOn(fs, "readdir").mockImplementation(watch(orig.readdir));
  vi.spyOn(fsSync, "openSync").mockImplementation(watch(orig.openSync));
  vi.spyOn(fsSync, "writeFileSync").mockImplementation(watch(orig.writeFileSync));
  vi.spyOn(fsSync, "unlinkSync").mockImplementation(watch(orig.unlinkSync));
  vi.spyOn(fsSync, "mkdirSync").mockImplementation(watch(orig.mkdirSync));
  vi.spyOn(fsSync, "statSync").mockImplementation(watch(orig.statSync));
  vi.spyOn(fsSync, "closeSync").mockImplementation(watch(orig.closeSync));
  return touched;
}

describe("P0 G2 single-beat episode runtime", () => {
  test("episodeStore stays default off and does not select another executor", () => {
    expect(isCollabEpisodeStoreEnabled({})).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: {} })).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: { episodeStore: false } })).toBe(false);
    expect(resolveProductionCollaborationExecutor({})).toBe(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR);
    expect(resolveProductionCollaborationExecutor(storeOn)).toBe(
      LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
    );

    const schema = fsSync.readFileSync(
      new URL("../../config/zod-schema.ts", import.meta.url),
      "utf8",
    );
    expect(schema).toContain("episodeStore: z.boolean().optional()");
    expect(schema).not.toContain("episodeStore: z.boolean().default(true)");

    const chat = fsSync.readFileSync(new URL("../server-methods/chat.ts", import.meta.url), "utf8");
    expect(chat.match(/executeCollaborationRound\(/g) ?? []).toHaveLength(1);
    const callAt = chat.indexOf("executeCollaborationRound(authority, facts, {");
    expect(callAt).toBeGreaterThan(-1);
    expect(chat.slice(callAt, callAt + 280)).toContain(
      "productionExecutor: resolveProductionCollaborationExecutor(policySnapshotCfg)",
    );
    expect(chat.slice(callAt, callAt + 500)).not.toContain("roundsDir");
    expect(chat).toContain("runSingleBeatEpisodeAroundRound");
    expect(chat).not.toContain("episode-store.js");
    expect(chat).not.toContain("episode-state-machine.js");
    expect(chat).not.toContain("transitionEpisodeState");
    expect(chat).not.toContain("recoverIncompleteEpisodes");

    const roundRuntime = fsSync.readFileSync(
      new URL("./round-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(roundRuntime).not.toContain("episode-single-beat-runtime");
    expect(roundRuntime).not.toContain("episode-store");
    expect(roundRuntime).not.toContain("transitionEpisodeState");

    const runtime = fsSync.readFileSync(
      new URL("./episode-single-beat-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(runtime).toContain("refuses next_beat");
    expect(runtime).toContain("applyEpisodeTransition");
    expect(runtime).toContain("recoverIncompleteEpisodes");
    expect(runtime).not.toContain("executeCollaborationRound");
    expect(runtime).not.toContain("round-store.js");
    expect(runtime).not.toContain('protocol: "floor"');
    expect(runtime).not.toContain("runtimeNamespace: true");
    expect(runtime).not.toMatch(/from ["']\.\/episode-decision-record\.js["']/);
  });

  test("flag off delegates the round and does not recover or write episodes", async () => {
    setRuntimeConfigSnapshot({});
    const { episodesDir, roundsDir, sentinel } = await layout();
    const before = sha256(sentinel);
    const open = createPersistedEpisode({
      episodeId: "ep_open",
      groupId: "g2-group",
      state: "FACILITATOR_OBSERVE",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, open.episodeId), open);
    const roundId = "g2-flag-off";
    const episodeId = episodeIdForClientRun(roundId);
    const roles: string[] = [];
    const round = await runSingleBeatEpisodeAroundRound({
      cfg: {},
      groupId: "g2-group",
      episodeId,
      roundId,
      policySnapshotId: "pss_off",
      episodesDir,
      decision: decision(roundId),
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor([
            createBot("bot-a", "Bot A", "g2-group"),
            createBot("bot-b", "Bot B", "g2-group"),
          ]),
          decision: decision(roundId),
          message: "请分析这个方案并给出结论",
          sessionKey: "space:g2-group",
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
    expect(sha256(sentinel)).toBe(before);
    await expect(readPersistedEpisode({ episodesDir, episodeId })).resolves.toBeNull();
    expect((await readPersistedEpisode({ episodesDir, episodeId: "ep_open" }))?.state).toBe(
      "FACILITATOR_OBSERVE",
    );
    const recovered = await recoverIncompleteEpisodes({ episodesDir, cfg: {} });
    expect(recovered).toEqual({ recovered: 0, scanned: 0 });
    expect((await readPersistedEpisode({ episodesDir, episodeId: "ep_open" }))?.state).toBe(
      "FACILITATOR_OBSERVE",
    );
    const roundTypes = (await fs.readFile(roundEventsPath(roundsDir, roundId), "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { type: string }).type);
    expect(roundTypes.some((type) => type.startsWith("EPISODE_") || type === "BEAT_ACTIVE")).toBe(
      false,
    );
  });

  test("flag on walks one beat to EPISODE_CLOSED and does not open another", async () => {
    setRuntimeConfigSnapshot({});
    const { episodesDir, roundsDir, sentinel } = await layout();
    const before = sha256(sentinel);
    const roundId = "g2-live";
    const episodeId = episodeIdForClientRun(roundId);
    const stale = createPersistedEpisode({
      episodeId: "ep_stale",
      groupId: "g2-group",
      state: "BEAT_ACTIVE",
      beats: [{ beatId: "ep_stale:b0", beatIndex: 0, roundId: "old" }],
    });
    const done = createPersistedEpisode({
      episodeId: "ep_done",
      groupId: "g2-group",
      state: "EPISODE_CLOSED",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, stale.episodeId), stale);
    await writeJsonDurable(episodeSnapshotPath(episodesDir, done.episodeId), done);

    const roles: string[] = [];
    const run = () =>
      runSingleBeatEpisodeAroundRound({
        cfg: storeOn,
        groupId: "g2-group",
        episodeId,
        roundId,
        policySnapshotId: "pss_g2",
        policyHash: "ph_g2",
        episodesDir,
        decision: decision(roundId),
        executeRound: () =>
          executeCollaborationRoundForTest({
            scope: scopeFor([
              createBot("bot-a", "Bot A", "g2-group"),
              createBot("bot-b", "Bot B", "g2-group"),
            ]),
            decision: decision(roundId),
            message: "请分析这个方案并给出结论",
            sessionKey: "space:g2-group",
            roundsDir,
            productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
            runBot: async ({ role }) => {
              roles.push(role);
              return { text: "结论：应当继续推进，并给出明确下一步。" };
            },
          }),
      });

    const round = await run();
    expect(roles).toEqual(["primary", "supplement"]);
    expect(round.state).toBe("ROUND_COMPLETE");
    const episode = await readPersistedEpisode({ episodesDir, episodeId });
    expect(episode?.state).toBe("EPISODE_CLOSED");
    expect(episode?.closeReason).toBe("completed");
    expect(episode?.protocol).toBe("legacy");
    expect(episode?.beats).toEqual([
      { beatId: beatIdForEpisode(episodeId, 0), beatIndex: 0, roundId },
    ]);
    expect(episode?.stateVersion).toBe(LEGACY_ONE_BEAT_HAPPY_PATH.length);
    // P0 G3 leaves FACILITATOR_OBSERVE via stop_loop. Same length, same table,
    // still one beat. The design §5.6 constant itself stays on `converged`.
    const g3Close = LEGACY_ONE_BEAT_HAPPY_PATH.map((event) =>
      event === "converged" ? "stop_loop" : event,
    );
    expect(await transitions(episodesDir, episodeId)).toEqual([...g3Close]);
    expect((await transitions(episodesDir, episodeId)).includes("next_beat")).toBe(false);

    const again = await run();
    expect(again.state).toBe("ROUND_COMPLETE");
    expect(roles).toEqual(["primary", "supplement"]);
    expect(await transitions(episodesDir, episodeId)).toEqual([...g3Close]);
    expect((await readPersistedEpisode({ episodesDir, episodeId }))?.beats).toHaveLength(1);
    expect((await readPersistedEpisode({ episodesDir, episodeId: "ep_stale" }))?.state).toBe(
      "ABORTED_ON_RESTART",
    );
    expect((await readPersistedEpisode({ episodesDir, episodeId: "ep_done" }))?.state).toBe(
      "EPISODE_CLOSED",
    );
    expect(sha256(sentinel)).toBe(before);
    const names = await fs.readdir(roundsDir);
    expect(names.filter((name) => name.startsWith("ep_") || name.includes("episode"))).toEqual([]);
  });

  test("flag on stops unmatched and empty rounds without a second beat", async () => {
    setRuntimeConfigSnapshot({});
    const { episodesDir, roundsDir, sentinel } = await layout();
    const before = sha256(sentinel);
    const unmatchedId = "g2-unmatched";
    const unmatched = await runSingleBeatEpisodeAroundRound({
      cfg: storeOn,
      groupId: "g2-group",
      episodeId: episodeIdForClientRun(unmatchedId),
      roundId: unmatchedId,
      policySnapshotId: "pss_g2",
      episodesDir,
      decision: decision(unmatchedId, { mentionUnmatched: true }),
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor([createBot("bot-a", "Bot A", "g2-group")]),
          decision: decision(unmatchedId, { mentionUnmatched: true }),
          message: "@Missing 请看一下",
          sessionKey: "space:g2-group",
          roundsDir,
          productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
          runBot: async () => {
            throw new Error("unmatched round must not dispatch");
          },
        }),
    });
    expect(unmatched.state).toBe("MENTION_UNMATCHED");
    const unmatchedEpisode = await readPersistedEpisode({
      episodesDir,
      episodeId: episodeIdForClientRun(unmatchedId),
    });
    expect(unmatchedEpisode?.state).toBe("EPISODE_CLOSED");
    expect(unmatchedEpisode?.closeReason).toBe("waiting_user");
    expect(unmatchedEpisode?.beats).toEqual([]);
    expect(await transitions(episodesDir, episodeIdForClientRun(unmatchedId))).toEqual([
      "snapshot_bound",
      "resolve_context",
      "classified",
      "unmatched_mention",
      "notice_sent",
    ]);

    const silentId = "g2-silent";
    const silentDecision = decision(silentId, {
      executionBots: [],
      tier1: [],
      primaryQueue: [],
      roundPlan: {
        roundId: silentId,
        sessionKey: "space:g2-group",
        responseMode: "lead_plus_supplement",
        summaryText: "silent",
        participants: [],
      },
    });
    const silent = await runSingleBeatEpisodeAroundRound({
      cfg: storeOn,
      groupId: "g2-group",
      episodeId: episodeIdForClientRun(silentId),
      roundId: silentId,
      policySnapshotId: "pss_g2",
      episodesDir,
      decision: silentDecision,
      executeRound: () =>
        executeCollaborationRoundForTest({
          scope: scopeFor([]),
          decision: silentDecision,
          message: "安静",
          sessionKey: "space:g2-group",
          roundsDir,
          productionExecutor: LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
          runBot: async () => {
            throw new Error("empty round must not dispatch");
          },
        }),
    });
    expect(silent.state).toBe("ROUND_ABORTED");
    const silentEpisode = await readPersistedEpisode({
      episodesDir,
      episodeId: episodeIdForClientRun(silentId),
    });
    expect(silentEpisode?.state).toBe("EPISODE_CLOSED");
    expect(silentEpisode?.closeReason).toBe("no_eligible");
    expect(silentEpisode?.beats).toEqual([]);
    expect(await transitions(episodesDir, episodeIdForClientRun(silentId))).not.toContain(
      "next_beat",
    );
    expect(await transitions(episodesDir, episodeIdForClientRun(silentId))).not.toContain(
      "beat_done",
    );
    expect(sha256(sentinel)).toBe(before);
  });

  test("a refused G8 executor still throws and the open beat stops", async () => {
    const { episodesDir, roundsDir } = await layout();
    const roundId = "g2-refuse";
    const episodeId = episodeIdForClientRun(roundId);
    const calls: string[] = [];
    await expect(
      runSingleBeatEpisodeAroundRound({
        cfg: storeOn,
        groupId: "g2-group",
        episodeId,
        roundId,
        policySnapshotId: "pss_g2",
        episodesDir,
        decision: decision(roundId),
        executeRound: () =>
          executeCollaborationRoundForTest({
            scope: scopeFor([createBot("bot-a", "Bot A", "g2-group")]),
            decision: decision(roundId),
            message: "请分析这个方案并给出结论",
            sessionKey: "space:g2-group",
            roundsDir,
            productionExecutor: "floor",
            runBot: async () => {
              calls.push("ran");
              return { text: "不应执行" };
            },
          }),
      }),
    ).rejects.toThrow(/P0 G8/);
    expect(calls).toEqual([]);
    const episode = await readPersistedEpisode({ episodesDir, episodeId });
    expect(episode?.state).toBe("EPISODE_CLOSED");
    expect(episode?.closeReason).toBe("aborted");
    expect(episode?.beats).toHaveLength(1);
    expect(await transitions(episodesDir, episodeId)).not.toContain("next_beat");
    expect(await transitions(episodesDir, episodeId)).toContain("abort");
  });

  test("store writes do not read or write the rounds directory", async () => {
    const { episodesDir, roundsDir, sentinel } = await layout();
    const before = sha256(sentinel);
    const touched = spyRoundPaths();
    const decisionInput: SingleBeatEpisodeDecision = {
      mentionUnmatched: false,
      executionBots: [{ agentId: "bot-a" }],
    };
    const session = await beginSingleBeatEpisodeRuntime({
      cfg: storeOn,
      groupId: "g2-group",
      episodeId: "ep_boundary",
      roundId: "boundary",
      policySnapshotId: "pss_g2",
      episodesDir,
      decision: decisionInput,
    });
    expect(session.enabled).toBe(true);
    if (!session.enabled) {
      return;
    }
    expect(session.episode.state).toBe("BEAT_ACTIVE");
    expect(session.episode.beats).toHaveLength(1);
    const closed = await finishSingleBeatEpisodeRuntime(session, { state: "ROUND_COMPLETE" });
    expect(closed?.state).toBe("EPISODE_CLOSED");
    expect(closed?.closeReason).toBe("completed");
    expect(touched).toEqual([]);
    vi.restoreAllMocks();
    expect(sha256(sentinel)).toBe(before);
    expect(await fs.readdir(roundsDir)).toEqual(["sentinel.txt"]);

    const confirmTouched = spyRoundPaths();
    const confirm = await beginSingleBeatEpisodeRuntime({
      cfg: storeOn,
      groupId: "g2-group",
      episodeId: "ep_confirm",
      roundId: "confirm",
      policySnapshotId: "pss_g2",
      episodesDir,
      decision: { mentionUnmatched: false, mentionConfirm: { token: "near" }, executionBots: [] },
    });
    expect(confirm.enabled).toBe(true);
    if (!confirm.enabled) {
      return;
    }
    expect(confirm.episode.state).toBe("WAITING_USER");
    const parked = await finishSingleBeatEpisodeRuntime(confirm, { state: "MENTION_CONFIRM" });
    expect(parked?.state).toBe("EPISODE_CLOSED");
    expect(parked?.closeReason).toBe("waiting_user");
    expect(parked?.beats).toEqual([]);
    expect(confirmTouched).toEqual([]);
  });
});
