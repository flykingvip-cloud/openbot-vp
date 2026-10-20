/**
 * Item 2 production Catalog SoT gates. Measure records already in the
 * production Catalog. Do not invent identity from agentId, path, stateDir,
 * display name, Phase 0, or U0 inventory.
 */

const USER_OWNED_ASSET = /^ws:([^:]+):user:([^:]+):asset:(.+)$/;
const SEAT_OWNED_ASSET = /^ws:([^:]+):seat:([^:]+):asset:(.+)$/;
const USER_STEWARD = /^ws:([^:]+):user:([^:]+):steward$/;
const GROUP_SHARED = /^ws:([^:]+):group:([^:]+)$/;
const QUARANTINE_LIFECYCLES = new Set(["quarantined", "recovery_required"]);
const NORMAL_LIFECYCLES = new Set(["active", "read_only"]);

export function workspaceKindFromResourceId(resourceId) {
  if (USER_STEWARD.test(resourceId)) {
    return "employee_private";
  }
  if (USER_OWNED_ASSET.test(resourceId) || SEAT_OWNED_ASSET.test(resourceId)) {
    return "agent_primary";
  }
  if (GROUP_SHARED.test(resourceId)) {
    return "group_shared";
  }
  return null;
}

export function parseWorkspaceResourceId(resourceId) {
  const steward = USER_STEWARD.exec(resourceId);
  if (steward) {
    return {
      kind: "employee_private",
      tenantId: steward[1],
      userId: steward[2],
      agentAssetId: null,
    };
  }
  const userAsset = USER_OWNED_ASSET.exec(resourceId);
  if (userAsset) {
    return {
      kind: "agent_primary",
      tenantId: userAsset[1],
      userId: userAsset[2],
      agentAssetId: userAsset[3],
    };
  }
  const seatAsset = SEAT_OWNED_ASSET.exec(resourceId);
  if (seatAsset) {
    return {
      kind: "agent_primary",
      tenantId: seatAsset[1],
      seatId: seatAsset[2],
      agentAssetId: seatAsset[3],
    };
  }
  const group = GROUP_SHARED.exec(resourceId);
  if (group) {
    return { kind: "group_shared", tenantId: group[1], groupId: group[2], agentAssetId: null };
  }
  return null;
}

function activeCanonicals(record) {
  return (record.bindings ?? []).filter(
    (binding) => binding?.role === "canonical" && binding?.state === "active",
  );
}

function ownerMatches(envelope, parsed) {
  if (!envelope?.owner || !parsed) {
    return false;
  }
  if (parsed.userId) {
    return envelope.owner.kind === "user" && envelope.owner.userId === parsed.userId;
  }
  if (parsed.seatId) {
    return envelope.owner.kind === "position" && envelope.owner.seatId === parsed.seatId;
  }
  if (parsed.groupId) {
    return envelope.owner.kind === "group" && envelope.owner.groupId === parsed.groupId;
  }
  return false;
}

