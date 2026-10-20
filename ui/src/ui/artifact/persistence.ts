/**
 * Artifact Persistence — handles saving and restoring artifact state.
 *
 * Rules:
 * - Artifacts MUST be persisted (not just in preview state)
 * - Session rollover MUST save: active tasks, artifacts, latest versions
 * - New session startup MUST auto-restore recent artifacts
 */

import { artifactRegistry } from "./registry.ts";
import type { ArtifactLedger } from "./types.ts";

const LEDGER_STORAGE_KEY = "openbot:artifact-ledger";
const MAX_PERSISTED_ARTIFACTS = 100;
const MAX_PERSISTED_TASKS = 50;

/**
 * Save the current artifact ledger to persistent storage.
 */
export function persistArtifactLedger(): boolean {
  try {
    const ledger = artifactRegistry.exportLedger();

    // Trim to max limits (keep most recent)
    const trimmedLedger: ArtifactLedger = {
      ...ledger,
      artifacts: ledger.artifacts
        .toSorted((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, MAX_PERSISTED_ARTIFACTS),
      tasks: ledger.tasks
        .toSorted(
          (a, b) =>
            new Date(b.completed_at ?? b.started_at).getTime() -
            new Date(a.completed_at ?? a.started_at).getTime(),
        )
        .slice(0, MAX_PERSISTED_TASKS),
    };

    const serialized = JSON.stringify(trimmedLedger);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LEDGER_STORAGE_KEY, serialized);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Restore the artifact ledger from persistent storage.
 * Called on new session startup.
 */
export function restoreArtifactLedger(): ArtifactLedger | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const ledger = JSON.parse(raw) as ArtifactLedger;

    // Validate basic structure
    if (!ledger || !Array.isArray(ledger.artifacts) || !Array.isArray(ledger.tasks)) {
      return null;
    }

    return ledger;
  } catch {
    return null;
  }
}

/**
 * Initialize the registry from persisted state.
 * Returns true if recovery was successful and there are artifacts to show.
 */
export function initializeFromPersistedState(): boolean {
  const ledger = restoreArtifactLedger();
  if (!ledger || ledger.artifacts.length === 0) {
    return false;
  }

  artifactRegistry.importLedger(ledger);
  return true;
}

/**
 * Clear persisted artifact state.
 */
export function clearPersistedArtifactLedger(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LEDGER_STORAGE_KEY);
    }
  } catch {
    // Non-critical
  }
}

/**
 * Auto-persist on registry changes (debounced).
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 2000;

export function setupAutoPersist(): () => void {
  const unsubscribe = artifactRegistry.subscribe(() => {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistArtifactLedger();
      persistTimer = null;
    }, PERSIST_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  };
}
