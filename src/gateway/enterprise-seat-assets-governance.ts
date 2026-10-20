import { randomUUID } from "node:crypto";
import { recordEnterpriseAssetAuditEvent } from "./enterprise-seat-assets-audit.js";
import type {
  EnterpriseConnectorCredentialBinding,
  EnterpriseConnectorProfileSnapshot,
  EnterpriseGovernanceCheck,
  EnterpriseHandoverAssetSnapshot,
  EnterpriseHandoverSessionDataTransfer,
  EnterpriseHandoverTransferSelection,
  EnterpriseManagedAssetType,
  EnterpriseMemoryScopeSnapshot,
  EnterpriseMemoryTransferClass,
  EnterprisePositionSeat,
  EnterpriseSeatAssetBinding,
  EnterpriseSeatAssetBindingStatus,
  EnterpriseSeatAssetsStore,
  EnterpriseSeatBinding,
} from "./enterprise-seat-assets-store.js";

export const HANDOVER_DATA_KEYS = new Set(["recent_sessions", "knowledge", "history_archive"]);

export function normalizeHandoverTransferSelection(
  raw: unknown,
): EnterpriseHandoverTransferSelection | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const agentIds = Array.isArray(record.agentIds)
    ? [...new Set(record.agentIds.map((value) => String(value).trim()).filter(Boolean))].toSorted()
    : [];
  const spaceIds = Array.isArray(record.spaceIds)
    ? [...new Set(record.spaceIds.map((value) => String(value).trim()).filter(Boolean))].toSorted()
    : [];
  const dataKeys = Array.isArray(record.dataKeys)
    ? [
        ...new Set(
          record.dataKeys
            .map((value) => String(value).trim())
            .filter((value) => HANDOVER_DATA_KEYS.has(value)),
        ),
      ].toSorted()
    : [];
  const policyIds = Array.isArray(record.policyIds)
    ? [...new Set(record.policyIds.map((value) => String(value).trim()).filter(Boolean))].toSorted()
    : [];
  if (agentIds.length + spaceIds.length + dataKeys.length + policyIds.length === 0) {
    return undefined;
  }
  return { agentIds, spaceIds, dataKeys, policyIds };
}

export function assertHandoverTransferSelection(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
  selection: EnterpriseHandoverTransferSelection;
}): void {
  const allowedAgents = new Set(params.seat.defaultAgentAssetIds);
  for (const agentId of params.selection.agentIds) {
    if (!allowedAgents.has(agentId)) {
      throw new Error(`Unknown agent asset: ${agentId}`);
    }
  }
  const allowedSpaces = new Set(params.seat.defaultSpaceIds);
  for (const binding of listActiveSeatAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seat.seatId,
  })) {
    if (binding.assetType === "space") {
      allowedSpaces.add(binding.assetId);
    }
  }
  for (const spaceId of params.selection.spaceIds) {
    if (!allowedSpaces.has(spaceId)) {
      throw new Error(`Unknown space asset: ${spaceId}`);
    }
  }
  if (
    params.selection.agentIds.length === 0 &&
    params.selection.spaceIds.length === 0 &&
    params.selection.dataKeys.length === 0
  ) {
    throw new Error("At least one inheritable asset must be selected.");
  }
}

export function applyHandoverTransferSelection(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
  selection: EnterpriseHandoverTransferSelection;
  nowIso: string;
  actorEmployeeId?: string;
}): { revokedBindingIds: string[] } {
  const includeKnowledge = params.selection.dataKeys.includes("knowledge");
  const beforeRevoked = new Set(
    Object.values(params.store.assetBindings)
      .filter(
        (binding) =>
          binding.tenantId === params.tenantId &&
          binding.seatId === params.seat.seatId &&
          binding.revokedAt,
      )
      .map((binding) => binding.assetBindingId),
  );

  params.seat.defaultAgentAssetIds = [...params.selection.agentIds];
  params.seat.defaultSpaceIds = [...params.selection.spaceIds];
  params.seat.memoryScopeEnabled = includeKnowledge;
  params.seat.updatedAt = params.nowIso;

  syncSeatManagedAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seat: params.seat,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
  });

  const revokedBindingIds = Object.values(params.store.assetBindings)
    .filter(
      (binding) =>
        binding.tenantId === params.tenantId &&
        binding.seatId === params.seat.seatId &&
        binding.revokedAt === params.nowIso &&
        !beforeRevoked.has(binding.assetBindingId),
    )
    .map((binding) => binding.assetBindingId)
    .toSorted();

  return { revokedBindingIds };
}

