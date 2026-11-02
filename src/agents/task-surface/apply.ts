/**
 * Apply the batch 7 hang-list surface to a session board and task_ledger.
 * Ledger write failure still cancels the session side and returns a batch 6
 * side_path_bypass receipt. File existence never closes a row.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveTaskContextScope } from "../../auto-reply/reply/task-context-store.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  type SessionTaskBoard,
  type TrackedTask,
} from "../../conversation-task/session-task-board.js";
import { formatSidePathBypassReceipt } from "../turn-completion/contract.js";
import {
  isHangListRequest,
  isSurfaceCancelled,
  ledgerIdsToCancel,
  parseKeepOnlyOrdinal,
  planKeepOnly,
  reconcileTaskSurface,
  type KeepOnlyPlan,
  type LedgerSurfaceRow,
  type ReconciledSurfaceItem,
  type SessionHangEntry,
} from "./surface.js";

const LEDGER_LABEL = "memory/task_ledger.json";

type SurfaceSnapshot = {
  version: 1;
  shown: ReconciledSurfaceItem[];
  lastKeepOnly?: {
    utterance: string;
    receipt: string;
    baseReceipt: string;
    cancelIds: string[];
    sessionApplied: boolean;
    ledgerApplied: boolean;
  };
};

type LedgerFile = {
  version: 1;
  updated_at: string;
  items: Array<Record<string, unknown>>;
};

export type TaskSurfaceReplyParams = {
  text: string;
  cfg?: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionFile?: string;
  /** Test hook. Default writes `memory/task_ledger.json` under the continuity root. */
  writeLedgerFile?: (absolutePath: string, data: string) => void;
  filePresentById?: Readonly<Record<string, boolean>>;
};

function snapshotPath(sessionFile: string): string {
  return `${sessionFile}.task-surface.json`;
}

function readSnapshot(sessionFile?: string): SurfaceSnapshot | undefined {
  const file = sessionFile?.trim();
  if (!file) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath(file), "utf8")) as SurfaceSnapshot;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.shown)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeSnapshot(sessionFile: string | undefined, snapshot: SurfaceSnapshot): void {
  const file = sessionFile?.trim();
  if (!file) {
    return;
  }
  fs.writeFileSync(snapshotPath(file), `${JSON.stringify(snapshot)}\n`, "utf8");
}

function hangFromBoard(board: SessionTaskBoard): SessionHangEntry[] {
  const items: SessionHangEntry[] = [];
  if (board.current?.unfinished && board.current.taskId.trim()) {
    items.push({
      id: board.current.taskId,
      title: board.current.title,
      kind: "current",
    });
  }
  for (const row of board.parked) {
    if (!row.taskId.trim()) {
      continue;
    }
    items.push({ id: row.taskId, title: row.title, kind: "parked" });
  }
  return items;
}

function ledgerRowsFromFile(file: LedgerFile): LedgerSurfaceRow[] {
  return file.items.flatMap((item) => {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) {
      return [];
    }
    const disposition = item.surface_disposition === "cancelled" ? "cancelled" : undefined;
    return [
      {
        id,
        title: typeof item.title === "string" ? item.title : id,
        status: typeof item.status === "string" ? item.status : "",
        ...(typeof item.description === "string" ? { description: item.description } : {}),
        ...(disposition ? { surface_disposition: "cancelled" } : {}),
      },
    ];
  });
}

function resolveLedgerPath(params: TaskSurfaceReplyParams): string | undefined {
  if (!params.cfg) {
    return path.join(
      params.workspaceDir,
      "memory",
      LEDGER_LABEL.split("/").pop() ?? "task_ledger.json",
    );
  }
  try {
    const scope = resolveTaskContextScope({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
    });
    return path.join(scope.rootDir, "task_ledger.json");
  } catch {
    return path.join(params.workspaceDir, "memory", "task_ledger.json");
  }
}

