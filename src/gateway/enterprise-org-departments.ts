import { randomUUID } from "node:crypto";
import {
  departmentParentPath,
  ensureOrganizationChildOrdersStore,
  organizationChildDepartmentKey,
  organizationChildOrderStorageKey,
  organizationChildSeatKey,
  relocateOrganizationChildInOrders,
} from "./enterprise-org-child-order.js";
import {
  collectOrganizationStructurePrefixPaths,
  remapOrganizationTeamLabel,
  resolveOrganizationFullPath,
  splitOrganizationPath,
} from "./enterprise-org-path.js";
import { recordEnterpriseAssetAuditEvent as recordAuditEvent } from "./enterprise-seat-assets-audit.js";
import type {
  EnterpriseOrganizationDepartment,
  EnterprisePositionSeat,
  EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import { configureSeatProfile, deleteVacantPositionSeat } from "./enterprise-seat-assets-store.js";

export type { EnterpriseOrganizationDepartment };

export type OrganizationDepartmentMutationAction =
  | "create"
  | "rename"
  | "move"
  | "delete"
  | "move-seat"
  | "delete-seat"
  | "merge"
  | "sync-structure"
  | "reorder-children";

export type OrganizationDepartmentMutation = {
  action: OrganizationDepartmentMutationAction;
  path?: string | null;
  label?: string | null;
  parentPath?: string | null;
  seatId?: string | null;
  targetPath?: string | null;
  paths?: string[] | null;
  orderedKeys?: string[] | null;
};

function normalizeDepartmentPath(
  path: string | null | undefined,
  options?: { allowUngrouped?: boolean },
): string {
  const parts = splitOrganizationPath(path);
  if (parts.length === 1 && parts[0] === "未分组" && !options?.allowUngrouped) {
    throw new Error("未分组部门不支持结构变更。");
  }
  return resolveOrganizationFullPath(parts);
}

/** Empty/missing seat teamLabel is displayed and matched as 未分组. */
function effectiveSeatTeamLabel(teamLabel: string | null | undefined): string {
  return teamLabel?.trim() || "未分组";
}

function listTenantSeats(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterprisePositionSeat[] {
  return Object.values(store.seats).filter((seat) => seat.tenantId === tenantId);
}

function listDirectOrganizationChildKeys(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
  parentPath: string,
): string[] {
  const normalizedParent = parentPath.trim();
  const keys: string[] = [];
  for (const path of listTenantOrganizationDepartmentPaths(store, tenantId)) {
    if (departmentParentPath(path) === normalizedParent) {
      keys.push(organizationChildDepartmentKey(path));
    }
  }
  for (const seat of listTenantSeats(store, tenantId)) {
    const teamLabel = seat.teamLabel?.trim() || "未分组";
    if (teamLabel === normalizedParent) {
      keys.push(organizationChildSeatKey(seat.seatId));
    }
  }
  return keys;
}

export function listTenantOrganizationDepartmentPaths(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): string[] {
  const paths = new Set<string>();
  for (const seat of listTenantSeats(store, tenantId)) {
    const parts = splitOrganizationPath(seat.teamLabel);
    for (let index = 0; index < parts.length; index += 1) {
      paths.add(resolveOrganizationFullPath(parts.slice(0, index + 1)));
    }
  }
  for (const department of Object.values(store.organizationDepartments ?? {})) {
    if (department.tenantId === tenantId) {
      paths.add(department.fullPath);
    }
  }
  return [...paths].toSorted((left, right) => left.localeCompare(right, "zh-CN"));
}

function tenantHasSeatsUnderPath(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
  path: string,
): boolean {
  return listTenantSeats(store, tenantId).some((seat) => {
    const teamLabel = seat.teamLabel?.trim() || "未分组";
    return teamLabel === path || teamLabel.startsWith(`${path}/`);
  });
}

function remapTenantOrganizationPaths(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  oldPrefix: string;
  newPrefix: string;
  nowIso: string;
}) {
  const departments = params.store.organizationDepartments ?? {};
  for (const department of Object.values(departments)) {
    if (department.tenantId !== params.tenantId) {
      continue;
    }
    const remapped = remapOrganizationTeamLabel({
      teamLabel: department.fullPath,
      oldPrefix: params.oldPrefix,
      newPrefix: params.newPrefix,
    });
    if (remapped && remapped !== department.fullPath) {
      department.fullPath = remapped;
      department.updatedAt = params.nowIso;
    }
  }
}

function remapTenantSeatTeamLabels(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  oldPrefix: string;
  newPrefix: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}) {
  for (const seat of listTenantSeats(params.store, params.tenantId)) {
    // Seats with empty teamLabel belong to the synthetic 未分组 bucket; feed that
    // label into remap so renaming 未分组 also moves those seats.
    const teamLabelForRemap = effectiveSeatTeamLabel(seat.teamLabel);
    const remapped = remapOrganizationTeamLabel({
      teamLabel: teamLabelForRemap,
      oldPrefix: params.oldPrefix,
      newPrefix: params.newPrefix,
    });
    if (!remapped || remapped === teamLabelForRemap) {
      continue;
    }
    configureSeatProfile({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      teamLabel: remapped,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
  }
}

function ensureOrganizationDepartmentsStore(store: EnterpriseSeatAssetsStore) {
  if (!store.organizationDepartments) {
    store.organizationDepartments = {};
  }
}

function upsertEmptyDepartment(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  fullPath: string;
  nowIso: string;
}) {
  ensureOrganizationDepartmentsStore(params.store);
  const existing = Object.values(params.store.organizationDepartments ?? {}).find(
    (entry) => entry.tenantId === params.tenantId && entry.fullPath === params.fullPath,
  );
  if (existing) {
    existing.updatedAt = params.nowIso;
    return existing;
  }
  const department: EnterpriseOrganizationDepartment = {
    departmentId: randomUUID(),
    tenantId: params.tenantId,
    fullPath: params.fullPath,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.organizationDepartments![department.departmentId] = department;
  return department;
}

function removeEmptyDepartmentRecords(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  fullPath: string;
}) {
  const departments = params.store.organizationDepartments ?? {};
  for (const [departmentId, department] of Object.entries(departments)) {
    if (department.tenantId === params.tenantId && department.fullPath === params.fullPath) {
      delete departments[departmentId];
    }
  }
}

export function applyOrganizationDepartmentMutation(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  mutation: OrganizationDepartmentMutation;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { fullPath: string; affectedSeatIds: string[]; createdPaths?: string[] } {
  const action = params.mutation.action;
  if (action === "create") {
    const parentPath = params.mutation.parentPath?.trim() || "";
    const label = params.mutation.label?.trim();
    if (!label) {
      throw new Error("部门名称不能为空。");
    }
    const parts = parentPath ? [...splitOrganizationPath(parentPath), label] : [label];
    const fullPath = resolveOrganizationFullPath(parts);
    const existingPaths = listTenantOrganizationDepartmentPaths(params.store, params.tenantId);
    if (existingPaths.includes(fullPath)) {
      throw new Error("部门已存在。");
    }
    upsertEmptyDepartment({
      store: params.store,
      tenantId: params.tenantId,
      fullPath,
      nowIso: params.nowIso,
    });
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.department_created",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { fullPath, parentPath: parentPath || null },
    });
    return { fullPath, affectedSeatIds: [] };
  }

  if (action === "rename") {
    // Product decision: allow promoting the synthetic 未分组 bucket to a formal name.
    const path = normalizeDepartmentPath(params.mutation.path, { allowUngrouped: true });
    const label = params.mutation.label?.trim();
    if (!label) {
      throw new Error("部门名称不能为空。");
    }
    const parts = splitOrganizationPath(path);
    const parentParts = parts.slice(0, -1);
    const newPrefix = resolveOrganizationFullPath([...parentParts, label]);
    remapTenantSeatTeamLabels({
      store: params.store,
      tenantId: params.tenantId,
      oldPrefix: path,
      newPrefix,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
    remapTenantOrganizationPaths({
      store: params.store,
      tenantId: params.tenantId,
      oldPrefix: path,
      newPrefix,
      nowIso: params.nowIso,
    });
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.department_renamed",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { fromPath: path, toPath: newPrefix },
    });
    return {
      fullPath: newPrefix,
      affectedSeatIds: listTenantSeats(params.store, params.tenantId)
        .filter((seat) => {
          const teamLabel = seat.teamLabel?.trim() || "未分组";
          return teamLabel === newPrefix || teamLabel.startsWith(`${newPrefix}/`);
        })
        .map((seat) => seat.seatId),
    };
  }

  if (action === "move") {
    const path = normalizeDepartmentPath(params.mutation.path);
    const parentPath = params.mutation.parentPath?.trim() ?? "";
    const label = splitOrganizationPath(path).at(-1) ?? path;
    const newPrefix = parentPath
      ? resolveOrganizationFullPath([...splitOrganizationPath(parentPath), label])
      : label;
    if (newPrefix === path) {
      return { fullPath: path, affectedSeatIds: [] };
    }
    if (parentPath && (parentPath === path || parentPath.startsWith(`${path}/`))) {
      throw new Error("不能将部门移动到自身或子部门下。");
    }
    remapTenantSeatTeamLabels({
      store: params.store,
      tenantId: params.tenantId,
      oldPrefix: path,
      newPrefix,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
    remapTenantOrganizationPaths({
      store: params.store,
      tenantId: params.tenantId,
      oldPrefix: path,
      newPrefix,
      nowIso: params.nowIso,
    });
    relocateOrganizationChildInOrders(params.store, params.tenantId, {
      fromParentPath: departmentParentPath(path),
      toParentPath: parentPath,
      fromChildKey: organizationChildDepartmentKey(path),
      toChildKey: organizationChildDepartmentKey(newPrefix),
    });
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.department_moved",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { fromPath: path, toPath: newPrefix, parentPath: parentPath || null },
    });
    return {
      fullPath: newPrefix,
      affectedSeatIds: listTenantSeats(params.store, params.tenantId)
        .filter((seat) => {
          const teamLabel = seat.teamLabel?.trim() || "未分组";
          return teamLabel === newPrefix || teamLabel.startsWith(`${newPrefix}/`);
        })
        .map((seat) => seat.seatId),
    };
  }

  if (action === "delete") {
    const path = normalizeDepartmentPath(params.mutation.path);
    if (tenantHasSeatsUnderPath(params.store, params.tenantId, path)) {
      throw new Error("部门下仍有岗位，无法删除。");
    }
    const childPaths = listTenantOrganizationDepartmentPaths(params.store, params.tenantId).filter(
      (entry) => entry !== path && entry.startsWith(`${path}/`),
    );
    if (childPaths.length > 0) {
      throw new Error("请先删除子部门。");
    }
    removeEmptyDepartmentRecords({
      store: params.store,
      tenantId: params.tenantId,
      fullPath: path,
    });
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.department_deleted",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { fullPath: path },
    });
    return { fullPath: path, affectedSeatIds: [] };
  }

  if (action === "move-seat") {
    const seatId = params.mutation.seatId?.trim();
    const targetPath = normalizeDepartmentPath(params.mutation.targetPath);
    if (!seatId) {
      throw new Error("岗位 ID 不能为空。");
    }
    const seat = params.store.seats[seatId];
    if (!seat || seat.tenantId !== params.tenantId) {
      throw new Error("岗位不存在。");
    }
    const previousParentPath = seat.teamLabel?.trim() || "未分组";
    configureSeatProfile({
      store: params.store,
      tenantId: params.tenantId,
      seatId,
      teamLabel: targetPath,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
    relocateOrganizationChildInOrders(params.store, params.tenantId, {
      fromParentPath: previousParentPath,
      toParentPath: targetPath,
      fromChildKey: organizationChildSeatKey(seatId),
    });
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.seat_moved",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      seatId,
      metadata: { targetPath },
    });
    return { fullPath: targetPath, affectedSeatIds: [seatId] };
  }

  if (action === "delete-seat") {
    const seatId = params.mutation.seatId?.trim();
    if (!seatId) {
      throw new Error("岗位 ID 不能为空。");
    }
    const seat = params.store.seats[seatId];
    const teamLabel = seat?.teamLabel?.trim() || "未分组";
    deleteVacantPositionSeat({
      store: params.store,
      tenantId: params.tenantId,
      seatId,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
    return { fullPath: teamLabel, affectedSeatIds: [seatId] };
  }

  if (action === "merge") {
    const sourcePath = normalizeDepartmentPath(params.mutation.path);
    const targetPath = normalizeDepartmentPath(params.mutation.targetPath);
    if (sourcePath === targetPath) {
      throw new Error("不能合并到相同部门。");
    }
    if (targetPath.startsWith(`${sourcePath}/`)) {
      throw new Error("不能将部门合并到其子部门。");
    }
    remapTenantSeatTeamLabels({
      store: params.store,
      tenantId: params.tenantId,
      oldPrefix: sourcePath,
      newPrefix: targetPath,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
    remapTenantOrganizationPaths({
      store: params.store,
      tenantId: params.tenantId,
      oldPrefix: sourcePath,
      newPrefix: targetPath,
      nowIso: params.nowIso,
    });
    removeEmptyDepartmentRecords({
      store: params.store,
      tenantId: params.tenantId,
      fullPath: sourcePath,
    });
    for (const childPath of listTenantOrganizationDepartmentPaths(params.store, params.tenantId)) {
      if (childPath.startsWith(`${sourcePath}/`)) {
        removeEmptyDepartmentRecords({
          store: params.store,
          tenantId: params.tenantId,
          fullPath: childPath,
        });
      }
    }
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.department_merged",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { sourcePath, targetPath },
    });
    return {
      fullPath: targetPath,
      affectedSeatIds: listTenantSeats(params.store, params.tenantId)
        .filter((seat) => {
          const teamLabel = seat.teamLabel?.trim() || "未分组";
          return teamLabel === targetPath || teamLabel.startsWith(`${targetPath}/`);
        })
        .map((seat) => seat.seatId),
    };
  }

  if (action === "sync-structure") {
    const paths = (params.mutation.paths ?? []).map((entry) => entry.trim()).filter(Boolean);
    const prefixPaths = collectOrganizationStructurePrefixPaths(paths);
    const existingPaths = new Set(
      listTenantOrganizationDepartmentPaths(params.store, params.tenantId),
    );
    const createdPaths: string[] = [];
    for (const fullPath of prefixPaths) {
      if (existingPaths.has(fullPath)) {
        continue;
      }
      upsertEmptyDepartment({
        store: params.store,
        tenantId: params.tenantId,
        fullPath,
        nowIso: params.nowIso,
      });
      createdPaths.push(fullPath);
      existingPaths.add(fullPath);
    }
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.structure_synced",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { createdCount: createdPaths.length, createdPaths },
    });
    return { fullPath: createdPaths[0] ?? "", affectedSeatIds: [], createdPaths };
  }

  if (action === "reorder-children") {
    const parentPath = params.mutation.parentPath?.trim() ?? "";
    const orderedKeys = (params.mutation.orderedKeys ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!orderedKeys.length) {
      throw new Error("排序列表不能为空。");
    }
    const expected = new Set(
      listDirectOrganizationChildKeys(params.store, params.tenantId, parentPath),
    );
    const provided = new Set(orderedKeys);
    if (expected.size !== provided.size || ![...expected].every((key) => provided.has(key))) {
      throw new Error("排序列表与当前子节点不一致。");
    }
    ensureOrganizationChildOrdersStore(params.store);
    params.store.organizationChildOrders![
      organizationChildOrderStorageKey(params.tenantId, parentPath)
    ] = orderedKeys;
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "organization.children_reordered",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      metadata: { parentPath: parentPath || null, orderedKeys },
    });
    return { fullPath: parentPath, affectedSeatIds: [] };
  }

  throw new Error("Unsupported organization department action.");
}
