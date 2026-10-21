/**
 * Batch 7 — one hang-list surface for every bot.
 *
 * Session ordinals are what the user is pointing at. Ledger rows are reconciled
 * onto those ordinals and marked 未入账 when they are not booked. 「只保留第 N 条」
 * executes against that shown list. A mismatch never becomes a second question.
 */

export const TASK_SURFACE_CONTINUITY_LINE =
  "Task surface: hang-list ordinals are the session list reconciled with task_ledger. A row missing from the ledger is marked 未入账. 「只保留第 N 条」uses that ordinal. Do not ask the user which row they meant.";

export const UNBOOKED_MARK = "未入账";

export const ORDINAL_QUIZ_RE =
  /第\s*[0-9一二三四五六七八九十]+\s*条(?:是不是|指的是|是哪)|请你确认|你选择哪一种|如果第\s*[0-9一二三四五六七八九十]+\s*条指|不会直接清除任务/u;

const CN_ORDINALS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const KEEP_ONLY_INTENT_RE = /只保留|只留|仅保留|只留下|其它都清|其他都清|都清掉|keep\s+only/iu;

const HANG_LIST_RE = /挂着的任务|挂起的任务|挂起任务|有哪些挂起|现在挂着/u;

export type TaskSurfaceSource = "session" | "ledger" | "restore" | "heartbeat";

export type SessionHangEntry = {
  id: string;
  title: string;
  kind: "current" | "parked";
};

export type LedgerSurfaceRow = {
  id: string;
  title: string;
  status: string;
  description?: string;
  surface_disposition?: "cancelled";
};

export type ReconciledSurfaceItem = {
  ordinal: number;
  title: string;
  sessionId?: string;
  ledgerId?: string;
  booked: boolean;
  source: TaskSurfaceSource;
  mark: "" | typeof UNBOOKED_MARK;
};

export type ReconciledTaskSurface = {
  items: ReconciledSurfaceItem[];
  inconsistent: boolean;
  /** Ledger rows that were not given a session ordinal. */
  unlistedLedgerIds: string[];
  displayText: string;
};

export type KeepOnlyPlan = {
  ordinal: number;
  kept: ReconciledSurfaceItem[];
  cancelled: ReconciledSurfaceItem[];
  outOfRange: boolean;
  shownCount: number;
  receipt: string;
  asksUser: false;
};

export function isSurfaceCancelled(
  row: { surface_disposition?: string } | null | undefined,
): boolean {
  return row?.surface_disposition === "cancelled";
}

export function parseKeepOnlyOrdinal(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || !KEEP_ONLY_INTENT_RE.test(trimmed)) {
    return null;
  }
  const digit = /第\s*(\d{1,2})\s*条/u.exec(trimmed);
  if (digit?.[1]) {
    const ordinal = Number(digit[1]);
    return ordinal > 0 ? ordinal : null;
  }
  const cn = /第\s*([一二三四五六七八九十])\s*条/u.exec(trimmed);
  if (cn?.[1]) {
    return CN_ORDINALS[cn[1]] ?? null;
  }
  const en = /keep\s+only(?:\s+the)?\s+(\d{1,2})(?:st|nd|rd|th)?\b/iu.exec(trimmed);
  if (en?.[1]) {
    const ordinal = Number(en[1]);
    return ordinal > 0 ? ordinal : null;
  }
  return null;
}

export function isHangListRequest(text: string): boolean {
  return HANG_LIST_RE.test(text);
}

export function isTaskSurfaceUtterance(text: string): boolean {
  return parseKeepOnlyOrdinal(text) != null || isHangListRequest(text);
}

