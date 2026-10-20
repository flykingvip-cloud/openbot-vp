/**
 * Managed Enterprise workspace identity diagnose + repair.
 *
 * Seat agents (legacy slugs like "fengshui") must map Registry legacyAgentId → UUID
 * agentAssetId and have a governed Workspace Catalog row before chat can authorize cwd.
 */
import path from "node:path";
import { resolveAgentConfig } from "../../agents/agent-scope.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  applyAgentRegistryBackfill,
  selectBackfillCandidates,
  type BackfillReport,
} from "../agent-registry/backfill.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { findAgentAssetBySlug } from "../agent-registry/registry.js";
import { loadAgentRegistryStore, saveAgentRegistryStore } from "../agent-registry/store.js";
import {
  resolveSeatGrantedAgentAssetIds,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { listOwnershipRecords } from "../ownership-store.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import {
  ensureGovernedWorkspaceCatalogIdentity,
  loadExistingGovernedWorkspaceIdentity,
} from "./workspace-catalog-projection.js";
import {
  isMalformedRegistryAssetEntry,
  repairMalformedRegistryAsset,
} from "./workspace-registry-repair.js";

export type WorkspaceIdentityIssueCode =
  | "ok"
  | "catalog_ready"
  | "catalog_projection_miss"
  | "registry_not_found"
  | "registry_ambiguous"
  | "malformed_registry_asset"
  | "missing_seat_context"
  | "builtin_universal"
  | "ensure_failed";

export type WorkspaceIdentityDiagnosis = {
  tenantId: string;
  legacyAgentId: string;
  displayName?: string;
  issue: WorkspaceIdentityIssueCode;
  detail: string;
  agentAssetId?: string;
  seatId?: string;
  userId?: string;
  hasCatalog: boolean;
  legacyWorkspacePath?: string;
};

export type WorkspaceIdentityRepairAction =
  | { action: "registry_backfill"; legacyAgentId: string; agentAssetId: string }
  | {
      action: "malformed_asset_repaired";
      legacyAgentId: string;
      fromAssetId: string;
      toAssetId: string;
    }
  | { action: "catalog_minted"; legacyAgentId: string; agentAssetId: string; resourceId?: string }
  | { action: "already_ready"; legacyAgentId: string; agentAssetId: string }
  | { action: "skipped"; legacyAgentId: string; reason: string };

export type WorkspaceIdentityRepairReport = {
  tenantId: string;
  apply: boolean;
  diagnoses: WorkspaceIdentityDiagnosis[];
  registryBackfill?: BackfillReport;
  actions: WorkspaceIdentityRepairAction[];
};

export function findSeatContextForLegacyAgent(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  legacyAgentId: string;
}): { seatId?: string; userId: string } | null {
  const legacyAgentId = params.legacyAgentId.trim();
  const tenantId = params.tenantId.trim();
  if (!legacyAgentId || !tenantId) {
    return null;
  }
  for (const seat of Object.values(params.store.seats)) {
    if (seat.tenantId !== tenantId) {
      continue;
    }
    const granted = resolveSeatGrantedAgentAssetIds({
      store: params.store,
      tenantId,
      seat,
    });
    if (!granted.includes(legacyAgentId)) {
      continue;
    }
    const userId = seat.currentEmployeeId?.trim();
    if (!userId) {
      continue;
    }
    return { seatId: seat.seatId, userId };
  }
  return null;
}

export function collectSeatLegacyAgentIds(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  agentFilter?: string;
}): string[] {
  const tenantId = params.tenantId.trim();
  const filter = params.agentFilter?.trim();
  const ids = new Set<string>();
  for (const seat of Object.values(params.store.seats)) {
    if (seat.tenantId !== tenantId) {
      continue;
    }
    for (const agentId of resolveSeatGrantedAgentAssetIds({
      store: params.store,
      tenantId,
      seat,
    })) {
      if (isBuiltinStewardAgent(agentId)) {
        continue;
      }
      if (filter && agentId !== filter) {
        continue;
      }
      ids.add(agentId);
    }
  }
  return [...ids].toSorted();
}