export function measureProductionCatalogSotGates(params) {
  const records = Array.isArray(params.records) ? params.records : [];
  const population = params.population === "all-workspace" ? "all-workspace" : "authority-shaped";
  const workspace = records.filter((row) => row?.envelope?.resourceType === "workspace");
  const memory = records.filter((row) => row?.envelope?.resourceType === "memory");
  const normal = [];
  const quarantined = [];
  for (const record of workspace) {
    const lifecycle = record.envelope?.lifecycleState;
    if (QUARANTINE_LIFECYCLES.has(lifecycle) || lifecycle === "pending") {
      quarantined.push(record);
      continue;
    }
    normal.push(record);
  }

  const residualOpaque = normal.filter(
    (record) => !parseWorkspaceResourceId(record.envelope?.resourceId ?? ""),
  );
  const gated =
    population === "authority-shaped"
      ? normal.filter((record) => parseWorkspaceResourceId(record.envelope?.resourceId ?? ""))
      : normal;

  const authorityFailures = [];
  const tenantOwnerFailures = [];
  const bindingFailures = [];
  const lifecycleFailures = [];
  const seenCanonical = new Map();

  for (const record of gated) {
    const envelope = record.envelope ?? {};
    const parsed = parseWorkspaceResourceId(envelope.resourceId ?? "");
    const kind = parsed?.kind ?? null;
    const bindings = activeCanonicals(record);
    const canonical = bindings[0];
    if (
      !envelope.resourceId ||
      !envelope.tenantId ||
      !kind ||
      !envelope.owner ||
      !envelope.governanceVersion ||
      !envelope.lifecycleState ||
      !canonical ||
      (kind === "agent_primary" && !parsed?.agentAssetId)
    ) {
      authorityFailures.push(envelope.resourceId ?? "missing");
    }
    if (!parsed || parsed.tenantId !== envelope.tenantId || !ownerMatches(envelope, parsed)) {
      tenantOwnerFailures.push(envelope.resourceId ?? "missing");
    }
    const canonicalKey = `${canonical?.locator ?? ""}::${canonical?.objectKey ?? ""}`;
    if (bindings.length !== 1 || canonical?.resourceId !== envelope.resourceId) {
      bindingFailures.push(envelope.resourceId ?? "missing");
    } else if (seenCanonical.has(canonicalKey)) {
      bindingFailures.push(envelope.resourceId ?? "missing");
    } else {
      seenCanonical.set(canonicalKey, envelope.resourceId);
    }
    if (
      !NORMAL_LIFECYCLES.has(envelope.lifecycleState) ||
      (population === "all-workspace" && !parsed)
    ) {
      lifecycleFailures.push(envelope.resourceId ?? "missing");
    }
  }

  const workspaceIds = new Set(workspace.map((row) => row.envelope?.resourceId).filter(Boolean));
  const memoryIds = new Set(memory.map((row) => row.envelope?.resourceId).filter(Boolean));
  let memoryRelationOk = true;
  for (const record of memory) {
    const memoryId = record.envelope?.resourceId;
    const source = record.envelope?.projection?.sourceWorkspaceResourceId;
    if (!memoryId || workspaceIds.has(memoryId) || !source || !workspaceIds.has(source)) {
      memoryRelationOk = false;
    }
  }
  for (const workspaceId of workspaceIds) {
    if (memoryIds.has(workspaceId)) {
      memoryRelationOk = false;
    }
  }

  const userOwned = new Map();
  for (const record of normal) {
    const parsed = parseWorkspaceResourceId(record.envelope.resourceId);
    if (parsed?.kind !== "agent_primary" || !parsed.userId || !parsed.agentAssetId) {
      continue;
    }
    const key = `${parsed.tenantId}:${parsed.userId}`;
    const assets = userOwned.get(key) ?? new Set();
    assets.add(parsed.agentAssetId);
    userOwned.set(key, assets);
  }
  const uniqueUserOwnedEquivalent = [...userOwned.values()].filter(
    (assets) => assets.size === 1,
  ).length;

  const residualBlocksAllWorkspace = population === "all-workspace" && residualOpaque.length > 0;
  const gates = {
    authority: {
      required: "every Item 2 normal Catalog record carries authority fields",
      population,
      records: gated.length,
      failures: authorityFailures.length,
      gate: gated.length > 0 && authorityFailures.length === 0 ? "pass" : "fail",
    },
    tenant_owner: {
      required: "tenant/owner match resourceId authority segments",
      population,
      records: gated.length,
      failures: tenantOwnerFailures.length,
      gate: gated.length > 0 && tenantOwnerFailures.length === 0 ? "pass" : "fail",
    },
    binding_canonical_uniqueness: {
      required: "one active canonical binding; locator+objectKey unique",
      population,
      records: gated.length,
      failures: bindingFailures.length,
      gate: gated.length > 0 && bindingFailures.length === 0 ? "pass" : "fail",
    },
    lifecycle_conflict_quarantine: {
      required: "unknown/conflict/quarantine stay out of the Item 2 normal Catalog",
      population,
      normal: gated.length,
      quarantined: quarantined.length,
      residualOpaque: residualOpaque.length,
      failures: lifecycleFailures.length,
      gate: lifecycleFailures.length === 0 && !residualBlocksAllWorkspace ? "pass" : "fail",
    },
  };

  const fourGates100 = Object.values(gates).every((gate) => gate.gate === "pass");
  return {
    gates,
    fourGatePopulation: population,
    fourGates100,
    authorityCatalogGatesPass: fourGates100,
    uniqueUserOwnedEquivalent,
    uniqueUserOwnedUsers: userOwned.size,
    residualOpaqueWorkspaceRecords: residualOpaque.length,
    authorityShapedWorkspaceRecords: normal.length - residualOpaque.length,
    normalWorkspaceRecords: normal.length,
    quarantinedWorkspaceRecords: quarantined.length,
    memoryRecords: memory.length,
    memoryRelationOk,
    workspaceMemoryIdCollision: [...workspaceIds].some((id) => memoryIds.has(id)),
  };
}
