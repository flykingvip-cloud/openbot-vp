/**
 * Design §5.6 / §3.3 — Episode abort/restart must not touch round dirs;
 * episode-store must not import round-store write functions.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applyEpisodeTransition,
  createLegacyOneBeatEpisode,
  createPersistedEpisode,
  episodeSnapshotPath,
  listPersistedEpisodes,
  readPersistedEpisode,
  recoverIncompleteEpisodes,
} from "./episode-store.js";
import { writeJsonDurable } from "./round-store-io.js";

function fileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function pathTouchesRounds(p: unknown): boolean {
  if (typeof p !== "string") {
    return false;
  }
  return p.includes(`${path.sep}rounds${path.sep}`) || p.endsWith(`${path.sep}rounds`);
}

describe("episode boundary / isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("episode-store source does not import round-store write APIs", async () => {
    const storeSrc = await fsp.readFile(new URL("./episode-store.ts", import.meta.url), "utf8");
    expect(storeSrc).toMatch(/from ["']\.\/round-store-io\.js["']/);
    expect(storeSrc).not.toMatch(/from ["']\.\/round-store\.js["']/);
    expect(storeSrc).not.toMatch(/writePersistedRound|applyRoundTransition|commitRoundSnapshot/);
    expect(storeSrc).not.toMatch(/roundsDir|\/rounds\//);
  });

  test("recoverIncompleteEpisodes never reads or writes under rounds/", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-ep-boundary-"));
    const episodesDir = path.join(root, "episodes");
    const roundsDir = path.join(root, "rounds");
    await fsp.mkdir(episodesDir, { recursive: true });
    await fsp.mkdir(roundsDir, { recursive: true });

    const roundSnap = path.join(roundsDir, "run1.json");
    const roundEvents = path.join(roundsDir, "run1.events.jsonl");
    await writeJsonDurable(roundSnap, {
      roundId: "run1",
      state: "ROUND_COMPLETE",
      stateVersion: 9,
    });
    await fsp.writeFile(roundEvents, `${JSON.stringify({ eventId: "r-evt-1" })}\n`, "utf8");
    const snapHashBefore = fileSha256(roundSnap);
    const eventsHashBefore = fileSha256(roundEvents);

    const open = createPersistedEpisode({
      episodeId: "ep_run1",
      groupId: "alpha",
      state: "FACILITATOR_OBSERVE",
      beats: [{ beatId: "ep_run1:b0", beatIndex: 0, roundId: "run1" }],
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, open.episodeId), open);

    const touchedRoundPaths: string[] = [];
    const track = (...args: unknown[]) => {
      for (const a of args) {
        if (pathTouchesRounds(a)) {
          touchedRoundPaths.push(String(a));
        }
      }
    };

    // Capture originals BEFORE spyOn so wrappers do not recurse into mocks.
    const origReadFile = fsp.readFile.bind(fsp);
    const origWriteFile = fsp.writeFile.bind(fsp);
    const origOpen = fsp.open.bind(fsp);
    const origRename = fsp.rename.bind(fsp);
    const origUnlink = fsp.unlink.bind(fsp);
    const origMkdir = fsp.mkdir.bind(fsp);
    const origReaddir = fsp.readdir.bind(fsp);
    const origOpenSync = fs.openSync.bind(fs);
    const origWriteFileSync = fs.writeFileSync.bind(fs);
    const origUnlinkSync = fs.unlinkSync.bind(fs);
    const origMkdirSync = fs.mkdirSync.bind(fs);
    const origStatSync = fs.statSync.bind(fs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrap = <T extends (...args: any[]) => any>(fn: T) =>
      ((...args: Parameters<T>) => {
        track(...args);
        return fn(...args);
      }) as T;

    vi.spyOn(fsp, "readFile").mockImplementation(wrap(origReadFile));
    vi.spyOn(fsp, "writeFile").mockImplementation(wrap(origWriteFile));
    vi.spyOn(fsp, "open").mockImplementation(wrap(origOpen));
    vi.spyOn(fsp, "rename").mockImplementation(wrap(origRename));
    vi.spyOn(fsp, "unlink").mockImplementation(wrap(origUnlink));
    vi.spyOn(fsp, "mkdir").mockImplementation(wrap(origMkdir));
    vi.spyOn(fsp, "readdir").mockImplementation(wrap(origReaddir));
    vi.spyOn(fs, "openSync").mockImplementation(wrap(origOpenSync));
    vi.spyOn(fs, "writeFileSync").mockImplementation(wrap(origWriteFileSync));
    vi.spyOn(fs, "unlinkSync").mockImplementation(wrap(origUnlinkSync));
    vi.spyOn(fs, "mkdirSync").mockImplementation(wrap(origMkdirSync));
    vi.spyOn(fs, "statSync").mockImplementation(wrap(origStatSync));

    const result = await recoverIncompleteEpisodes({
      episodesDir,
      cfg: { collaboration: { episodeStore: true } },
    });
    expect(result.recovered).toBe(1);
    expect(touchedRoundPaths).toEqual([]);
    expect(fileSha256(roundSnap)).toBe(snapHashBefore);
    expect(fileSha256(roundEvents)).toBe(eventsHashBefore);

    const after = await readPersistedEpisode({ episodesDir, episodeId: "ep_run1" });
    expect(after?.state).toBe("ABORTED_ON_RESTART");
    expect(after?.beats[0]?.roundId).toBe("run1");
  });

  test("episode abort leaves completed round snapshot+events hash unchanged", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-ep-abort-"));
    const episodesDir = path.join(root, "episodes");
    const roundsDir = path.join(root, "rounds");
    await fsp.mkdir(episodesDir, { recursive: true });
    await fsp.mkdir(roundsDir, { recursive: true });

    const roundSnap = path.join(roundsDir, "run2.json");
    const roundEvents = path.join(roundsDir, "run2.events.jsonl");
    await writeJsonDurable(roundSnap, { roundId: "run2", state: "ROUND_COMPLETE" });
    await fsp.writeFile(roundEvents, `${JSON.stringify({ eventId: "done" })}\n`, "utf8");
    const snapHash = fileSha256(roundSnap);
    const eventsHash = fileSha256(roundEvents);

    let episode = createLegacyOneBeatEpisode({
      episodeId: "ep_run2",
      groupId: "alpha",
      roundId: "run2",
      policySnapshotId: "pss_2",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);
    const stepped = await applyEpisodeTransition({
      episode,
      event: "resolve_context",
      episodesDir,
    });
    episode = stepped.episode;
    const aborted = await applyEpisodeTransition({
      episode,
      event: "abort",
      episodesDir,
    });
    expect(aborted.episode.state).toBe("EPISODE_CLOSED");
    expect(aborted.episode.closeReason).toBe("aborted");
    expect(fileSha256(roundSnap)).toBe(snapHash);
    expect(fileSha256(roundEvents)).toBe(eventsHash);
    expect(await listPersistedEpisodes({ episodesDir })).toHaveLength(1);
  });
});