function readLedgerFile(ledgerPath: string | undefined): LedgerFile {
  if (!ledgerPath) {
    return { version: 1, updated_at: new Date(0).toISOString(), items: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as LedgerFile;
    if (!parsed || !Array.isArray(parsed.items)) {
      return { version: 1, updated_at: new Date(0).toISOString(), items: [] };
    }
    return parsed;
  } catch {
    return { version: 1, updated_at: new Date(0).toISOString(), items: [] };
  }
}

function applyKeepOnlyToBoard(board: SessionTaskBoard, plan: KeepOnlyPlan): SessionTaskBoard {
  if (plan.outOfRange) {
    return board;
  }
  const keptIds = new Set(
    plan.kept.map((item) => item.sessionId).filter((id): id is string => Boolean(id)),
  );
  const keptCurrent =
    board.current && keptIds.has(board.current.taskId) ? board.current : undefined;
  const keptParked = board.parked.filter((row) => keptIds.has(row.taskId));
  // Preserve focusRevision / tombstones / archived / scope from the input board (C1 shell).
  const shell: SessionTaskBoard = {
    parked: keptParked,
    focusRevision: board.focusRevision ?? 0,
    ...(board.tombstones ? { tombstones: board.tombstones } : {}),
    ...(board.archived ? { archived: board.archived } : {}),
    ...(board.scope ? { scope: board.scope } : {}),
  };
  if (keptCurrent) {
    return { ...shell, current: keptCurrent };
  }
  const promoted = keptParked[0];
  if (!promoted) {
    return { ...shell, parked: [] };
  }
  const nextCurrent: TrackedTask = { ...promoted, unfinished: true };
  delete nextCurrent.parkedAtMs;
  return {
    ...shell,
    current: nextCurrent,
    parked: keptParked.filter((row) => row.taskId !== promoted.taskId),
  };
}

function cancelLedgerItems(file: LedgerFile, cancelIds: readonly string[]): LedgerFile {
  if (cancelIds.length === 0) {
    return file;
  }
  const cancel = new Set(cancelIds);
  const now = new Date().toISOString();
  return {
    version: 1,
    updated_at: now,
    items: file.items.map((item) => {
      const id = typeof item.id === "string" ? item.id : "";
      if (!id || !cancel.has(id) || isSurfaceCancelled(item as { surface_disposition?: string })) {
        return item;
      }
      const context =
        item.context && typeof item.context === "object"
          ? (item.context as { key_points?: unknown })
          : { key_points: [] };
      const keyPoints = Array.isArray(context.key_points)
        ? context.key_points.filter((point) => typeof point === "string")
        : [];
      if (!keyPoints.includes("surface_cancelled")) {
        keyPoints.push("surface_cancelled");
      }
      return {
        ...item,
        status: "paused",
        surface_disposition: "cancelled",
        context: { ...context, key_points: keyPoints },
        updated_at: now,
      };
    }),
  };
}

/**
 * Hang-list question → reconciled display.
 * Keep-only → session cancel plus ledger cancel, or side_path_bypass when the ledger write throws.
 * Returns null when the utterance is not a task-surface command.
 */
export function replyForTaskSurfaceUtterance(params: TaskSurfaceReplyParams): string | null {
  const text = params.text.trim();
  const keepOrdinal = parseKeepOnlyOrdinal(text);
  const hangList = isHangListRequest(text);
  if (keepOrdinal == null && !hangList) {
    return null;
  }
  const sessionFile = params.sessionFile?.trim();
  const board = readSessionTaskBoard(sessionFile);
  const ledgerPath = resolveLedgerPath(params);
  const ledgerFile = readLedgerFile(ledgerPath);
  const ledgerRows = ledgerRowsFromFile(ledgerFile);
  const live = reconcileTaskSurface({
    sessionHang: hangFromBoard(board),
    ledger: ledgerRows,
  });
  const snapshot = readSnapshot(sessionFile);

  if (keepOrdinal == null) {
    writeSnapshot(sessionFile, {
      version: 1,
      shown: live.items,
      ...(snapshot?.lastKeepOnly ? { lastKeepOnly: snapshot.lastKeepOnly } : {}),
    });
    return live.displayText;
  }

  const prior = snapshot?.lastKeepOnly;
  if (prior && prior.utterance === text && prior.sessionApplied) {
    if (!prior.ledgerApplied && prior.cancelIds.length > 0 && ledgerPath) {
      const retry = writeCancelledLedger({
        ledgerPath,
        ledgerFile,
        cancelIds: prior.cancelIds,
        writeLedgerFile: params.writeLedgerFile,
      });
      if (retry.applied) {
        const receipt = prior.baseReceipt;
        writeSnapshot(sessionFile, {
          version: 1,
          shown: snapshot?.shown ?? live.items,
          lastKeepOnly: { ...prior, ledgerApplied: true, receipt },
        });
        return receipt;
      }
    }
    return prior.receipt;
  }

  const shownItems = snapshot?.shown?.length ? snapshot.shown : live.items;
  const plan = planKeepOnly(shownItems, keepOrdinal);
  const cancelIds = ledgerIdsToCancel(plan, params.filePresentById);
  let receipt = plan.receipt;
  let ledgerApplied = plan.outOfRange || cancelIds.length === 0;
  if (!plan.outOfRange && cancelIds.length > 0 && ledgerPath) {
    const written = writeCancelledLedger({
      ledgerPath,
      ledgerFile,
      cancelIds,
      writeLedgerFile: params.writeLedgerFile,
    });
    ledgerApplied = written.applied;
    if (!written.applied) {
      receipt = `${receipt}\n${written.sidePathReceipt}`;
    }
  }
  if (!plan.outOfRange && sessionFile) {
    mutateSessionTaskBoard(sessionFile, (live) => ({
      board: applyKeepOnlyToBoard(live, plan),
      value: undefined,
    }));
  }
  const nextShown = plan.outOfRange ? shownItems : plan.kept;
  writeSnapshot(sessionFile, {
    version: 1,
    shown: nextShown,
    lastKeepOnly: {
      utterance: text,
      receipt,
      baseReceipt: plan.receipt,
      cancelIds,
      sessionApplied: true,
      ledgerApplied,
    },
  });
  return receipt;
}

function writeCancelledLedger(params: {
  ledgerPath: string;
  ledgerFile: LedgerFile;
  cancelIds: readonly string[];
  writeLedgerFile?: (absolutePath: string, data: string) => void;
}): { applied: boolean; sidePathReceipt?: string } {
  if (params.cancelIds.length === 0) {
    return { applied: true };
  }
  const next = cancelLedgerItems(params.ledgerFile, params.cancelIds);
  const data = `${JSON.stringify(next, null, 2)}\n`;
  try {
    if (params.writeLedgerFile) {
      params.writeLedgerFile(params.ledgerPath, data);
    } else {
      fs.mkdirSync(path.dirname(params.ledgerPath), { recursive: true });
      fs.writeFileSync(params.ledgerPath, data, "utf8");
    }
    return { applied: true };
  } catch (err) {
    return {
      applied: false,
      sidePathReceipt: formatSidePathBypassReceipt(LEDGER_LABEL, err),
    };
  }
}
