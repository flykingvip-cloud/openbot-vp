import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RoundTransitionError, transitionRoundState } from "./round-state-machine.js";
import {
  occupancyForRoundState,
  type PersistedRound,
  type RoundRuntimeEvent,
} from "./round-state.js";
import type { RoundTransitionEvent } from "./round-state.js";
import {
  commitRoundSnapshotAndEvent,
  recoverRoundCommit,
  roundEventsPath,
  roundSnapshotPath,
  readRoundEventIds,
  withRoundLock,
  writeJsonDurable,
} from "./round-store-io.js";
import {
  assertCollaborationRuntimeWritable,
  isCollabRuntimeNamespaceEnabled,
  resolveCollaborationRuntimeFactPaths,
} from "./runtime-namespace.js";

export function resolveRoundStoreDir(params: {
  groupId: string;
  tenantId?: string | null;
  roundsDir?: string;
}) {
  // Flag off: an explicit directory is the test/fixture override and still
  // goes through the write-freeze check at the write call. Production chat
  // does not pass one, so it uses the resolver (legacy paths, namespace null).
  if (!isCollabRuntimeNamespaceEnabled() && params.roundsDir) {
    return params.roundsDir;
  }
  // P0 G7: flag on always resolves. A missing/untrusted managed tenant throws
  // RuntimeNamespaceTenantRequiredError here, before any override is used.
  const resolved = resolveCollaborationRuntimeFactPaths({
    groupId: params.groupId,
    tenantId: params.tenantId,
  }).roundsDir;
  if (params.roundsDir && path.resolve(params.roundsDir) !== path.resolve(resolved)) {
    throw new Error("P0 G7: roundsDir override cannot bypass resolveCollaborationRuntimeFactPaths");
  }
  return resolved;
}

export class RoundCasConflictError extends Error {
  readonly expectedStateVersion: number;
  readonly actualStateVersion: number;

  constructor(expectedStateVersion: number, actualStateVersion: number) {
    super(`round CAS conflict: expected ${expectedStateVersion} got ${actualStateVersion}`);
    this.name = "RoundCasConflictError";
    this.expectedStateVersion = expectedStateVersion;
    this.actualStateVersion = actualStateVersion;
  }
}

async function readSnapshotFile(filePath: string): Promise<PersistedRound | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as PersistedRound;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function readPersistedRound(params: {
  groupId: string;
  roundId: string;
  tenantId?: string | null;
  roundsDir?: string;
}): Promise<PersistedRound | null> {
  const roundsDir = resolveRoundStoreDir(params);
  return await withRoundLock(roundsDir, params.roundId, async () => {
    const recovered = await recoverRoundCommit({ roundsDir, roundId: params.roundId });
    if (recovered) {
      return recovered;
    }
    return await readSnapshotFile(roundSnapshotPath(roundsDir, params.roundId));
  });
}

export async function listPersistedRounds(params: {
  groupId: string;
  tenantId?: string | null;
  roundsDir?: string;
}): Promise<PersistedRound[]> {
  const roundsDir = resolveRoundStoreDir(params);
  let names: string[] = [];
  try {
    names = await fs.readdir(roundsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const rounds: PersistedRound[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".events.")) {
      continue;
    }
    const roundId = name.slice(0, -".json".length);
    const round = await readPersistedRound({
      groupId: params.groupId,
      roundId,
      tenantId: params.tenantId,
      roundsDir,
    });
    if (round) {
      rounds.push(round);
    }
  }
  return rounds;
}

export async function writePersistedRound(params: {
  round: PersistedRound;
  expectedStateVersion?: number;
  tenantId?: string | null;
  roundsDir?: string;
}) {
  const roundsDir = resolveRoundStoreDir({
    groupId: params.round.groupId ?? "direct",
    tenantId: params.tenantId ?? params.round.tenantId,
    roundsDir: params.roundsDir,
  });
  assertCollaborationRuntimeWritable(roundsDir);
  await fs.mkdir(roundsDir, { recursive: true });
  return await withRoundLock(roundsDir, params.round.roundId, async () => {
    await recoverRoundCommit({ roundsDir, roundId: params.round.roundId });
    if (params.expectedStateVersion != null) {
      const current = await readSnapshotFile(roundSnapshotPath(roundsDir, params.round.roundId));
      const actual = current?.stateVersion ?? 0;
      if (actual !== params.expectedStateVersion) {
        throw new RoundCasConflictError(params.expectedStateVersion, actual);
      }
    }
    await writeJsonDurable(roundSnapshotPath(roundsDir, params.round.roundId), params.round);
    return params.round;
  });
}

