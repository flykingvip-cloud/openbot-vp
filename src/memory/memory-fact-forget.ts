/**
 * Fact-level forget (MVP): factRef = atomId (+ scope via manager defaultScope).
 * Enumerate live sources via CogniWeave source_object_links, then soft-forget
 * each source (no default purge, no silent whole-corpus text delete).
 */
import type { SourceLifecycleMode } from "../../packages/cogniweave-sdk/src/index.js";

export type FactForgetSourceStatus = "forgotten" | "already_forgotten" | "skipped" | "failed";

export type FactForgetSourceResult = {
  sourceBindingId: string;
  sourceIdentityId: string;
  sourceLocator: string;
  previousStatus?: SourceLifecycleMode;
  status: FactForgetSourceStatus;
  error?: string;
};

export type FactForgetResult = {
  ok: boolean;
  factRef: { atomId: string };
  sources: FactForgetSourceResult[];
  /** Atom missing or not in manager scope. */
  atomMissing?: boolean;
  error?: string;
};

export type LiveFactSource = {
  sourceBindingId: string;
  sourceIdentityId: string;
  sourceLocator: string;
  status: SourceLifecycleMode;
};

/**
 * Soft-forget every live source linked to atomId. Never purges.
 * Caller supplies enumerate + forget hooks so unit tests can stub without engine.
 */
export async function orchestrateFactSoftForget(params: {
  atomId: string;
  operationId: string;
  enumerate: () => Promise<LiveFactSource[]>;
  softForgetSource: (
    source: LiveFactSource,
    operationId: string,
  ) => Promise<{
    ok: boolean;
    status?: string;
    skipped?: boolean;
    error?: string;
  }>;
  atomExists: () => Promise<boolean>;
}): Promise<FactForgetResult> {
  const atomId = params.atomId.trim();
  if (!atomId) {
    return {
      ok: false,
      factRef: { atomId: "" },
      sources: [],
      error: "atomId is required",
    };
  }
  if (!(await params.atomExists())) {
    return {
      ok: false,
      factRef: { atomId },
      sources: [],
      atomMissing: true,
      error: "atom not found",
    };
  }
  const live = await params.enumerate();
  if (live.length === 0) {
    return {
      ok: true,
      factRef: { atomId },
      sources: [],
    };
  }
  const sources: FactForgetSourceResult[] = [];
  let allOk = true;
  for (const source of live) {
    const opId = `${params.operationId}:src:${source.sourceBindingId}`;
    try {
      const result = await params.softForgetSource(source, opId);
      if (result.skipped) {
        sources.push({
          ...source,
          previousStatus: source.status,
          status: "skipped",
        });
        continue;
      }
      if (!result.ok) {
        allOk = false;
        sources.push({
          ...source,
          previousStatus: source.status,
          status: "failed",
          error: result.error ?? "forget failed",
        });
        continue;
      }
      const current = (result.status ?? "").trim();
      if (current === "forgotten") {
        sources.push({
          ...source,
          previousStatus: source.status,
          status: "forgotten",
        });
      } else {
        allOk = false;
        sources.push({
          ...source,
          previousStatus: source.status,
          status: "failed",
          error: `unexpected status after soft forget: ${current || "unknown"}`,
        });
      }
    } catch (err) {
      allOk = false;
      sources.push({
        ...source,
        previousStatus: source.status,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    ok: allOk,
    factRef: { atomId },
    sources,
    ...(allOk ? {} : { error: "one or more sources failed to soft-forget" }),
  };
}