/** True when the utterance is the surface command, not a deliverable request that also mentions it. */
export function isPrimarilyTaskSurfaceUtterance(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (isHangListRequest(trimmed) && parseKeepOnlyOrdinal(trimmed) == null) {
    return trimmed.length <= 40;
  }
  if (parseKeepOnlyOrdinal(trimmed) == null) {
    return false;
  }
  const rest = trimmed
    .replace(/只保留第\s*[0-9一二三四五六七八九十]+\s*条/gu, "")
    .replace(/只留第\s*[0-9一二三四五六七八九十]+\s*条/gu, "")
    .replace(/仅保留第\s*[0-9一二三四五六七八九十]+\s*条/gu, "")
    .replace(/keep\s+only(?:\s+the)?\s+\d{1,2}(?:st|nd|rd|th)?/giu, "")
    .replace(/其它都清掉|其他都清掉|其余都清掉|都清掉|其余清掉/gu, "")
    .replace(/[，,。.!！？?\s]/gu, "");
  return rest.length <= 8;
}

export function isOrdinalClarificationQuiz(text: string): boolean {
  return ORDINAL_QUIZ_RE.test(text);
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[「」"'`“”]/gu, "");
}

function titlesMatch(left: string, right: string): boolean {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 8) {
    return false;
  }
  return longer.includes(shorter);
}

function isOpenLedgerRow(row: LedgerSurfaceRow): boolean {
  if (isSurfaceCancelled(row)) {
    return false;
  }
  return row.status === "active" || row.status === "paused";
}

export function reconcileTaskSurface(params: {
  sessionHang: readonly SessionHangEntry[];
  ledger: readonly LedgerSurfaceRow[];
}): ReconciledTaskSurface {
  const openLedger = params.ledger.filter(isOpenLedgerRow);
  const used = new Set<string>();
  const items: ReconciledSurfaceItem[] = [];
  params.sessionHang.forEach((entry, index) => {
    const title = entry.title.trim() || entry.id;
    const match = openLedger.find((row) => {
      if (used.has(row.id)) {
        return false;
      }
      if (row.id === entry.id) {
        return true;
      }
      return titlesMatch(title, row.title) || titlesMatch(title, row.description ?? "");
    });
    if (match) {
      used.add(match.id);
    }
    const booked = Boolean(match);
    items.push({
      ordinal: index + 1,
      title,
      sessionId: entry.id,
      ...(match ? { ledgerId: match.id } : {}),
      booked,
      source: booked ? "ledger" : "session",
      mark: booked ? "" : UNBOOKED_MARK,
    });
  });
  const unlistedLedgerIds = openLedger.filter((row) => !used.has(row.id)).map((row) => row.id);
  const inconsistent = items.some((item) => !item.booked) || unlistedLedgerIds.length > 0;
  return {
    items,
    inconsistent,
    unlistedLedgerIds,
    displayText: formatTaskSurfaceDisplay(items),
  };
}

export function formatTaskSurfaceDisplay(items: readonly ReconciledSurfaceItem[]): string {
  if (items.length === 0) {
    return "当前没有挂起任务。";
  }
  const lines = ["挂起任务（会话序号，已与 task_ledger 对账）："];
  for (const item of items) {
    const tag = item.booked && item.ledgerId ? item.ledgerId : UNBOOKED_MARK;
    lines.push(`${item.ordinal}. ${item.title}（${tag}）`);
  }
  return lines.join("\n");
}

export function displaySurfaceId(item: ReconciledSurfaceItem): string {
  const id =
    item.ledgerId ?? (item.sessionId ? `session:${item.sessionId}` : `ordinal:${item.ordinal}`);
  return item.booked ? id : `${id}（${UNBOOKED_MARK}）`;
}

/**
 * Cancel ids for the other shown ordinals.
 * `filePresentById` is accepted and ignored: a workspace file is not a close.
 */
export function ledgerIdsToCancel(
  plan: Pick<KeepOnlyPlan, "cancelled">,
  filePresentById?: Readonly<Record<string, boolean>>,
): string[] {
  void filePresentById;
  const ids: string[] = [];
  for (const item of plan.cancelled) {
    if (item.ledgerId && !ids.includes(item.ledgerId)) {
      ids.push(item.ledgerId);
    }
  }
  return ids;
}