function buildHandoverSessionDataTransfer(
  selection?: EnterpriseHandoverTransferSelection,
): EnterpriseHandoverSessionDataTransfer {
  if (!selection) {
    return {
      recentSessions: false,
      historyArchive: false,
      coveredAgentIds: [],
    };
  }
  return {
    recentSessions: selection.dataKeys.includes("recent_sessions"),
    historyArchive: selection.dataKeys.includes("history_archive"),
    coveredAgentIds: [...selection.agentIds],
  };
}

export function resolveSeatMemoryScopeId(seatId: string): string {
  return `seat:${seatId}`;
}

function activeAssetBindingKey(binding: EnterpriseSeatAssetBinding): string {
  return `${binding.assetType}:${binding.assetId}`;
}

export function classifySeatMemoryTransferScope(params: {
  seatId: string;
  scopeId: string;
}): EnterpriseMemoryTransferClass {
  if (params.scopeId === resolveSeatMemoryScopeId(params.seatId)) {
    return "inheritable";
  }
  const normalized = params.scopeId.trim().toLowerCase();
  if (
    normalized.includes("private") ||
    normalized.includes("personal") ||
    normalized.includes("salary") ||
    normalized.includes("payroll") ||
    normalized.includes("performance") ||
    normalized.includes("hr")
  ) {
    return "private";
  }
  if (
    normalized.includes("review") ||
    normalized.includes("customer") ||
    normalized.includes("client") ||
    normalized.includes("crm") ||
    normalized.includes("project") ||
    normalized.includes("sensitive")
  ) {
    return "review_required";
  }
  return "review_required";
}

export function listActiveSeatAssetBindings(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
}): EnterpriseSeatAssetBinding[] {
  return Object.values(params.store.assetBindings).filter(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.seatId === params.seatId &&
      !binding.revokedAt &&
      binding.status !== "revoked",
  );
}

export function buildSeatMemoryScopeSnapshots(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  includePrivate?: boolean;
}): EnterpriseMemoryScopeSnapshot[] {
  return listActiveSeatAssetBindings(params)
    .filter((binding) => binding.assetType === "memory")
    .map((binding) => ({
      scopeId: binding.assetId,
      transferClass: classifySeatMemoryTransferScope({
        seatId: params.seatId,
        scopeId: binding.assetId,
      }),
    }))
    .filter((snapshot) => params.includePrivate === true || snapshot.transferClass !== "private")
    .toSorted((left, right) => left.scopeId.localeCompare(right.scopeId));
}

function activeSeatCredentialBindings(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
}): EnterpriseConnectorCredentialBinding[] {
  return Object.values(params.store.credentialBindings).filter(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.status !== "revoked" &&
      ((binding.ownerType === "seat" && binding.ownerId === params.seatId) ||
        (binding.ownerType === "employee" &&
          Object.values(params.store.bindings).some(
            (seatBinding) =>
              seatBinding.tenantId === params.tenantId &&
              seatBinding.seatId === params.seatId &&
              seatBinding.employeeId === binding.ownerId,
          ))),
  );
}