export async function diagnoseAgentWorkspaceIdentity(params: {
  tenantId: string;
  legacyAgentId: string;
  userId?: string;
  cfg: OpenBotConfig;
  stateDir?: string;
  registryStorePath?: string;
  seatStore?: EnterpriseSeatAssetsStore;
}): Promise<WorkspaceIdentityDiagnosis> {
  const tenantId = params.tenantId.trim();
  const legacyAgentId = params.legacyAgentId.trim();
  const cfgEntry = resolveAgentConfig(params.cfg, legacyAgentId);
  const displayName = cfgEntry?.name?.trim() || undefined;
  const stateDir = params.stateDir ?? resolveStateDir(process.env);
  const legacyWorkspacePath = path.join(stateDir, `workspace-${normalizeAgentId(legacyAgentId)}`);

  if (isBuiltinStewardAgent(legacyAgentId)) {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "builtin_universal",
      detail: "Universal builtin agents use per-user steward workspace, not seat catalog.",
      hasCatalog: false,
      legacyWorkspacePath,
    };
  }

  const seatStore =
    params.seatStore ?? (await loadSeatAssetsStoreForTenantId(tenantId, params.cfg));
  const seatContext =
    findSeatContextForLegacyAgent({ store: seatStore, tenantId, legacyAgentId }) ??
    (params.userId?.trim() ? { userId: params.userId.trim() } : null);

  const userId = seatContext?.userId;
  if (!userId) {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "missing_seat_context",
      detail: "No occupied seat grants this agent with a current employee.",
      hasCatalog: false,
      legacyWorkspacePath,
    };
  }

  const registry = await loadAgentRegistryStore(params.registryStorePath);
  const resolution = resolveLegacyAgentId({
    store: registry,
    enterpriseId: tenantId,
    legacyAgentId,
  });

  if (resolution.kind === "ambiguous") {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "registry_ambiguous",
      detail: `Multiple registry assets claim legacyAgentId (${resolution.candidateAgentAssetIds.join(", ")}).`,
      hasCatalog: false,
      seatId: seatContext?.seatId,
      userId,
      legacyWorkspacePath,
    };
  }

  const bySlug = findAgentAssetBySlug(registry, tenantId, legacyAgentId);
  if (
    (resolution.kind === "not-found" && bySlug && isMalformedRegistryAssetEntry(bySlug)) ||
    (resolution.kind === "resolved" && resolution.ref.agentAssetId.trim() === legacyAgentId)
  ) {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "malformed_registry_asset",
      detail: "Registry asset uses legacy slug as agentAssetId; Item 7 requires opaque UUID.",
      agentAssetId: bySlug?.agentAssetId ?? legacyAgentId,
      seatId: seatContext?.seatId,
      userId,
      hasCatalog: false,
      legacyWorkspacePath,
    };
  }

  const identity = await loadExistingGovernedWorkspaceIdentity({
    tenantId,
    userId,
    agentId: legacyAgentId,
    stateDir: params.stateDir,
    registryStorePath: params.registryStorePath,
  });
  if (identity.catalog && identity.agentAssetId) {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "catalog_ready",
      detail: "Registry and Workspace Catalog identity are present.",
      agentAssetId: identity.agentAssetId,
      seatId: seatContext?.seatId,
      userId,
      hasCatalog: true,
      legacyWorkspacePath,
    };
  }

  if (resolution.kind === "not-found") {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "registry_not_found",
      detail: "No canonical registry asset for this legacy agent id.",
      seatId: seatContext?.seatId,
      userId,
      hasCatalog: false,
      legacyWorkspacePath,
    };
  }

  if (resolution.kind === "builtin-universal") {
    return {
      tenantId,
      legacyAgentId,
      displayName,
      issue: "builtin_universal",
      detail: "Universal builtin agents use per-user steward workspace, not seat catalog.",
      seatId: seatContext?.seatId,
      userId,
      hasCatalog: false,
      legacyWorkspacePath,
    };
  }

  return {
    tenantId,
    legacyAgentId,
    displayName,
    issue: "catalog_projection_miss",
    detail: "Registry resolves but Workspace Catalog row is missing or incomplete.",
    agentAssetId: resolution.ref.agentAssetId,
    seatId: seatContext && "seatId" in seatContext ? seatContext.seatId : undefined,
    userId,
    hasCatalog: false,
    legacyWorkspacePath,
  };
}