export function acceptRoundDispatch(params: {
  round: PersistedRound;
  dispatchId: string;
  agentId: string;
  role: PersistedRound["dispatches"][number]["role"];
}) {
  const existing = params.round.dispatches.find((entry) => entry.dispatchId === params.dispatchId);
  if (existing) {
    return {
      accepted: false as const,
      reason: "skipped_duplicate" as const,
      round: params.round,
    };
  }
  const dispatch = {
    dispatchId: params.dispatchId,
    agentId: params.agentId,
    role: params.role,
    attempt: 0,
    status: "accepted" as const,
    createdAt: Date.now(),
  };
  return {
    accepted: true as const,
    reason: "accepted" as const,
    round: {
      ...params.round,
      currentDispatchId: params.dispatchId,
      dispatches: [...params.round.dispatches, dispatch],
    },
  };
}

export async function applyRoundTransition(params: {
  round: PersistedRound;
  event: RoundTransitionEvent;
  eventType: RoundRuntimeEvent["type"];
  eventId?: string;
  dispatchId?: string;
  agentId?: string;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
  roundsDir?: string;
}) {
  const eventId = params.eventId ?? randomUUID();
  const roundsDir = resolveRoundStoreDir({
    groupId: params.round.groupId ?? "direct",
    tenantId: params.tenantId ?? params.round.tenantId,
    roundsDir: params.roundsDir,
  });
  assertCollaborationRuntimeWritable(roundsDir);
  await fs.mkdir(roundsDir, { recursive: true });

  return await withRoundLock(roundsDir, params.round.roundId, async () => {
    await recoverRoundCommit({ roundsDir, roundId: params.round.roundId });
    const disk = await readSnapshotFile(roundSnapshotPath(roundsDir, params.round.roundId));
    if (disk) {
      if (disk.stateVersion !== params.round.stateVersion) {
        throw new RoundCasConflictError(params.round.stateVersion, disk.stateVersion);
      }
      if (disk.state !== params.round.state) {
        throw new RoundCasConflictError(params.round.stateVersion, disk.stateVersion);
      }
    }
    const persistedIds = await readRoundEventIds(roundEventsPath(roundsDir, params.round.roundId));
    const seen = new Set([...(disk?.seenEventIds ?? params.round.seenEventIds), ...persistedIds]);
    if (seen.has(eventId)) {
      return { round: disk ?? params.round, skipped: true as const, eventId };
    }

    const previousState = (disk ?? params.round).state;
    let nextState;
    try {
      nextState = transitionRoundState(previousState, params.event);
    } catch (error) {
      if (error instanceof RoundTransitionError) {
        throw error;
      }
      throw error;
    }
    const base = disk ?? params.round;
    const nextVersion = base.stateVersion + 1;
    const nextRound: PersistedRound = {
      ...params.round,
      state: nextState,
      occupancy: occupancyForRoundState(nextState),
      stateVersion: nextVersion,
      updatedAt: Date.now(),
      lastEventId: eventId,
      lastEventSeq: nextVersion,
      seenEventIds: [...seen, eventId],
      abortRequested:
        params.event === "abort" || params.event === "user_next_message"
          ? true
          : params.round.abortRequested,
      abortReason:
        params.event === "user_next_message"
          ? "superseded"
          : params.event === "unmatched_expired"
            ? "mention_unmatched_expired"
            : params.event === "abort"
              ? (params.round.abortReason ?? "user_stop")
              : params.round.abortReason,
    };
    const event: RoundRuntimeEvent = {
      eventId,
      roundId: nextRound.roundId,
      sequence: nextVersion,
      timestamp: nextRound.updatedAt,
      type: params.eventType,
      previousState,
      nextState,
      ...(params.dispatchId ? { dispatchId: params.dispatchId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.payload ? { payload: params.payload } : {}),
    };
    await commitRoundSnapshotAndEvent({
      roundsDir,
      snapshot: nextRound,
      event,
    });
    return { round: nextRound, skipped: false as const, eventId };
  });
}

export function createPersistedRound(
  params: Omit<
    PersistedRound,
    | "occupancy"
    | "seenEventIds"
    | "dispatches"
    | "completedDispatchIds"
    | "abortRequested"
    | "lastEventSeq"
    | "retryCount"
    | "stateVersion"
    | "createdAt"
    | "updatedAt"
  > &
    Partial<PersistedRound>,
): PersistedRound {
  const now = Date.now();
  return {
    completedDispatchIds: [],
    dispatches: [],
    abortRequested: false,
    lastEventSeq: 0,
    retryCount: 0,
    seenEventIds: [],
    stateVersion: 0,
    occupancy: occupancyForRoundState(params.state),
    ...params,
    createdAt: params.createdAt ?? now,
    updatedAt: now,
  };
}