export function buildSeatConnectorProfileSnapshots(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
}): EnterpriseConnectorProfileSnapshot[] {
  const credentials = activeSeatCredentialBindings(params);
  return listActiveSeatAssetBindings(params)
    .filter((binding) => binding.assetType === "connector")
    .map((binding) => ({
      profileId: binding.assetId,
      credentialReauthorizationRequired:
        binding.status === "rebind_required" ||
        binding.requiresReauthorization === true ||
        credentials.some(
          (credential) =>
            credential.connectorId === binding.assetId &&
            credential.status === "reauthorization_required",
        ),
    }))
    .toSorted((left, right) => left.profileId.localeCompare(right.profileId));
}

function upsertSeatAssetBinding(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  assetType: EnterpriseManagedAssetType;
  assetId: string;
  source: EnterpriseSeatAssetBinding["source"];
  status?: EnterpriseSeatAssetBindingStatus;
  requiresReauthorization?: boolean;
  createdBy?: string;
  nowIso: string;
}): EnterpriseSeatAssetBinding {
  const existing =
    Object.values(params.store.assetBindings)
      .filter(
        (binding) =>
          binding.tenantId === params.tenantId &&
          binding.seatId === params.seatId &&
          binding.assetType === params.assetType &&
          binding.assetId === params.assetId &&
          !binding.revokedAt,
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  if (existing) {
    existing.status = params.status ?? "active";
    existing.source = params.source;
    existing.requiresReauthorization = params.requiresReauthorization || undefined;
    existing.updatedAt = params.nowIso;
    delete existing.handoverCaseId;
    delete existing.frozenAt;
    delete existing.reboundAt;
    return existing;
  }
  const binding: EnterpriseSeatAssetBinding = {
    assetBindingId: randomUUID(),
    tenantId: params.tenantId,
    seatId: params.seatId,
    assetType: params.assetType,
    assetId: params.assetId,
    status: params.status ?? "active",
    source: params.source,
    ...(params.requiresReauthorization ? { requiresReauthorization: true } : {}),
    ...(params.createdBy ? { createdBy: params.createdBy } : {}),
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.assetBindings[binding.assetBindingId] = binding;
  return binding;
}

export function attachSeatManagedAsset(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  assetType: EnterpriseManagedAssetType;
  assetId: string;
  source?: EnterpriseSeatAssetBinding["source"];
  requiresReauthorization?: boolean;
  createdBy?: string;
  nowIso: string;
  auditId?: string;
}): EnterpriseSeatAssetBinding {
  const binding = upsertSeatAssetBinding({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    assetType: params.assetType,
    assetId: params.assetId,
    source: params.source ?? "manual",
    requiresReauthorization: params.requiresReauthorization,
    createdBy: params.createdBy,
    nowIso: params.nowIso,
  });
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "seat.assets_configured",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.createdBy,
    seatId: params.seatId,
    resourceType:
      params.assetType === "agent" ||
      params.assetType === "space" ||
      params.assetType === "memory" ||
      params.assetType === "connector" ||
      params.assetType === "capability"
        ? params.assetType
        : undefined,
    resourceId: params.assetId,
    metadata: {
      source: params.source ?? "manual",
      requiresReauthorization: Boolean(params.requiresReauthorization),
    },
  });
  return binding;
}

