import fs from "node:fs";
import path from "node:path";

export type JournalOp =
  | {
      op: "upsert";
      relativePath: string;
      mtimeMs: number;
      sizeBytes: number;
      recordedAt: string;
    }
  | {
      op: "delete";
      relativePath: string;
      recordedAt: string;
    };

export type OfflineJournal = {
  vaultId: string;
  deviceId: string;
  ops: JournalOp[];
};

function journalPath(storeDir: string, vaultId: string): string {
  return path.join(storeDir, vaultId, "offline-journal.json");
}

export function loadOfflineJournal(storeDir: string, vaultId: string): OfflineJournal {
  const file = journalPath(storeDir, vaultId);
  if (!fs.existsSync(file)) {
    return { vaultId, deviceId: "", ops: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OfflineJournal;
    if (!parsed || !Array.isArray(parsed.ops)) {
      return { vaultId, deviceId: "", ops: [] };
    }
    return parsed;
  } catch {
    return { vaultId, deviceId: "", ops: [] };
  }
}

export function saveOfflineJournal(storeDir: string, journal: OfflineJournal): void {
  const file = journalPath(storeDir, journal.vaultId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function appendJournalOp(
  storeDir: string,
  vaultId: string,
  deviceId: string,
  op: JournalOp,
): OfflineJournal {
  const journal = loadOfflineJournal(storeDir, vaultId);
  journal.vaultId = vaultId;
  journal.deviceId = deviceId;
  // coalesce by path: latest wins
  journal.ops = journal.ops.filter((existing) => existing.relativePath !== op.relativePath);
  journal.ops.push(op);
  saveOfflineJournal(storeDir, journal);
  return journal;
}

export function clearOfflineJournal(storeDir: string, vaultId: string): void {
  saveOfflineJournal(storeDir, { vaultId, deviceId: "", ops: [] });
}
