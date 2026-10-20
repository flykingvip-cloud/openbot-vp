import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BanditFeedbackStore,
  type BanditFeedbackStoreOptions,
  type BanditPersistedState,
} from "./bandit.js";
import type { EvalResult } from "./evaluator.js";
import type { FeedbackStore } from "./feedback.js";
import type { ModelProfile, ModelRef, TaskTypeId } from "./types.js";

const PERSIST_VERSION = 1 as const;

/** Read bandit arms from disk; returns undefined when the file is missing or invalid. */
export function readBanditPersistedState(path: string): BanditPersistedState | undefined {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as BanditPersistedState;
    if (parsed.version !== PERSIST_VERSION || typeof parsed.arms !== "object") {
      return undefined;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

/** Atomically write bandit state (mkdir -p parent dir). */
export function writeBanditPersistedState(path: string, state: BanditPersistedState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export interface PersistentBanditFeedbackStoreOptions extends BanditFeedbackStoreOptions {
  /** When true (default), load existing arms from `persistPath` on construction. */
  loadOnStart?: boolean;
}

/**
 * Bandit feedback that survives process restarts — for live Gateway runs where
 * learning must accumulate across CLI invocations / long-lived workers.
 */
export class PersistentBanditFeedbackStore implements FeedbackStore {
  readonly inner: BanditFeedbackStore;

  constructor(
    readonly persistPath: string,
    options: PersistentBanditFeedbackStoreOptions = {},
  ) {
    const { loadOnStart = true, ...storeOptions } = options;
    this.inner = new BanditFeedbackStore(storeOptions);
    if (loadOnStart) {
      const state = readBanditPersistedState(persistPath);
      if (state) {
        this.inner.importPersistedState(state);
      }
    }
  }

  record(model: ModelRef, taskType: TaskTypeId, evaluation: EvalResult): void {
    this.inner.record(model, taskType, evaluation);
    writeBanditPersistedState(this.persistPath, this.inner.exportPersistedState());
  }

  quality(model: ModelRef, taskType: TaskTypeId): number | undefined {
    return this.inner.quality(model, taskType);
  }

  apply(profiles: ModelProfile[]): ModelProfile[] {
    return this.inner.apply(profiles);
  }

  learningSnapshot() {
    return this.inner.learningSnapshot();
  }
}

/** Load or create a persistent bandit store at the given path. */
export function createPersistentBanditFeedbackStore(
  persistPath: string,
  options?: PersistentBanditFeedbackStoreOptions,
): PersistentBanditFeedbackStore {
  return new PersistentBanditFeedbackStore(persistPath, options);
}