export function syncSeatManagedAssetBindings(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
  nowIso: string;
  actorEmployeeId?: string;
}) {
  const desired = new Set<string>();
  for (const agentId of params.seat.defaultAgentAssetIds) {
    const binding = upsertSeatAssetBinding({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.seat.seatId,
      assetType: "agent",
      assetId: agentId,
      source: "seat_default",
      nowIso: params.nowIso,
      createdBy: params.actorEmployeeId,
    });
    desired.add(activeAssetBindingKey(binding));
  }
  for (const spaceId of params.seat.defaultSpaceIds) {
    const binding = upsertSeatAssetBinding({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.seat.seatId,
      assetType: "space",
      assetId: spaceId,
      source: "seat_default",
      nowIso: params.nowIso,
      createdBy: params.actorEmployeeId,
    });
    desired.add(activeAssetBindingKey(binding));
  }
  if (params.seat.memoryScopeEnabled !== false) {
    const memoryBinding = upsertSeatAssetBinding({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.seat.seatId,
      assetType: "memory",
      assetId: resolveSeatMemoryScopeId(params.seat.seatId),
      source: "seat_default",
      nowIso: params.nowIso,
      createdBy: params.actorEmployeeId,
    });
    desired.add(activeAssetBindingKey(memoryBinding));
  }
  for (const binding of listActiveSeatAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seat.seatId,
  })) {
    if (
      binding.source === "seat_default" &&
      (binding.assetType === "agent" ||
        binding.assetType === "space" ||
        binding.assetType === "memory") &&
      !desired.has(activeAssetBindingKey(binding))
    ) {
      binding.status = "revoked";
      binding.revokedAt = params.nowIso;
      binding.updatedAt = params.nowIso;
    }
  }
}

export function buildHandoverAssetSnapshot(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  nowIso: string;
  transferSelection?: EnterpriseHandoverTransferSelection;
}): EnterpriseHandoverAssetSnapshot {
  const assetBindings = listActiveSeatAssetBindings(params);
  const credentials = activeSeatCredentialBindings(params);
  const selection = params.transferSelection;
  const selectedAgentIds = selection ? new Set(selection.agentIds) : null;
  const selectedSpaceIds = selection ? new Set(selection.spaceIds) : null;
  const includeKnowledge = !selection || selection.dataKeys.includes("knowledge");

  let agentBindings = assetBindings.filter((binding) => binding.assetType === "agent");
  let spaceBindings = assetBindings.filter((binding) => binding.assetType === "space");
  if (selectedAgentIds) {
    agentBindings = agentBindings.filter((binding) => selectedAgentIds.has(binding.assetId));
  }
  if (selectedSpaceIds) {
    spaceBindings = spaceBindings.filter((binding) => selectedSpaceIds.has(binding.assetId));
  }

  let memoryScopes = buildSeatMemoryScopeSnapshots({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
  });
  if (selection && !includeKnowledge) {
    memoryScopes = [];
  }

  const connectorProfiles = buildSeatConnectorProfileSnapshots({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
  });
  const includedBindingIds = new Set(
    [...agentBindings, ...spaceBindings]
      .map((binding) => binding.assetBindingId)
      .concat(
        assetBindings
          .filter(
            (binding) =>
              binding.assetType === "memory" &&
              (!selection || includeKnowledge) &&
              binding.assetId === resolveSeatMemoryScopeId(params.seatId),
          )
          .map((binding) => binding.assetBindingId),
      )
      .concat(
        assetBindings
          .filter((binding) => binding.assetType === "connector")
          .map((binding) => binding.assetBindingId),
      ),
  );
  return {
    agentIds: agentBindings.map((binding) => binding.assetId).toSorted(),
    spaceIds: spaceBindings.map((binding) => binding.assetId).toSorted(),
    memoryScopeIds: memoryScopes.map((scope) => scope.scopeId),
    memoryScopes,
    dataKeys: selection ? [...selection.dataKeys] : [],
    sessionDataTransfer: buildHandoverSessionDataTransfer(selection),
    connectorIds: connectorProfiles.map((profile) => profile.profileId),
    connectorProfileIds: connectorProfiles.map((profile) => profile.profileId),
    connectorProfiles,
    connectorCredentialReauthorizationRequired: connectorProfiles.some(
      (profile) => profile.credentialReauthorizationRequired,
    ),
    credentialBindings: credentials.map((credential) => ({
      credentialBindingId: credential.credentialBindingId,
      connectorId: credential.connectorId,
      ownerType: credential.ownerType,
      ownerId: credential.ownerId,
      status: credential.status,
    })),
    frozenAssetBindingIds: assetBindings
      .filter(
        (binding) =>
          binding.status === "handover_frozen" && includedBindingIds.has(binding.assetBindingId),
      )
      .map((binding) => binding.assetBindingId)
      .toSorted(),
    rebindRequiredAssetBindingIds: assetBindings
      .filter(
        (binding) =>
          binding.status === "rebind_required" && includedBindingIds.has(binding.assetBindingId),
      )
      .map((binding) => binding.assetBindingId)
      .toSorted(),
    ...(selection ? { transferSelection: selection } : {}),
    generatedAt: params.nowIso,
  };
}

