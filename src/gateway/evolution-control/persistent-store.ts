import fs from "node:fs";
import path from "node:path";
import type {
  EvolutionApplication,
  EvolutionExperiment,
  EvolutionLedgerEvent,
  EvolutionProposal,
  EvolutionVerification,
  RollbackDrillRecord,
} from "@openbot/evolution-core";
import { CONFIG_DIR } from "../../utils.js";
import {
  hashCandidatePayload,
  type CandidateStore,
  type GovernedCandidate,
} from "./candidate-store.js";
import { createMemoryEvolutionLedger, type EvolutionLedger } from "./evolution-ledger.js";
import type { ExperimentStore } from "./experiment-manager.js";
import { projectDiagnosisProposal, type EvolutionProposalIndex } from "./proposal-projection.js";

export function resolveEvolutionControlRoot(persistDir?: string): string {
  return persistDir?.trim() || path.join(CONFIG_DIR, "evolution-control");
}

export function resolveEvolutionAdapterDir(persistDir?: string): string | undefined {
  return persistDir?.trim() ? path.join(persistDir.trim(), "adapters") : undefined;
}

function readJsonSync<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonSync(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export function createDurableMap<T>(filePath?: string): Map<string, T> {
  const rows = new Map<string, T>(
    filePath ? Object.entries(readJsonSync<Record<string, T>>(filePath, {})) : [],
  );
  if (!filePath) {
    return rows;
  }
  const persist = () => writeJsonSync(filePath, Object.fromEntries(rows));
  const originalSet = rows.set.bind(rows);
  rows.set = (key, value) => {
    originalSet(key, value);
    persist();
    return rows;
  };
  return rows;
}

export function createFileEvolutionProposalIndex(filePath: string): EvolutionProposalIndex {
  const rows = createDurableMap<EvolutionProposal>(filePath);
  return {
    ingestV1(proposal, targetHint) {
      const projected = projectDiagnosisProposal(proposal, targetHint);
      rows.set(projected.proposalId, projected);
      return projected;
    },
    put(proposal) {
      rows.set(proposal.proposalId, proposal);
    },
    get(proposalId) {
      return rows.get(proposalId);
    },
    list(filter) {
      return [...rows.values()].filter((row) => {
        if (filter && "tenantScope" in filter && row.tenantScope !== filter.tenantScope) {
          return false;
        }
        if (filter?.surfaceId && row.surfaceId !== filter.surfaceId) {
          return false;
        }
        return true;
      });
    },
  };
}

export function createFileExperimentStore(filePath: string): ExperimentStore {
  const rows = createDurableMap<EvolutionExperiment>(filePath);
  return {
    get: (id) => rows.get(id),
    put: (row) => {
      rows.set(row.experimentId, row);
    },
    listByProposal: (proposalId) =>
      [...rows.values()].filter((row) => row.proposalId === proposalId),
    listByTarget: () => [...rows.values()],
  };
}

export function createFileCandidateStore(filePath: string): CandidateStore {
  const rows = createDurableMap<GovernedCandidate>(filePath);
  return {
    get: (candidateRef) => rows.get(candidateRef),
    put: (row) => {
      rows.set(row.candidateRef, {
        ...row,
        payloadHash: row.payloadHash || hashCandidatePayload(row.payload),
      });
    },
  };
}

export function createFileEvolutionLedger(filePath: string): EvolutionLedger {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const seed: EvolutionLedgerEvent[] = [];
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      seed.push(JSON.parse(line) as EvolutionLedgerEvent);
    }
  }
  const memory = createMemoryEvolutionLedger(seed);
  return {
    append(input) {
      const event = memory.append(input);
      fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
      return event;
    },
    list: (filter) => memory.list(filter),
    replay: (proposalId) => memory.replay(proposalId),
  };
}

export type EvolutionControlPersistence = {
  proposals: EvolutionProposalIndex;
  experiments: ExperimentStore;
  candidates: CandidateStore;
  applications: Map<string, EvolutionApplication>;
  verifications: Map<string, EvolutionVerification>;
  drills: Map<string, RollbackDrillRecord>;
  targetIndex: Map<string, string>;
  ledger: EvolutionLedger;
  adapterDir: string;
};

export function createEvolutionControlPersistence(persistDir: string): EvolutionControlPersistence {
  const root = resolveEvolutionControlRoot(persistDir);
  fs.mkdirSync(root, { recursive: true });
  return {
    proposals: createFileEvolutionProposalIndex(path.join(root, "proposals.json")),
    experiments: createFileExperimentStore(path.join(root, "experiments.json")),
    candidates: createFileCandidateStore(path.join(root, "candidates.json")),
    applications: createDurableMap(path.join(root, "applications.json")),
    verifications: createDurableMap(path.join(root, "verifications.json")),
    drills: createDurableMap(path.join(root, "rollback-drills.json")),
    targetIndex: createDurableMap(path.join(root, "target-index.json")),
    ledger: createFileEvolutionLedger(path.join(root, "ledger.jsonl")),
    adapterDir: path.join(root, "adapters"),
  };
}

export type AdapterSnapshotBundle<T> = {
  applied: Record<string, EvolutionApplication>;
  extras: T;
};

export function loadAdapterSnapshots<T>(
  adapterDir: string | undefined,
  adapterId: string,
  fallback: T,
): AdapterSnapshotBundle<T> {
  if (!adapterDir) {
    return { applied: {}, extras: fallback };
  }
  return readJsonSync<AdapterSnapshotBundle<T>>(path.join(adapterDir, `${adapterId}.json`), {
    applied: {},
    extras: fallback,
  });
}

export function saveAdapterSnapshots<T>(
  adapterDir: string | undefined,
  adapterId: string,
  bundle: AdapterSnapshotBundle<T>,
): void {
  if (!adapterDir) {
    return;
  }
  writeJsonSync(path.join(adapterDir, `${adapterId}.json`), bundle);
}
