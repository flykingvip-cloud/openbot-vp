/**
 * Track I / M2 — durable InterventionCase store (JSON file) + in-memory for tests.
 * P1: gateway shared store persists under $CONFIG_DIR so restart can read back cases.
 * Not a second Diagnosis DB; does not write the message transcript.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";
import type { InterventionCase, InterventionCaseStatus } from "./intervention-case.js";

export const INTERVENTION_CASE_STORE_FILENAME = "diagnosis-intervention-cases.json" as const;

export type InterventionCaseStore = {
  get(caseId: string): InterventionCase | undefined;
  put(row: InterventionCase): void;
  list(filter?: {
    tenantId?: string | null;
    status?: InterventionCaseStatus | InterventionCaseStatus[];
  }): InterventionCase[];
  delete?(caseId: string): void;
  /** Re-read durable snapshot from disk (file store). No-op for memory. */
  reload?(): void;
  /** Absolute path when file-backed. */
  readonly filePath?: string;
};

type FileSnapshot = { schemaVersion: 1; cases: Record<string, InterventionCase> };

function emptySnapshot(): FileSnapshot {
  return { schemaVersion: 1, cases: {} };
}

function cloneCase(row: InterventionCase): InterventionCase {
  return structuredClone(row);
}

function readFile(filePath: string): FileSnapshot {
  try {
    if (!fs.existsSync(filePath)) {
      return emptySnapshot();
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FileSnapshot>;
    return {
      schemaVersion: 1,
      cases: parsed.cases && typeof parsed.cases === "object" ? parsed.cases : {},
    };
  } catch {
    return emptySnapshot();
  }
}

/** Atomic write: tmp + rename. Idempotent put overwrites by caseId. */
function writeFileAtomic(filePath: string, snapshot: FileSnapshot): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function matchesFilter(
  row: InterventionCase,
  filter?: {
    tenantId?: string | null;
    status?: InterventionCaseStatus | InterventionCaseStatus[];
  },
): boolean {
  if (!filter) {
    return true;
  }
  if (filter.tenantId !== undefined && row.tenantId !== filter.tenantId) {
    return false;
  }
  if (filter.status) {
    const statuses = new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
    if (!statuses.has(row.status)) {
      return false;
    }
  }
  return true;
}

export function resolveInterventionCaseStorePath(configDir: string = CONFIG_DIR): string {
  const override = process.env.OPENBOT_INTERVENTION_CASE_STORE_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(configDir, INTERVENTION_CASE_STORE_FILENAME);
}

export function createMemoryInterventionCaseStore(
  seed: Iterable<InterventionCase> = [],
): InterventionCaseStore {
  const map = new Map<string, InterventionCase>();
  for (const row of seed) {
    map.set(row.caseId, cloneCase(row));
  }
  return {
    get: (caseId) => {
      const row = map.get(String(caseId));
      return row ? cloneCase(row) : undefined;
    },
    put: (row) => {
      map.set(row.caseId, cloneCase(row));
    },
    list: (filter) => [...map.values()].filter((row) => matchesFilter(row, filter)).map(cloneCase),
    delete: (caseId) => {
      map.delete(String(caseId));
    },
    reload: () => {
      /* memory: no-op */
    },
  };
}

export function createFileInterventionCaseStore(filePath: string): InterventionCaseStore {
  let snapshot = readFile(filePath);
  const persist = () => writeFileAtomic(filePath, snapshot);
  const store: InterventionCaseStore = {
    get: (caseId) => {
      const row = snapshot.cases[String(caseId)];
      return row ? cloneCase(row) : undefined;
    },
    put: (row) => {
      snapshot.cases[row.caseId] = cloneCase(row);
      persist();
    },
    list: (filter) =>
      Object.values(snapshot.cases)
        .filter((row) => matchesFilter(row, filter))
        .map(cloneCase),
    delete: (caseId) => {
      delete snapshot.cases[String(caseId)];
      persist();
    },
    reload: () => {
      snapshot = readFile(filePath);
    },
    filePath,
  };
  return store;
}