export function freezeSeatManagedAssetsForHandover(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  handoverCaseId: string;
  outgoingEmployeeId: string;
  nowIso: string;
}) {
  for (const binding of listActiveSeatAssetBindings(params)) {
    binding.handoverCaseId = params.handoverCaseId;
    binding.status =
      binding.assetType === "connector" || binding.requiresReauthorization
        ? "rebind_required"
        : "handover_frozen";
    binding.frozenAt = params.nowIso;
    binding.updatedAt = params.nowIso;
  }
  for (const credential of Object.values(params.store.credentialBindings)) {
    if (
      credential.tenantId !== params.tenantId ||
      credential.status !== "active" ||
      credential.ownerType !== "employee" ||
      credential.ownerId !== params.outgoingEmployeeId
    ) {
      continue;
    }
    credential.status = "reauthorization_required";
    credential.handoverCaseId = params.handoverCaseId;
    credential.revokedAt = params.nowIso;
    credential.revokedReason = "handover_reauth_required";
    credential.updatedAt = params.nowIso;
  }
}

export function reactivateSeatManagedAssetsAfterHandover(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  handoverCaseId?: string;
  nowIso: string;
}) {
  for (const binding of listActiveSeatAssetBindings(params)) {
    if (
      binding.status !== "handover_frozen" &&
      binding.status !== "rebind_required" &&
      binding.handoverCaseId !== params.handoverCaseId
    ) {
      continue;
    }
    if (binding.assetType === "connector" || binding.requiresReauthorization) {
      binding.status = "rebind_required";
    } else {
      binding.status = "active";
    }
    binding.reboundAt = params.nowIso;
    binding.updatedAt = params.nowIso;
  }
}

