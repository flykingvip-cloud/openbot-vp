import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { LEGACY_ONE_BEAT_HAPPY_PATH } from "./episode-state-machine.js";
import {
  applyEpisodeTransition,
  createLegacyOneBeatEpisode,
  createPersistedEpisode,
  EpisodeCasConflictError,
  episodeEventsPath,
  episodeSnapshotPath,
  episodeTxnPath,
  isCollabEpisodeStoreEnabled,
  listPersistedEpisodes,
  readPersistedEpisode,
  recoverIncompleteEpisodes,
} from "./episode-store.js";
import { writeJsonDurable } from "./round-store-io.js";

async function tmpEpisodesDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openbot-episode-"));
}

describe("episode store", () => {
  test("flag collaboration.episodeStore defaults off", () => {
    expect(isCollabEpisodeStoreEnabled({})).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: {} })).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: { episodeStore: false } })).toBe(false);
    expect(isCollabEpisodeStoreEnabled({ collaboration: { episodeStore: true } })).toBe(true);
  });

  test("CAS persist + event idempotency along legacy 1-beat path", async () => {
    const episodesDir = await tmpEpisodesDir();
    let episode = createLegacyOneBeatEpisode({
      episodeId: "ep_run1",
      groupId: "alpha",
      roundId: "run1",
      policySnapshotId: "pss_1",
      policyHash: "ph_1",
      legacyDecisionRef: "legacy-decision-1",
    });
    // Seed initial snapshot at POLICY_SNAPSHOTTED (stateVersion 0).
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);

    const pathEvents = LEGACY_ONE_BEAT_HAPPY_PATH.slice(1);
    for (const event of pathEvents) {
      const result = await applyEpisodeTransition({
        episode,
        event,
        episodesDir,
        eventId: `evt-${event}`,
        legacyDecisionRef: event === "ranked" ? "legacy-decision-1" : undefined,
      });
      expect(result.skipped).toBe(false);
      episode = result.episode;
    }
    expect(episode.state).toBe("EPISODE_CLOSED");
    expect(episode.closeReason).toBe("completed");
    expect(episode.beats).toHaveLength(1);
    expect(episode.beats[0]?.roundId).toBe("run1");
    expect(episode.legacyDecisionRef).toBe("legacy-decision-1");

    const current = await readPersistedEpisode({ episodesDir, episodeId: "ep_run1" });
    expect(current?.state).toBe("EPISODE_CLOSED");
    expect(current?.stateVersion).toBe(pathEvents.length);

    const eventsRaw = await fs.readFile(episodeEventsPath(episodesDir, "ep_run1"), "utf8");
    const lines = eventsRaw.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(pathEvents.length);
    const ids = lines.map((l) => (JSON.parse(l) as { eventId: string }).eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("corrupt event line is skipped by the dedupe set and does not rewrite the snapshot", async () => {
    const episodesDir = await tmpEpisodesDir();
    const episode = createPersistedEpisode({
      episodeId: "ep_corrupt",
      groupId: "alpha",
      state: "EPISODE_CREATED",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);
    const eventsPath = episodeEventsPath(episodesDir, episode.episodeId);
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    const corrupt = "{not-json";
    const valid = JSON.stringify({
      eventId: "keep-me",
      eventType: "POLICY_SNAPSHOTTED",
    });
    await fs.writeFile(eventsPath, `${corrupt}\n${valid}\n`, "utf8");
    const snapshotBefore = await fs.readFile(
      episodeSnapshotPath(episodesDir, episode.episodeId),
      "utf8",
    );

    const skipped = await applyEpisodeTransition({
      episode,
      event: "snapshot_bound",
      episodesDir,
      eventId: "keep-me",
    });
    expect(skipped.skipped).toBe(true);
    expect(skipped.episode.state).toBe("EPISODE_CREATED");
    expect(skipped.episode.stateVersion).toBe(0);
    expect(await fs.readFile(episodeSnapshotPath(episodesDir, episode.episodeId), "utf8")).toBe(
      snapshotBefore,
    );
    expect(await fs.readFile(eventsPath, "utf8")).toBe(`${corrupt}\n${valid}\n`);

    const advanced = await applyEpisodeTransition({
      episode,
      event: "snapshot_bound",
      episodesDir,
      eventId: "fresh-id",
    });
    expect(advanced.skipped).toBe(false);
    expect(advanced.episode.state).toBe("POLICY_SNAPSHOTTED");
    expect(advanced.episode.stateVersion).toBe(1);
    const eventsRaw = await fs.readFile(eventsPath, "utf8");
    const lines = eventsRaw.split("\n").filter((line) => line.length > 0);
    expect(lines[0]).toBe(corrupt);
    expect(lines.some((line) => line.includes("fresh-id"))).toBe(true);
    expect(lines.filter((line) => line === corrupt)).toHaveLength(1);
  });

  test("duplicate eventId is skipped (idempotent)", async () => {
    const episodesDir = await tmpEpisodesDir();
    const episode = createPersistedEpisode({
      episodeId: "ep_idem",
      groupId: "alpha",
      state: "EPISODE_CREATED",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);
    const first = await applyEpisodeTransition({
      episode,
      event: "snapshot_bound",
      episodesDir,
      eventId: "same-id",
    });
    expect(first.skipped).toBe(false);
    expect(first.episode.stateVersion).toBe(1);
    // Manually plant the same eventId into events while resetting snapshot to v0
    // so the lock path hits the idempotency branch before CAS... actually CAS
    // runs on version. Re-apply with matching version after rewriting snapshot
    // back is awkward; instead append-only check: writing txn+finish with same
    // eventId via a second transition from a fresh v0 clone is CAS-blocked.
    // Directly verify readEpisodeEventIds path by re-running finish via crash txn:
    await writeJsonDurable(episodeTxnPath(episodesDir, "ep_idem"), {
      snapshot: first.episode,
      event: {
        eventId: "same-id",
        eventType: "POLICY_SNAPSHOTTED",
        at: Date.now(),
        fromState: "EPISODE_CREATED",
        toState: "POLICY_SNAPSHOTTED",
        transition: "snapshot_bound",
        episodeId: "ep_idem",
      },
    });
    const again = await readPersistedEpisode({ episodesDir, episodeId: "ep_idem" });
    expect(again?.stateVersion).toBe(1);
    const eventsRaw = await fs.readFile(episodeEventsPath(episodesDir, "ep_idem"), "utf8");
    const lines = eventsRaw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  test("illegal transition throws; CAS conflict on concurrent version", async () => {
    const episodesDir = await tmpEpisodesDir();
    const episode = createPersistedEpisode({
      episodeId: "ep_cas",
      groupId: "alpha",
      state: "EPISODE_CREATED",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);

    await expect(
      applyEpisodeTransition({
        episode,
        event: "admitted",
        episodesDir,
      }),
    ).rejects.toThrow(/illegal episode transition/);

    const first = await applyEpisodeTransition({
      episode,
      event: "snapshot_bound",
      episodesDir,
      eventId: "evt-a",
    });
    expect(first.episode.stateVersion).toBe(1);

    await expect(
      applyEpisodeTransition({
        episode, // stale version 0
        event: "snapshot_bound",
        episodesDir,
        eventId: "evt-b",
      }),
    ).rejects.toBeInstanceOf(EpisodeCasConflictError);
  });

  test("crash mid-commit: pending txn is finished on next read", async () => {
    const episodesDir = await tmpEpisodesDir();
    const episode = createPersistedEpisode({
      episodeId: "ep_crash",
      groupId: "alpha",
      state: "EPISODE_CREATED",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);

    const next = {
      ...episode,
      state: "POLICY_SNAPSHOTTED" as const,
      stateVersion: 1,
      policySnapshotId: "pss_x",
      updatedAt: Date.now(),
    };
    const commit = {
      snapshot: next,
      event: {
        eventId: "evt-crash",
        eventType: "POLICY_SNAPSHOTTED" as const,
        at: Date.now(),
        fromState: "EPISODE_CREATED" as const,
        toState: "POLICY_SNAPSHOTTED" as const,
        transition: "snapshot_bound" as const,
        episodeId: "ep_crash",
      },
    };
    // Simulate crash after writing txn, before finish.
    await writeJsonDurable(episodeTxnPath(episodesDir, "ep_crash"), commit);

    const recovered = await readPersistedEpisode({
      episodesDir,
      episodeId: "ep_crash",
    });
    expect(recovered?.state).toBe("POLICY_SNAPSHOTTED");
    expect(recovered?.stateVersion).toBe(1);
    // txn cleaned up
    await expect(fs.stat(episodeTxnPath(episodesDir, "ep_crash"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const eventsRaw = await fs.readFile(episodeEventsPath(episodesDir, "ep_crash"), "utf8");
    expect(eventsRaw).toContain("evt-crash");
  });

  test("recoverIncompleteEpisodes: non-terminal → ABORTED_ON_RESTART; flag-off no-op", async () => {
    const episodesDir = await tmpEpisodesDir();
    const open = createPersistedEpisode({
      episodeId: "ep_open",
      groupId: "alpha",
      state: "BEAT_ACTIVE",
      beats: [{ beatId: "ep_open:b0", beatIndex: 0, roundId: "r1" }],
    });
    const closed = createPersistedEpisode({
      episodeId: "ep_closed",
      groupId: "alpha",
      state: "EPISODE_CLOSED",
    });
    closed.closeReason = "completed";
    closed.stateVersion = 1;
    await writeJsonDurable(episodeSnapshotPath(episodesDir, open.episodeId), open);
    await writeJsonDurable(episodeSnapshotPath(episodesDir, closed.episodeId), closed);

    // Flag off → no-op
    const noop = await recoverIncompleteEpisodes({
      episodesDir,
      cfg: { collaboration: { episodeStore: false } },
    });
    expect(noop).toEqual({ recovered: 0, scanned: 0 });
    const stillOpen = await readPersistedEpisode({ episodesDir, episodeId: "ep_open" });
    expect(stillOpen?.state).toBe("BEAT_ACTIVE");

    const result = await recoverIncompleteEpisodes({
      episodesDir,
      cfg: { collaboration: { episodeStore: true } },
    });
    expect(result.recovered).toBe(1);
    expect(result.scanned).toBe(2);

    const after = await readPersistedEpisode({ episodesDir, episodeId: "ep_open" });
    expect(after?.state).toBe("ABORTED_ON_RESTART");
    const stillClosed = await readPersistedEpisode({
      episodesDir,
      episodeId: "ep_closed",
    });
    expect(stillClosed?.state).toBe("EPISODE_CLOSED");
    expect(stillClosed?.closeReason).toBe("completed");

    // Second recover is idempotent (already terminal)
    const again = await recoverIncompleteEpisodes({
      episodesDir,
      cfg: { collaboration: { episodeStore: true } },
    });
    expect(again.recovered).toBe(0);
  });

  test("concurrent locking: serialized writers on same episode", async () => {
    const episodesDir = await tmpEpisodesDir();
    const episode = createPersistedEpisode({
      episodeId: "ep_lock",
      groupId: "alpha",
      state: "EPISODE_CREATED",
    });
    await writeJsonDurable(episodeSnapshotPath(episodesDir, episode.episodeId), episode);

    const results = await Promise.allSettled([
      applyEpisodeTransition({
        episode,
        event: "snapshot_bound",
        episodesDir,
        eventId: "evt-1",
      }),
      applyEpisodeTransition({
        episode,
        event: "snapshot_bound",
        episodesDir,
        eventId: "evt-2",
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(EpisodeCasConflictError);
    const listed = await listPersistedEpisodes({ episodesDir });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.state).toBe("POLICY_SNAPSHOTTED");
    expect(listed[0]?.stateVersion).toBe(1);
  });
});
