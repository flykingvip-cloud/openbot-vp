/**
 * L2 MVP — progress strip beside a long-running collab/task.
 * Reuses SessionTaskBoard-shaped SoT (and optional group board claim rows).
 * Does not invent a parallel board store.
 */

export type LongTaskBoardItemLike = {
  itemId?: string;
  title?: string | null;
  status?: string | null;
  updatedAt?: number | null;
  publishedAt?: number | null;
  appliedAt?: number | null;
  claimedAt?: number | null;
  inProgressAt?: number | null;
  acceptedAt?: number | null;
};

export type LongTaskTrackedTaskLike = {
  taskId: string;
  title: string;
  unfinished?: boolean;
  deliverableChecked?: boolean;
  parkedAtMs?: number;
  createdAtMs?: number;
};

export type LongTaskSessionBoardLike = {
  current?: LongTaskTrackedTaskLike | null;
  parked?: readonly LongTaskTrackedTaskLike[] | null;
};

export type LongTaskBoardProgress = {
  doneCount: number;
  doneTitles: string[];
  activeCount: number;
  currentBlocker: string | null;
  lastPersistAtMs: number | null;
};

const DONE_STATUSES = new Set(["accepted", "cancelled", "done", "completed"]);
const ACTIVE_STATUSES = new Set(["published", "claimed", "applied", "in_progress", "blocked"]);

function activityAt(item: LongTaskBoardItemLike): number {
  const times = [
    item.updatedAt,
    item.inProgressAt,
    item.claimedAt,
    item.appliedAt,
    item.acceptedAt,
    item.publishedAt,
  ];
  let max = 0;
  for (const t of times) {
    if (typeof t === "number" && Number.isFinite(t) && t > max) {
      max = t;
    }
  }
  return max;
}

function titleOf(item: LongTaskBoardItemLike): string {
  const t = item.title?.trim();
  if (t) {
    return t;
  }
  return item.itemId?.trim() || "item";
}

/**
 * Prefer group board claim inventory when provided; else SessionTaskBoard.
 */
export function summarizeLongTaskBoardProgress(params: {
  sessionBoard?: LongTaskSessionBoardLike | null;
  groupBoardItems?: readonly LongTaskBoardItemLike[] | null;
  /** Optional human-readable blocker override (e.g. incident reason). */
  blockerOverride?: string | null;
}): LongTaskBoardProgress {
  const items = params.groupBoardItems ?? [];
  if (items.length > 0) {
    const done = items.filter((i) => DONE_STATUSES.has((i.status ?? "").trim()));
    const active = items.filter((i) => ACTIVE_STATUSES.has((i.status ?? "").trim()));
    const blocked = items.find((i) => (i.status ?? "").trim() === "blocked");
    const primaryActive = active[0] ?? null;
    let lastPersistAtMs: number | null = null;
    for (const i of items) {
      const at = activityAt(i);
      if (at > 0 && (lastPersistAtMs == null || at > lastPersistAtMs)) {
        lastPersistAtMs = at;
      }
    }
    const currentBlocker =
      (params.blockerOverride ?? "").trim() ||
      (blocked ? `blocked: ${titleOf(blocked)}` : null) ||
      (primaryActive ? `in progress: ${titleOf(primaryActive)} (${primaryActive.status})` : null);
    return {
      doneCount: done.length,
      doneTitles: done.map(titleOf).slice(0, 8),
      activeCount: active.length,
      currentBlocker,
      lastPersistAtMs,
    };
  }

  const board = params.sessionBoard ?? { parked: [] };
  const parked = board.parked ?? [];
  const current = board.current ?? null;
  const doneTitles: string[] = [];
  let doneCount = 0;
  let lastPersistAtMs: number | null = null;

  const consider = (task: LongTaskTrackedTaskLike | null | undefined) => {
    if (!task) {
      return;
    }
    const stamp = task.parkedAtMs ?? task.createdAtMs ?? null;
    if (typeof stamp === "number" && (lastPersistAtMs == null || stamp > lastPersistAtMs)) {
      lastPersistAtMs = stamp;
    }
    if (task.unfinished === false || task.deliverableChecked === true) {
      doneCount += 1;
      doneTitles.push(task.title);
    }
  };
  consider(current ?? undefined);
  for (const p of parked) {
    consider(p);
  }

  const unfinishedCurrent = current && current.unfinished !== false ? current : null;
  const unfinishedParked = parked.filter((p) => p.unfinished !== false);
  const currentBlocker =
    (params.blockerOverride ?? "").trim() ||
    (unfinishedCurrent ? `current: ${unfinishedCurrent.title}` : null) ||
    (unfinishedParked[0] ? `parked: ${unfinishedParked[0].title}` : null);

  return {
    doneCount,
    doneTitles: doneTitles.slice(0, 8),
    activeCount: (unfinishedCurrent ? 1 : 0) + unfinishedParked.length,
    currentBlocker,
    lastPersistAtMs,
  };
}

export function formatLongTaskBoardProgressLine(progress: LongTaskBoardProgress): string {
  const done =
    progress.doneCount === 0
      ? "done 0"
      : `done ${progress.doneCount}${
          progress.doneTitles.length ? ` (${progress.doneTitles.slice(0, 3).join(", ")})` : ""
        }`;
  const blocker = progress.currentBlocker ?? "no blocker";
  const persist =
    progress.lastPersistAtMs != null
      ? `last persist ${new Date(progress.lastPersistAtMs).toISOString()}`
      : "last persist unknown";
  return `${done} · ${blocker} · ${persist}`;
}
