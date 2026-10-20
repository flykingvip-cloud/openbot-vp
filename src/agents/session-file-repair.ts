import fs from "node:fs/promises";
import path from "node:path";
import { healBareTranscriptEntries } from "./session-transcript-entry.js";

type RepairReport = {
  repaired: boolean;
  droppedLines: number;
  /** Legacy bare `{ message }` lines converted to typed session entries. */
  convertedBareLines?: number;
  /** Entries whose omitted `parentId` was re-linked after a bare line. */
  relinkedParents?: number;
  backupPath?: string;
  reason?: string;
};

function isSessionHeader(entry: unknown): entry is { type: string; id: string } {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const record = entry as { type?: unknown; id?: unknown };
  return record.type === "session" && typeof record.id === "string" && record.id.length > 0;
}

/**
 * Repair a session JSONL file in place. Callers hold the session write lock
 * (attempt/compact). Writes go to a temp file + rename after a full backup,
 * and the rename is skipped if the file changed while we were working.
 */
export async function repairSessionFileIfNeeded(params: {
  sessionFile: string;
  warn?: (message: string) => void;
}): Promise<RepairReport> {
  const sessionFile = params.sessionFile.trim();
  if (!sessionFile) {
    return { repaired: false, droppedLines: 0, reason: "missing session file" };
  }

  let content: string;
  let statBefore: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    statBefore = await fs.stat(sessionFile);
    content = await fs.readFile(sessionFile, "utf-8");
  } catch (err) {
    const code = (err as { code?: unknown } | undefined)?.code;
    if (code === "ENOENT") {
      return { repaired: false, droppedLines: 0, reason: "missing session file" };
    }
    const reason = `failed to read session file: ${err instanceof Error ? err.message : "unknown error"}`;
    params.warn?.(`session file repair skipped: ${reason} (${path.basename(sessionFile)})`);
    return { repaired: false, droppedLines: 0, reason };
  }

  const lines = content.split(/\r?\n/);
  const entries: unknown[] = [];
  let droppedLines = 0;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
    } catch {
      droppedLines += 1;
    }
  }

  if (entries.length === 0) {
    return { repaired: false, droppedLines, reason: "empty session file" };
  }

  if (!isSessionHeader(entries[0])) {
    params.warn?.(
      `session file repair skipped: invalid session header (${path.basename(sessionFile)})`,
    );
    return { repaired: false, droppedLines, reason: "invalid session header" };
  }

  // Legacy gateway early-persist wrote bare `{ message }` lines that re-root
  // the SessionManager tree on reload; heal them into typed, chained entries.
  const healed = healBareTranscriptEntries(entries);
  const { convertedBareLines, relinkedParents } = healed;

  if (droppedLines === 0 && convertedBareLines === 0 && relinkedParents === 0) {
    return { repaired: false, droppedLines: 0 };
  }

  const cleaned = `${healed.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const backupPath = `${sessionFile}.bak-${process.pid}-${Date.now()}`;
  const tmpPath = `${sessionFile}.repair-${process.pid}-${Date.now()}.tmp`;
  try {
    const stat = await fs.stat(sessionFile).catch(() => null);
    await fs.writeFile(backupPath, content, "utf-8");
    if (stat) {
      await fs.chmod(backupPath, stat.mode);
    }
    await fs.writeFile(tmpPath, cleaned, "utf-8");
    if (stat) {
      await fs.chmod(tmpPath, stat.mode);
    }
    // Writers outside the session lock (e.g. gateway early-persist append) may
    // have appended since we read; never clobber those lines with a rename.
    const statNow = await fs.stat(sessionFile).catch(() => null);
    if (
      !statBefore ||
      !statNow ||
      statNow.size !== statBefore.size ||
      statNow.mtimeMs !== statBefore.mtimeMs
    ) {
      await fs.unlink(tmpPath).catch(() => undefined);
      await fs.unlink(backupPath).catch(() => undefined);
      params.warn?.(
        `session file repair skipped: file changed during repair (${path.basename(sessionFile)})`,
      );
      return { repaired: false, droppedLines, reason: "concurrent modification" };
    }
    await fs.rename(tmpPath, sessionFile);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch (cleanupErr) {
      params.warn?.(
        `session file repair cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : "unknown error"} (${path.basename(
          tmpPath,
        )})`,
      );
    }
    return {
      repaired: false,
      droppedLines,
      reason: `repair failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  params.warn?.(
    `session file repaired: dropped ${droppedLines} malformed line(s), converted ${convertedBareLines} bare message line(s), relinked ${relinkedParents} parent(s); backup ${path.basename(backupPath)} (${path.basename(
      sessionFile,
    )})`,
  );
  return { repaired: true, droppedLines, convertedBareLines, relinkedParents, backupPath };
}
