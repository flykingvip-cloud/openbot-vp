/**
 * Floor Runtime v2.1 §5.6 P1-B① — Episode store + recoverIncompleteEpisodes.
 *
 * Layout: `<ns>/episodes/<episodeId>/{episode.json, events.jsonl, bids.jsonl, admission.jsonl}`
 * Lock/durable write primitives: reused from `round-store-io.ts` ONLY.
 * MUST NOT import round-store write functions; MUST NEVER read/write round dirs.
 *
 * Flag: `collaboration.episodeStore` (plan `collab.episodeStore`), default OFF.
 * When off, `recoverIncompleteEpisodes` is a no-op and the single-beat runtime
 * does not write. When on, `episode-single-beat-runtime.ts` may persist here,
 * including Facilitator gate results stamped at FACILITATOR_OBSERVE (P0 G3).
 * Flag-off production stays byte-for-byte unchanged.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  canTransitionEpisodeState,
  EpisodeTransitionError,
  transitionEpisodeState,
} from "./episode-state-machine.js";
import {
  isEpisodeTerminal,
  type EpisodeCloseReason,
  type EpisodeCommit,
  type EpisodeEventType,
  type EpisodeRuntimeEvent,
  type EpisodeTransitionEvent,
  type PersistedEpisode,
} from "./episode-state.js";
import { appendJsonlDurable, withRoundLock, writeJsonDurable } from "./round-store-io.js";

/** Plan flag `collab.episodeStore` → config `collaboration.episodeStore` (default false). */
export function isCollabEpisodeStoreEnabled(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.episodeStore === true;
}

export function episodeDir(episodesDir: string, episodeId: string): string {
  return path.join(episodesDir, episodeId);
}

export function episodeSnapshotPath(episodesDir: string, episodeId: string): string {
  return path.join(episodeDir(episodesDir, episodeId), "episode.json");
}

export function episodeEventsPath(episodesDir: string, episodeId: string): string {
  return path.join(episodeDir(episodesDir, episodeId), "events.jsonl");
}

export function episodeBidsPath(episodesDir: string, episodeId: string): string {
  return path.join(episodeDir(episodesDir, episodeId), "bids.jsonl");
}

export function episodeAdmissionPath(episodesDir: string, episodeId: string): string {
  return path.join(episodeDir(episodesDir, episodeId), "admission.jsonl");
}

export function episodeTxnPath(episodesDir: string, episodeId: string): string {
  return path.join(episodesDir, `${episodeId}.txn`);
}

export class EpisodeCasConflictError extends Error {
  readonly expectedStateVersion: number;
  readonly actualStateVersion: number;

  constructor(expectedStateVersion: number, actualStateVersion: number) {
    super(`episode CAS conflict: expected ${expectedStateVersion} got ${actualStateVersion}`);
    this.name = "EpisodeCasConflictError";
    this.expectedStateVersion = expectedStateVersion;
    this.actualStateVersion = actualStateVersion;
  }
}

async function readSnapshotFile(filePath: string): Promise<PersistedEpisode | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as PersistedEpisode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readEpisodeEventIds(eventsPath: string): Promise<Set<string>> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
  const ids = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { eventId?: unknown };
      if (typeof parsed.eventId === "string" && parsed.eventId.trim()) {
        ids.add(parsed.eventId);
      }
    } catch {
      // skip corrupt line
    }
  }
  return ids;
}

function isEpisodeCommit(value: unknown): value is EpisodeCommit {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { snapshot?: unknown; event?: unknown };
  return Boolean(record.snapshot && record.event && typeof record.event === "object");
}

