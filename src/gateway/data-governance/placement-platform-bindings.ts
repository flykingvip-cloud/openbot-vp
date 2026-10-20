/**
 * Internal placement-authority binding slot. Not exported from the public barrel.
 * Production code may only bind once via installPlacementPlatformAuthority().
 */
import path from "node:path";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { createFilePlacementConsentStore } from "./placement-consent-store.js";
import type {
  PlacementCatalogScopeLoader,
  PlacementConsentStore,
} from "./placement-platform-verify.js";
import type { DataGovernanceEnvelope } from "./types.js";

type PlacementAuthorityBindings = {
  catalog: PlacementCatalogScopeLoader;
  store: PlacementConsentStore;
  stateDir: string;
};

let bindings: PlacementAuthorityBindings | null = null;

function isTestRuntime(): boolean {
  return Boolean(
    process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.OPENBOT_TEST_PROFILE,
  );
}

function dataSubjectIdsFromEnvelope(envelope: DataGovernanceEnvelope): string[] {
  if (envelope.owner.kind === "user" && envelope.owner.userId.trim() !== "") {
    return [envelope.owner.userId.trim()];
  }
  return [];
}

function createCatalogScopeLoader(stateDir: string): PlacementCatalogScopeLoader {
  const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
  return {
    loadResourceConsentScope(query) {
      const loaded = loadValidatedCatalogRecordSync({
        storePath: catalogPath,
        resourceId: query.resourceId,
      });
      if (!loaded) {
        return null;
      }
      const envelope = loaded.record.envelope;
      if (envelope.resourceId !== query.resourceId || envelope.tenantId !== query.tenantId) {
        return null;
      }
      const dataSubjectIds = dataSubjectIdsFromEnvelope(envelope);
      if (dataSubjectIds.length === 0) {
        return null;
      }
      return {
        tenantId: query.tenantId,
        resourceId: query.resourceId,
        dataSubjectIds,
        catalogEpoch: `${loaded.revision}:${envelope.governanceVersion}:${envelope.updatedAt}`,
      };
    },
  };
}

function createProductionBindings(stateDir: string): PlacementAuthorityBindings {
  return {
    catalog: createCatalogScopeLoader(stateDir),
    store: createFilePlacementConsentStore(stateDir),
    stateDir,
  };
}

export function getPlacementAuthorityBindings(): {
  catalog: PlacementCatalogScopeLoader;
  store: PlacementConsentStore;
} | null {
  if (!bindings) {
    return null;
  }
  return { catalog: bindings.catalog, store: bindings.store };
}

export function tryBindPlacementAuthorityOnce(stateDir: string): {
  ok: true;
  stateDir: string;
  alreadyBound: boolean;
} {
  if (bindings) {
    return { ok: true, stateDir: bindings.stateDir, alreadyBound: true };
  }
  const resolved = path.resolve(stateDir);
  bindings = createProductionBindings(resolved);
  return { ok: true, stateDir: resolved, alreadyBound: false };
}

export function replacePlacementAuthorityBindingsForTests(stateDir: string): void {
  if (!isTestRuntime()) {
    throw new Error("placement authority test rebind is not available");
  }
  if (!stateDir.trim()) {
    throw new Error("placement authority test rebind requires a stateDir");
  }
  bindings = createProductionBindings(path.resolve(stateDir));
}

export function clearPlacementAuthorityBindingsForTests(): void {
  if (!isTestRuntime()) {
    throw new Error("placement authority test clear is not available");
  }
  bindings = null;
}