export async function repairAgentWorkspaceIdentity(params: {
  tenantId: string;
  legacyAgentId: string;
  cfg: OpenBotConfig;
  apply: boolean;
  stateDir?: string;
  registryStorePath?: string;
  seatStore?: EnterpriseSeatAssetsStore;
  nowIso?: string;
}): Promise<{ diagnosis: WorkspaceIdentityDiagnosis; actions: WorkspaceIdentityRepairAction[] }> {
  const actions: WorkspaceIdentityRepairAction[] = [];
  const nowIso = params.nowIso ?? new Date().toISOString();
  const tenantId = params.tenantId.trim();
  const legacyAgentId = params.legacyAgentId.trim();

  let diagnosis = await diagnoseAgentWorkspaceIdentity(params);
  if (diagnosis.issue === "catalog_ready" || diagnosis.issue === "builtin_universal") {
    actions.push({
      action: "already_ready",
      legacyAgentId,
      agentAssetId: diagnosis.agentAssetId ?? legacyAgentId,
    });
    return { diagnosis, actions };
  }
  if (diagnosis.issue === "missing_seat_context" || diagnosis.issue === "registry_ambiguous") {
    actions.push({ action: "skipped", legacyAgentId, reason: diagnosis.detail });
    return { diagnosis, actions };
  }

  const registry = await loadAgentRegistryStore(params.registryStorePath);
  let registryDirty = false;

  if (diagnosis.issue === "malformed_registry_asset") {
    const repaired = repairMalformedRegistryAsset({
      store: registry,
      tenantId,
      legacyAgentId,
      nowIso,
      displayName: diagnosis.displayName,
      defaultOwner: diagnosis.userId
        ? { userId: diagnosis.userId, seatId: diagnosis.seatId ?? null }
        : undefined,
    });
    if (repaired.repaired && repaired.agentAssetId) {
      registryDirty = true;
      actions.push({
        action: "malformed_asset_repaired",
        legacyAgentId,
        fromAssetId: repaired.fromAssetId ?? legacyAgentId,
        toAssetId: repaired.agentAssetId,
      });
    }
  }

  if (diagnosis.issue === "registry_not_found") {
    const ownershipCandidates = selectBackfillCandidates(listOwnershipRecords()).filter(
      (entry) => entry.tenantId === tenantId && entry.legacyAgentId === legacyAgentId,
    );
    if (ownershipCandidates.length > 0) {
      const backfill = applyAgentRegistryBackfill({
        store: registry,
        agents: ownershipCandidates,
        nowIso,
      });
      const created = backfill.actions.find(
        (entry) =>
          entry.legacyAgentId === legacyAgentId &&
          (entry.action === "created" ||
            entry.action === "owner-bound" ||
            entry.action === "already-present"),
      );
      if (created && "agentAssetId" in created) {
        registryDirty = true;
        actions.push({
          action: "registry_backfill",
          legacyAgentId,
          agentAssetId: created.agentAssetId,
        });
      }
    }
  }

  if (registryDirty && params.apply) {
    await saveAgentRegistryStore(registry, params.registryStorePath);
  }

  diagnosis = await diagnoseAgentWorkspaceIdentity({
    ...params,
    seatStore: params.seatStore,
  });
  if (diagnosis.issue === "catalog_ready") {
    return { diagnosis, actions };
  }
  if (!diagnosis.userId) {
    actions.push({ action: "skipped", legacyAgentId, reason: diagnosis.detail });
    return { diagnosis, actions };
  }

  const workspaceLocator =
    resolveAgentConfig(params.cfg, legacyAgentId)?.workspace?.trim() ??
    diagnosis.legacyWorkspacePath ??
    "";

  if (params.apply) {
    const ensured = await ensureGovernedWorkspaceCatalogIdentity({
      tenantId,
      userId: diagnosis.userId,
      agentId: legacyAgentId,
      cfg: params.cfg,
      workspaceLocator,
      currentSeatId: diagnosis.seatId ?? null,
      stateDir: params.stateDir,
      registryStorePath: params.registryStorePath,
    });
    if (ensured.catalog && ensured.agentAssetId) {
      actions.push({
        action: "catalog_minted",
        legacyAgentId,
        agentAssetId: ensured.agentAssetId,
      });
      diagnosis = await diagnoseAgentWorkspaceIdentity(params);
      return { diagnosis, actions };
    }
  }

  diagnosis = {
    ...diagnosis,
    issue: params.apply ? "ensure_failed" : diagnosis.issue,
    detail: params.apply
      ? "ensureGovernedWorkspaceCatalogIdentity did not produce catalog identity."
      : `${diagnosis.detail} (dry-run; re-run with --apply to mint catalog)`,
  };
  if (!params.apply) {
    actions.push({
      action: "skipped",
      legacyAgentId,
      reason: "dry-run only",
    });
  } else {
    actions.push({ action: "skipped", legacyAgentId, reason: diagnosis.detail });
  }
  return { diagnosis, actions };
}

export async function runWorkspaceIdentityRepairPlan(params: {
  tenantId: string;
  cfg: OpenBotConfig;
  apply: boolean;
  agentFilter?: string;
  stateDir?: string;
  registryStorePath?: string;
}): Promise<WorkspaceIdentityRepairReport> {
  const tenantId = params.tenantId.trim();
  const seatStore = await loadSeatAssetsStoreForTenantId(tenantId, params.cfg);
  const agentIds = collectSeatLegacyAgentIds({
    store: seatStore,
    tenantId,
    agentFilter: params.agentFilter,
  });

  const diagnoses: WorkspaceIdentityDiagnosis[] = [];
  const actions: WorkspaceIdentityRepairAction[] = [];
  let registryBackfill: BackfillReport | undefined;

  if (params.apply) {
    const registry = await loadAgentRegistryStore(params.registryStorePath);
    const candidates = selectBackfillCandidates(listOwnershipRecords()).filter(
      (entry) => entry.tenantId === tenantId,
    );
    registryBackfill = applyAgentRegistryBackfill({
      store: registry,
      agents: candidates,
      nowIso: new Date().toISOString(),
    });
    if (
      registryBackfill.actions.some(
        (entry) => entry.action === "created" || entry.action === "owner-bound",
      )
    ) {
      await saveAgentRegistryStore(registry, params.registryStorePath);
    }
  }

  for (const legacyAgentId of agentIds) {
    const result = await repairAgentWorkspaceIdentity({
      tenantId,
      legacyAgentId,
      cfg: params.cfg,
      apply: params.apply,
      stateDir: params.stateDir,
      registryStorePath: params.registryStorePath,
      seatStore,
    });
    diagnoses.push(result.diagnosis);
    actions.push(...result.actions);
  }

  return {
    tenantId,
    apply: params.apply,
    diagnoses,
    registryBackfill,
    actions,
  };
}