async function readPendingEpisodeCommit(txnPath: string): Promise<EpisodeCommit | null> {
  try {
    const raw = await fs.readFile(txnPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isEpisodeCommit(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function finishEpisodeCommit(params: {
  episodesDir: string;
  episodeId: string;
  commit: EpisodeCommit;
}): Promise<void> {
  const eventsPath = episodeEventsPath(params.episodesDir, params.episodeId);
  const snapshotPath = episodeSnapshotPath(params.episodesDir, params.episodeId);
  const txnPath = episodeTxnPath(params.episodesDir, params.episodeId);
  const ids = await readEpisodeEventIds(eventsPath);
  if (!ids.has(params.commit.event.eventId)) {
    await appendJsonlDurable(eventsPath, params.commit.event);
  }
  await writeJsonDurable(snapshotPath, params.commit.snapshot);
  try {
    await fs.unlink(txnPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function recoverEpisodeCommit(params: {
  episodesDir: string;
  episodeId: string;
}): Promise<PersistedEpisode | null> {
  const commit = await readPendingEpisodeCommit(
    episodeTxnPath(params.episodesDir, params.episodeId),
  );
  if (!commit) {
    return null;
  }
  await finishEpisodeCommit({ ...params, commit });
  return commit.snapshot;
}

export function createPersistedEpisode(params: {
  episodeId: string;
  groupId: string;
  tenantId?: string | null;
  parentEpisodeId?: string | null;
  protocol?: PersistedEpisode["protocol"];
  policySnapshotId?: string | null;
  policyHash?: string | null;
  provenanceHash?: string | null;
  compilerRevision?: string | null;
  state?: PersistedEpisode["state"];
  beats?: PersistedEpisode["beats"];
  legacyDecisionRef?: string | null;
  now?: number;
  key?: PersistedEpisode["key"];
}): PersistedEpisode {
  const now = params.now ?? Date.now();
  return {
    episodeId: params.episodeId,
    groupId: params.groupId,
    tenantId: params.tenantId ?? null,
    parentEpisodeId: params.parentEpisodeId ?? null,
    protocol: params.protocol ?? "legacy",
    state: params.state ?? "EPISODE_CREATED",
    stateVersion: 0,
    closeReason: null,
    policySnapshotId: params.policySnapshotId ?? null,
    policyHash: params.policyHash ?? null,
    provenanceHash: params.provenanceHash ?? null,
    compilerRevision: params.compilerRevision ?? null,
    beats: params.beats ? [...params.beats] : [],
    legacyDecisionRef: params.legacyDecisionRef ?? null,
    createdAt: now,
    updatedAt: now,
    key: params.key ?? null,
  };
}

/**
 * Persist the initial snapshot if this episode id has no record yet.
 * Does not read or write round directories. A present snapshot wins (no clobber).
 */
export async function seedPersistedEpisode(params: {
  episodesDir: string;
  episode: PersistedEpisode;
}): Promise<PersistedEpisode> {
  return await withRoundLock(params.episodesDir, params.episode.episodeId, async () => {
    const recovered = await recoverEpisodeCommit({
      episodesDir: params.episodesDir,
      episodeId: params.episode.episodeId,
    });
    if (recovered) {
      return recovered;
    }
    const existing = await readSnapshotFile(
      episodeSnapshotPath(params.episodesDir, params.episode.episodeId),
    );
    if (existing) {
      return existing;
    }
    await writeJsonDurable(
      episodeSnapshotPath(params.episodesDir, params.episode.episodeId),
      params.episode,
    );
    return params.episode;
  });
}

/**
 * Attach Facilitator gate results to the current snapshot without a transition.
 * State version stays put so the next CAS transition can proceed.
 * Does not read or write round directories.
 */
export async function stampEpisodeFacilitator(params: {
  episodesDir: string;
  episode: PersistedEpisode;
  facilitator: NonNullable<PersistedEpisode["facilitator"]>;
}): Promise<PersistedEpisode> {
  return await withRoundLock(params.episodesDir, params.episode.episodeId, async () => {
    const current =
      (await readSnapshotFile(episodeSnapshotPath(params.episodesDir, params.episode.episodeId))) ??
      params.episode;
    if (current.stateVersion !== params.episode.stateVersion) {
      throw new EpisodeCasConflictError(params.episode.stateVersion, current.stateVersion);
    }
    const next: PersistedEpisode = {
      ...current,
      facilitator: params.facilitator.map((item) => ({
        actionId: item.actionId,
        outcome: item.outcome,
      })),
    };
    await writeJsonDurable(episodeSnapshotPath(params.episodesDir, next.episodeId), next);
    return next;
  });
}

/**
 * Create a legacy 1-beat Episode already past E0 (POLICY_SNAPSHOTTED) with beat 0
 * bound to `roundId` (design §5.6 / §2.4: beat 0 roundId === clientRunId).
 */
export function createLegacyOneBeatEpisode(params: {
  episodeId: string;
  groupId: string;
  roundId: string;
  tenantId?: string | null;
  policySnapshotId: string;
  policyHash?: string | null;
  provenanceHash?: string | null;
  compilerRevision?: string | null;
  legacyDecisionRef?: string | null;
  now?: number;
  key?: PersistedEpisode["key"];
}): PersistedEpisode {
  const now = params.now ?? Date.now();
  return createPersistedEpisode({
    episodeId: params.episodeId,
    groupId: params.groupId,
    tenantId: params.tenantId,
    protocol: "legacy",
    state: "POLICY_SNAPSHOTTED",
    policySnapshotId: params.policySnapshotId,
    policyHash: params.policyHash ?? null,
    provenanceHash: params.provenanceHash ?? null,
    compilerRevision: params.compilerRevision ?? null,
    legacyDecisionRef: params.legacyDecisionRef ?? null,
    beats: [
      {
        beatId: `${params.episodeId}:b0`,
        beatIndex: 0,
        roundId: params.roundId,
      },
    ],
    now,
    key: params.key,
  });
}

export async function readPersistedEpisode(params: {
  episodesDir: string;
  episodeId: string;
}): Promise<PersistedEpisode | null> {
  return await withRoundLock(params.episodesDir, params.episodeId, async () => {
    const recovered = await recoverEpisodeCommit(params);
    if (recovered) {
      return recovered;
    }
    return await readSnapshotFile(episodeSnapshotPath(params.episodesDir, params.episodeId));
  });
}

export async function listPersistedEpisodes(params: {
  episodesDir: string;
}): Promise<PersistedEpisode[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(params.episodesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const episodes: PersistedEpisode[] = [];
  for (const name of names) {
    // Episode dirs only (skip locks / txns / stray files).
    if (name.includes(".") || name.endsWith(".lock") || name.endsWith(".txn")) {
      continue;
    }
    const episode = await readPersistedEpisode({
      episodesDir: params.episodesDir,
      episodeId: name,
    });
    if (episode) {
      episodes.push(episode);
    }
  }
  return episodes;
}

function closeReasonForTransition(
  event: EpisodeTransitionEvent,
  explicit?: EpisodeCloseReason | null,
): EpisodeCloseReason | null {
  if (explicit) {
    return explicit;
  }
  switch (event) {
    case "notice_sent":
      return "waiting_user";
    case "none_eligible":
      return "no_eligible";
    case "nobody":
      return "silent";
    case "parked":
      return "awaiting_human";
    case "committed":
      return "completed";
    case "abort":
      return "aborted";
    case "fuse":
      return "fuse_tripped";
    case "budget_exhausted":
      return "budget_exhausted";
    default:
      return null;
  }
}

function eventTypeForTransition(
  event: EpisodeTransitionEvent,
  toState: PersistedEpisode["state"],
): EpisodeEventType {
  switch (event) {
    case "snapshot_bound":
      return "POLICY_SNAPSHOTTED";
    case "resolve_context":
      return "CONTEXT_RESOLVED";
    case "classified":
      return "INTENT_CLASSIFIED";
    case "unmatched_mention":
    case "notice_sent":
      return toState === "EPISODE_CLOSED" ? "EPISODE_CLOSED" : "WAITING_USER";
    case "eligibility":
      return "PARTICIPANT_ELIGIBILITY";
    case "ranked":
    case "admitted":
    case "nobody":
      return toState === "EPISODE_CLOSED" ? "EPISODE_CLOSED" : "BID_ADMISSION";
    case "none_eligible":
      return "EPISODE_CLOSED";
    case "beat_done":
      return "BEAT_COMPLETED";
    case "next_beat":
    case "authorized_action":
    case "redirect":
    case "handoff_proposed":
    case "route_to_task_governance":
    case "converged":
    case "stop_loop":
    case "no_new_value":
    case "budget_exhausted":
      return toState === "GOVERNANCE_GATE" ? "GOVERNANCE_GATE" : "FACILITATOR_OBSERVE";
    case "needs_human":
      return "WAIT_HUMAN";
    case "parked":
      return "EPISODE_CLOSED";
    case "pass":
    case "nothing_to_commit":
      return "COMMIT";
    case "committed":
      return "EPISODE_CLOSED";
    case "abort":
      return "EPISODE_ABORTED";
    case "fuse":
      return "EMERGENCY_FUSE_TRIPPED";
    case "recover":
      return "EPISODE_ABORTED_ON_RESTART";
    default:
      return "EPISODE_CREATED";
  }
}

export async function applyEpisodeTransition(params: {
  episode: PersistedEpisode;
  event: EpisodeTransitionEvent;
  episodesDir: string;
  eventId?: string;
  eventType?: EpisodeEventType;
  closeReason?: EpisodeCloseReason | null;
  legacyDecisionRef?: string | null;
  note?: string | null;
  now?: number;
}): Promise<{ episode: PersistedEpisode; skipped: boolean }> {
  const { episodesDir } = params;
  return await withRoundLock(episodesDir, params.episode.episodeId, async () => {
    // Finish any in-flight txn first (crash recovery for one-commit).
    await recoverEpisodeCommit({
      episodesDir,
      episodeId: params.episode.episodeId,
    });
    const current =
      (await readSnapshotFile(episodeSnapshotPath(episodesDir, params.episode.episodeId))) ??
      params.episode;

    if (current.stateVersion !== params.episode.stateVersion) {
      throw new EpisodeCasConflictError(params.episode.stateVersion, current.stateVersion);
    }

    if (!canTransitionEpisodeState(current.state, params.event)) {
      throw new EpisodeTransitionError(current.state, params.event);
    }

    const toState = transitionEpisodeState(current.state, params.event);
    const now = params.now ?? Date.now();
    const closeReason =
      toState === "EPISODE_CLOSED"
        ? closeReasonForTransition(params.event, params.closeReason)
        : toState === "ABORTED_ON_RESTART"
          ? null
          : (current.closeReason ?? null);

    const next: PersistedEpisode = {
      ...current,
      state: toState,
      stateVersion: current.stateVersion + 1,
      closeReason,
      updatedAt: now,
      legacyDecisionRef:
        params.legacyDecisionRef !== undefined
          ? params.legacyDecisionRef
          : current.legacyDecisionRef,
    };

    const eventId = params.eventId ?? randomUUID();
    const eventsPath = episodeEventsPath(episodesDir, next.episodeId);
    const ids = await readEpisodeEventIds(eventsPath);
    if (ids.has(eventId)) {
      return { episode: current, skipped: true };
    }

    const runtimeEvent: EpisodeRuntimeEvent = {
      eventId,
      eventType: params.eventType ?? eventTypeForTransition(params.event, toState),
      at: now,
      fromState: current.state,
      toState,
      transition: params.event,
      episodeId: next.episodeId,
      beatId: next.beats[0]?.beatId ?? null,
      closeReason,
      note: params.note ?? null,
      key: next.key ?? null,
    };

    const commit: EpisodeCommit = { snapshot: next, event: runtimeEvent };
    await writeJsonDurable(episodeTxnPath(episodesDir, next.episodeId), commit);
    await finishEpisodeCommit({
      episodesDir,
      episodeId: next.episodeId,
      commit,
    });
    return { episode: next, skipped: false };
  });
}

/**
 * Design §3.3 / §5.6: non-terminal Episode → ABORTED_ON_RESTART.
 * Never reads or writes round dirs. Flag-off → no-op.
 */
export async function recoverIncompleteEpisodes(params: {
  episodesDir: string;
  cfg?: OpenBotConfig;
  skipEpisodeIds?: Iterable<string>;
  now?: number;
}): Promise<{ recovered: number; scanned: number }> {
  if (!isCollabEpisodeStoreEnabled(params.cfg)) {
    return { recovered: 0, scanned: 0 };
  }
  const skip = new Set(params.skipEpisodeIds ?? []);
  const episodes = await listPersistedEpisodes({ episodesDir: params.episodesDir });
  let recovered = 0;
  for (const episode of episodes) {
    if (skip.has(episode.episodeId)) {
      continue;
    }
    if (isEpisodeTerminal(episode.state)) {
      continue;
    }
    await applyEpisodeTransition({
      episode,
      event: "recover",
      episodesDir: params.episodesDir,
      eventType: "EPISODE_ABORTED_ON_RESTART",
      note: "EpisodeAbortedOnRestart",
      now: params.now,
    });
    recovered += 1;
  }
  return { recovered, scanned: episodes.length };
}

export { EpisodeTransitionError };