export function planKeepOnly(
  items: readonly ReconciledSurfaceItem[],
  ordinal: number,
): KeepOnlyPlan {
  const shownCount = items.length;
  const kept = items.filter((item) => item.ordinal === ordinal);
  const outOfRange = kept.length === 0;
  const cancelled = outOfRange ? [] : items.filter((item) => item.ordinal !== ordinal);
  const receipt = outOfRange
    ? `当前展示只有 ${shownCount} 条。序号 ${ordinal} 不在这份列表里，未改动。`
    : [
        `已按当前展示序号保留第 ${ordinal} 条。`,
        `保留：${kept.map(displaySurfaceId).join("、") || "（无）"}`,
        `取消：${cancelled.map(displaySurfaceId).join("、") || "（无）"}`,
      ].join("\n");
  return {
    ordinal,
    kept,
    cancelled,
    outOfRange,
    shownCount,
    receipt,
    asksUser: false,
  };
}

export function labelGhostInjection(params: {
  source: "ledger" | "restore" | "heartbeat";
  taskId?: string;
  title: string;
}): string {
  const id = params.taskId?.trim() ? ` id=${params.taskId.trim()}` : "";
  const title = params.title.trim();
  return title ? `[source=${params.source}${id}] ${title}` : `[source=${params.source}${id}]`;
}

function utteranceRelatesToTitle(utterance: string, title: string): boolean {
  const normalizedTitle = normalizeTitle(title);
  const normalizedUtterance = normalizeTitle(utterance);
  if (!normalizedTitle || !normalizedUtterance) {
    return false;
  }
  if (
    normalizedUtterance.includes(normalizedTitle) ||
    normalizedTitle.includes(normalizedUtterance)
  ) {
    const shorter = Math.min(normalizedTitle.length, normalizedUtterance.length);
    if (shorter >= 4) {
      return true;
    }
  }
  const slices: string[] = [];
  for (let index = 0; index + 4 <= normalizedTitle.length; index += 4) {
    slices.push(normalizedTitle.slice(index, index + 4));
    if (slices.length >= 4) {
      break;
    }
  }
  return slices.some((slice) => slice.length >= 4 && normalizedUtterance.includes(slice));
}

/**
 * Non-mainline heartbeat / restore / ledger injections that are unrelated to
 * the current user utterance are omitted. The bound mainline task stays.
 */
export function ghostInjectionShouldOmit(params: {
  source: "ledger" | "restore" | "heartbeat";
  taskId?: string;
  title: string;
  userUtterance?: string;
  mainlineTaskId?: string;
}): boolean {
  if (params.mainlineTaskId && params.taskId && params.taskId === params.mainlineTaskId) {
    return false;
  }
  const utterance = params.userUtterance?.trim() ?? "";
  if (!utterance) {
    return true;
  }
  if (isHangListRequest(utterance) || parseKeepOnlyOrdinal(utterance) != null) {
    return false;
  }
  return !utteranceRelatesToTitle(utterance, params.title);
}

export function presentNonMainlineInjection(params: {
  text: string;
  taskId: string;
  title: string;
  source: "ledger" | "restore" | "heartbeat";
  /** Undefined keeps the historical injection (callers that have no utterance). */
  userUtterance?: string;
  mainline?: boolean;
  cancelled?: boolean;
}): string {
  if (!params.text.trim() || params.cancelled) {
    return "";
  }
  if (params.mainline) {
    return params.text;
  }
  if (params.userUtterance === undefined) {
    return params.text;
  }
  if (
    ghostInjectionShouldOmit({
      source: params.source,
      taskId: params.taskId,
      title: params.title,
      userUtterance: params.userUtterance,
    })
  ) {
    return "";
  }
  return `${labelGhostInjection({ source: params.source, taskId: params.taskId, title: params.title })}\n${params.text}`;
}
