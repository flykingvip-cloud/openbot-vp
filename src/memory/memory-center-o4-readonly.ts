/**
 * O4 Memory Center isolated readonly foundation.
 * evidence: mock-config-identity-branch — not full-client-chain.
 *
 * Does NOT call syncScope / ensureMemorySubjectBinding / bootstrapSchema / migrate.
 * Reuses authorizeMemoryAccess + isAtomRetrievable (no parallel simplified ACL).
 */
import {
  authorizeMemoryAccess,
  createMemoryPartitionKeyV1,
  isAtomRetrievable,
  openLocalMetadataStoreReadonly,
  resolveLocalMemorySubject,
  type AtomStatus,
  type MemoryAtom,
  type MemorySubject,
  type Scope,
} from "../../packages/cogniweave-sdk/src/index.js";
import { mapAtomToMemoryCenterRow, type MemoryCenterAtomRow } from "./memory-center-atoms.js";

export type MemoryCenterStatusView = "active" | "tentative";

export type MemoryCenterReadonlyListErrorCode =
  | "MEMORY_SUBJECT_UNBOUND"
  | "MEMORY_SUBJECT_OWNER_MISMATCH"
  | "MEMORY_SUBJECT_TENANT_MISMATCH"
  | "MEMORY_STORE_MISSING"
  | "MEMORY_STORE_NOT_INITIALIZED"
  | "MEMORY_STORE_SCHEMA_UNSUPPORTED"
  | "MEMORY_BACKEND_UNSUPPORTED"
  | "MEMORY_SNAPSHOT_STALE"
  | "MEMORY_CENTER_ACCESS_DENIED";

export type MemoryCenterReadonlyListResult =
  | {
      ok: true;
      statusView: MemoryCenterStatusView;
      atoms: MemoryCenterAtomRow[];
      total: number;
      truncated: boolean;
      indexHint?: "empty" | "stale" | "ready";
    }
  | {
      ok: false;
      code: MemoryCenterReadonlyListErrorCode;
      message: string;
    };

export type ListMemoryCenterAtomsReadonlyInput = {
  /** Absolute path to CogniWeave embedded local metadata SQLite. */
  metadataStorePath: string;
  scope: Scope;
  /** Defaults to local agent subject for agentId. */
  caller?: MemorySubject;
  agentId: string;
  statusView?: MemoryCenterStatusView;
  limit?: number;
  /**
   * Only `"cogniweave"` + `"embedded"` are supported this round.
   * Other values → MEMORY_BACKEND_UNSUPPORTED.
   */
  backend: string;
  cogniweaveMode?: string;
  /** Adapter environment label passed through to LocalMetadataStore. */
  environment?: "local" | "cloud";
};

const DEFAULT_LIMIT = 200;

function mapAuthReason(
  reason: string | undefined,
): Extract<
  MemoryCenterReadonlyListErrorCode,
  | "MEMORY_SUBJECT_UNBOUND"
  | "MEMORY_SUBJECT_OWNER_MISMATCH"
  | "MEMORY_SUBJECT_TENANT_MISMATCH"
  | "MEMORY_CENTER_ACCESS_DENIED"
> {
  if (reason === "OWNER_MISMATCH") {
    return "MEMORY_SUBJECT_OWNER_MISMATCH";
  }
  // Local sentinel refusing enterprise caller is a tenant-boundary deny.
  if (reason === "TENANT_MISMATCH" || reason === "LOCAL_SENTINEL_VIOLATION") {
    return "MEMORY_SUBJECT_TENANT_MISMATCH";
  }
  if (reason === "UNBOUND") {
    return "MEMORY_SUBJECT_UNBOUND";
  }
  return "MEMORY_CENTER_ACCESS_DENIED";
}

function statusForView(view: MemoryCenterStatusView): AtomStatus {
  return view;
}

function lifecycleOptsForView(view: MemoryCenterStatusView): {
  includeTentative?: boolean;
  includeConflicted?: boolean;
} {
  if (view === "tentative") {
    return { includeTentative: true, includeConflicted: false };
  }
  return { includeTentative: false, includeConflicted: false };
}

/**
 * Narrow readonly list for Memory Center status views.
 * Opens existing embedded store only; never creates DB or subject bindings.
 */
export async function listMemoryCenterAtomsReadonly(
  input: ListMemoryCenterAtomsReadonlyInput,
): Promise<MemoryCenterReadonlyListResult> {
  const statusView: MemoryCenterStatusView = input.statusView ?? "active";
  const limit = Math.max(0, input.limit ?? DEFAULT_LIMIT);

  if (input.backend !== "cogniweave" || input.cogniweaveMode !== "embedded") {
    return {
      ok: false,
      code: "MEMORY_BACKEND_UNSUPPORTED",
      message: `O4 readonly list supports cogniweave embedded only (got backend=${input.backend} mode=${input.cogniweaveMode ?? "unknown"})`,
    };
  }

  const opened = openLocalMetadataStoreReadonly({
    path: input.metadataStorePath,
    backend: "local",
    environment: input.environment ?? "local",
  });
  if (!opened.ok) {
    return { ok: false, code: opened.code, message: opened.message };
  }
  const store = opened.store;
  try {
    const dataPlaneId = await store.getDataPlaneId();
    if (!dataPlaneId) {
      return {
        ok: false,
        code: "MEMORY_STORE_NOT_INITIALIZED",
        message: "metadata store has no data_plane_id; refuse to create on readonly path",
      };
    }

    const caller = input.caller ?? resolveLocalMemorySubject(input.agentId, "agent");
    const partition = createMemoryPartitionKeyV1(dataPlaneId, input.scope);
    const bindings = await store.listMemorySubjectBindings({
      scope: input.scope,
      liveOnly: true,
    });
    const auth = authorizeMemoryAccess(bindings, { partition, caller });
    if (!auth.allowed) {
      return {
        ok: false,
        code: mapAuthReason(auth.reason),
        message: `memory subject authorization denied: ${auth.reason ?? "DENIED"}`,
      };
    }

    const statuses: AtomStatus[] = [statusForView(statusView)];
    // Fetch all status-matched rows (push-down), then lifecycle-gate, then limit.
    // Avoid SQL LIMIT before lifecycle so total/limit stay consistent.
    // Push statuses in SQL, then lifecycle-gate, then slice by limit.
    // High fetch cap keeps total consistent for Memory Center scale; no SQL LIMIT-before-filter.
    const FETCH_CAP = 50_000;
    const rows = await store.queryAtoms({
      scope: input.scope,
      statuses,
      limit: FETCH_CAP,
      offset: 0,
    });

    const lifecycleOpts = lifecycleOptsForView(statusView);
    const retrievable: MemoryAtom[] = [];
    for (const atom of rows) {
      // Exact status view: refuse leakage if store ignored statuses.
      if (atom.state.status !== statusView) {
        continue;
      }
      const lifecycle = isAtomRetrievable(atom, lifecycleOpts);
      if (!lifecycle.retrievable) {
        continue;
      }
      retrievable.push(atom);
    }

    const total = retrievable.length;
    const limited = retrievable.slice(0, limit);
    return {
      ok: true,
      statusView,
      atoms: limited.map((atom) => mapAtomToMemoryCenterRow(atom)),
      total,
      truncated: limited.length < total,
      indexHint: total === 0 ? "empty" : "ready",
    };
  } finally {
    store.close();
  }
}