export function listTenantSeatAssetBindings(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseSeatAssetBinding[] {
  return Object.values(store.assetBindings)
    .filter((binding) => binding.tenantId === tenantId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function validateEnterpriseAssetGovernance(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseGovernanceCheck[] {
  const checks: EnterpriseGovernanceCheck[] = [];
  const activeBindings = Object.values(store.bindings).filter(
    (binding) => binding.tenantId === tenantId && binding.bindingStatus === "active",
  );
  const activeBindingsBySeat = new Map<string, EnterpriseSeatBinding[]>();
  const activeBindingsByEmployee = new Map<string, EnterpriseSeatBinding[]>();
  for (const binding of activeBindings) {
    activeBindingsBySeat.set(binding.seatId, [
      ...(activeBindingsBySeat.get(binding.seatId) ?? []),
      binding,
    ]);
    activeBindingsByEmployee.set(binding.employeeId, [
      ...(activeBindingsByEmployee.get(binding.employeeId) ?? []),
      binding,
    ]);
  }
  for (const [seatId, bindings] of activeBindingsBySeat) {
    if (bindings.length > 1) {
      checks.push({
        code: "seat_multiple_active_bindings",
        severity: "error",
        tenantId,
        seatId,
        message: "A position seat has more than one active employee binding.",
      });
    }
  }
  for (const [employeeId, bindings] of activeBindingsByEmployee) {
    if (bindings.length > 1) {
      checks.push({
        code: "employee_multiple_active_seats",
        severity: "error",
        tenantId,
        employeeId,
        message: "An employee is actively bound to more than one position seat.",
      });
    }
  }
  for (const seat of Object.values(store.seats).filter((entry) => entry.tenantId === tenantId)) {
    const seatBindings = activeBindingsBySeat.get(seat.seatId) ?? [];
    if (seat.status === "assigned" && seatBindings.length > 0) {
      checks.push({
        code: "assigned_seat_should_not_have_active_binding",
        severity: "error",
        tenantId,
        seatId: seat.seatId,
        message: "An assigned seat must not already have an active employee binding.",
      });
    }
    if (seat.status === "assigned" && seat.currentEmployeeId) {
      checks.push({
        code: "assigned_seat_should_not_have_current_employee",
        severity: "error",
        tenantId,
        seatId: seat.seatId,
        employeeId: seat.currentEmployeeId,
        message: "An assigned seat must not set a current employee before acceptance.",
      });
    }
    if (seat.status === "occupied" && seatBindings.length !== 1) {
      checks.push({
        code: "occupied_seat_binding_mismatch",
        severity: "error",
        tenantId,
        seatId: seat.seatId,
        message: "An occupied seat must have exactly one active employee binding.",
      });
    }
    if (seat.status === "occupied" && seatBindings[0]?.employeeId !== seat.currentEmployeeId) {
      checks.push({
        code: "occupied_seat_employee_mismatch",
        severity: "error",
        tenantId,
        seatId: seat.seatId,
        employeeId: seat.currentEmployeeId,
        message: "The occupied seat current employee does not match its active binding.",
      });
    }
    if (
      (seat.status === "handover_pending" || seat.status === "frozen") &&
      seat.currentEmployeeId
    ) {
      checks.push({
        code: "handover_seat_still_has_employee",
        severity: "error",
        tenantId,
        seatId: seat.seatId,
        employeeId: seat.currentEmployeeId,
        message: "A handover seat must not keep a current employee binding pointer.",
      });
    }
    const memoryBinding = listActiveSeatAssetBindings({
      store,
      tenantId,
      seatId: seat.seatId,
    }).find(
      (binding) =>
        binding.assetType === "memory" && binding.assetId === resolveSeatMemoryScopeId(seat.seatId),
    );
    if (!memoryBinding) {
      checks.push({
        code: "seat_memory_scope_missing",
        severity: "warning",
        tenantId,
        seatId: seat.seatId,
        message: "A position seat should own a stable memory scope for governed succession.",
      });
    }
  }
  for (const handover of Object.values(store.handovers).filter(
    (entry) => entry.tenantId === tenantId && entry.status !== "completed",
  )) {
    if (!handover.assetSnapshot) {
      checks.push({
        code: "handover_asset_snapshot_missing",
        severity: "warning",
        tenantId,
        seatId: handover.seatId,
        handoverCaseId: handover.handoverCaseId,
        message: "An open handover case should include an asset snapshot.",
      });
    }
    const unfrozenAssets = listActiveSeatAssetBindings({
      store,
      tenantId,
      seatId: handover.seatId,
    }).filter(
      (binding) =>
        binding.assetType !== "capability" &&
        binding.status === "active" &&
        !binding.requiresReauthorization,
    );
    if (unfrozenAssets.length > 0) {
      checks.push({
        code: "handover_assets_not_frozen",
        severity: "warning",
        tenantId,
        seatId: handover.seatId,
        handoverCaseId: handover.handoverCaseId,
        message: "An open handover has active inheritable assets that should be frozen.",
      });
    }
  }
  for (const credential of Object.values(store.credentialBindings).filter(
    (entry) => entry.tenantId === tenantId,
  )) {
    if (
      credential.ownerType === "employee" &&
      credential.status === "active" &&
      activeBindingsByEmployee.get(credential.ownerId)?.length === 0
    ) {
      checks.push({
        code: "orphan_employee_credential",
        severity: "warning",
        tenantId,
        employeeId: credential.ownerId,
        message: "An employee-owned connector credential is active without an active seat binding.",
      });
    }
  }
  return checks;
}
