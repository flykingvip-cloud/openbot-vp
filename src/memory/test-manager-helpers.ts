import type { DatabaseSync } from "node:sqlite";
import type { OpenBotConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import {
  normalizeRootFingerprint,
  writeFingerprintsToDb,
  type V1DestructiveOp,
} from "./v1-root-guard.js";

/** Walk recall-deny / fallback wrappers. Use only to register fingerprints or touch internals. */
export function unwrapMemoryIndexManager(manager: object): MemoryIndexManager {
  let current: unknown = manager;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      current &&
      typeof current === "object" &&
      "resetIndex" in current &&
      typeof (current as { resetIndex?: unknown }).resetIndex === "function" &&
      "db" in current
    ) {
      return current as unknown as MemoryIndexManager;
    }
    if (current && typeof current === "object" && "inner" in current) {
      current = (current as { inner: unknown }).inner;
      continue;
    }
    if (current && typeof current === "object" && "deps" in current) {
      const deps = (current as { deps?: { primary?: unknown } }).deps;
      if (deps?.primary) {
        current = deps.primary;
        continue;
      }
    }
    break;
  }
  throw new Error("unwrapMemoryIndexManager: MemoryIndexManager not found");
}

type BatchPathLayer = {
  label: string;
  present: boolean;
  ctor?: string;
  batchEnabled?: boolean;
  provider?: string;
  backend?: string;
  hasOpenAi?: boolean;
};

function readBatchPathLayer(label: string, value: unknown): BatchPathLayer {
  if (!value || typeof value !== "object") {
    return { label, present: false };
  }
  const record = value as {
    constructor?: { name?: string };
    batch?: { enabled?: boolean };
    provider?: { id?: string };
    openAi?: unknown;
    status?: () => { provider?: string; backend?: string; batch?: { enabled?: boolean } };
  };
  const status = typeof record.status === "function" ? record.status() : undefined;
  return {
    label,
    present: true,
    ctor: record.constructor?.name,
    batchEnabled: record.batch?.enabled ?? status?.batch?.enabled,
    provider: record.provider?.id ?? status?.provider,
    backend: status?.backend,
    hasOpenAi: Boolean(record.openAi),
  };
}

export function describeMemoryManagerBatchPath(manager: object): {
  public: BatchPathLayer;
  primary: BatchPathLayer;
  fallback: BatchPathLayer;
  index: BatchPathLayer;
} {
  const wrapper = manager as {
    inner?: unknown;
    deps?: { primary?: unknown };
    fallback?: unknown;
  };
  const primary = wrapper.deps?.primary ?? wrapper.inner ?? manager;
  const fallback = wrapper.fallback ?? null;
  return {
    public: readBatchPathLayer("public", manager),
    primary: readBatchPathLayer("primary", primary),
    fallback: readBatchPathLayer("fallback", fallback),
    index: readBatchPathLayer("index", unwrapMemoryIndexManager(manager)),
  };
}

export function registerIsolatedTestV1Root(manager: object): void {
  const typed = unwrapMemoryIndexManager(manager) as unknown as {
    db?: DatabaseSync;
    workspaceDir?: string;
  };
  if (!typed.db || typeof typed.workspaceDir !== "string") {
    throw new Error("registerIsolatedTestV1Root: manager missing db/workspaceDir");
  }
  writeFingerprintsToDb(typed.db, [normalizeRootFingerprint(typed.workspaceDir)]);
}

type TestV1Boundary = {
  beginV1Operation: (op: V1DestructiveOp) => void;
  endV1Operation: () => void;
  resetIndex: () => void;
};

/** Test harness: run resetIndex through the same boundary op used in production. */
export function resetMemoryIndexForTest(manager: object, op: V1DestructiveOp = "reset"): void {
  registerIsolatedTestV1Root(manager);
  const inner = unwrapMemoryIndexManager(manager) as unknown as TestV1Boundary;
  inner.beginV1Operation(op);
  try {
    inner.resetIndex();
  } finally {
    inner.endV1Operation();
  }
}

export async function getRequiredMemoryIndexManager(params: {
  cfg: OpenBotConfig;
  agentId?: string;
}): Promise<MemoryIndexManager> {
  const result = await getMemorySearchManager({
    cfg: params.cfg,
    agentId: params.agentId ?? "main",
  });
  if (!result.manager) {
    throw new Error("manager missing");
  }
  if (!("sync" in result.manager) || typeof result.manager.sync !== "function") {
    throw new Error("manager does not support sync");
  }
  registerIsolatedTestV1Root(result.manager);
  // Keep the public search manager under test; unwrap only inside register.
  return result.manager as MemoryIndexManager;
}
