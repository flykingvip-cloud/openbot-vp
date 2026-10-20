import { splitOrganizationPath } from "./enterprise-org-path.js";

export const ORGANIZATION_CHILD_DEPARTMENT_PREFIX = "department:";
export const ORGANIZATION_CHILD_SEAT_PREFIX = "seat:";

export function organizationChildDepartmentKey(fullPath: string): string {
  return `${ORGANIZATION_CHILD_DEPARTMENT_PREFIX}${fullPath}`;
}

export function organizationChildSeatKey(seatId: string): string {
  return `${ORGANIZATION_CHILD_SEAT_PREFIX}${seatId}`;
}

export function organizationChildOrderParentKey(parentPath: string): string {
  return parentPath.trim() || "__root__";
}

export function organizationChildOrderStorageKey(tenantId: string, parentPath: string): string {
  return `${tenantId}::${organizationChildOrderParentKey(parentPath)}`;
}

export function departmentParentPath(fullPath: string): string {
  return splitOrganizationPath(fullPath).slice(0, -1).join("/");
}

export function mergeOrganizationChildOrderKeys(
  saved: string[] | undefined,
  defaultKeys: string[],
): string[] {
  if (!saved?.length) {
    return [...defaultKeys];
  }
  const remaining = new Set(defaultKeys);
  const merged: string[] = [];
  for (const key of saved) {
    if (remaining.has(key)) {
      merged.push(key);
      remaining.delete(key);
    }
  }
  for (const key of defaultKeys) {
    if (remaining.has(key)) {
      merged.push(key);
    }
  }
  return merged;
}

export function ensureOrganizationChildOrdersStore(store: {
  organizationChildOrders?: Record<string, string[]>;
}) {
  if (!store.organizationChildOrders) {
    store.organizationChildOrders = {};
  }
}

export function listTenantOrganizationChildOrders(
  store: { organizationChildOrders?: Record<string, string[]> },
  tenantId: string,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [storageKey, orderedKeys] of Object.entries(store.organizationChildOrders ?? {})) {
    const prefix = `${tenantId}::`;
    if (!storageKey.startsWith(prefix)) {
      continue;
    }
    const parentKey = storageKey.slice(prefix.length);
    const parentPath = parentKey === "__root__" ? "" : parentKey;
    result[parentPath] = [...orderedKeys];
  }
  return result;
}

export function removeOrganizationChildFromOrder(
  store: { organizationChildOrders?: Record<string, string[]> },
  tenantId: string,
  parentPath: string,
  childKey: string,
): void {
  ensureOrganizationChildOrdersStore(store);
  const storageKey = organizationChildOrderStorageKey(tenantId, parentPath);
  const current = store.organizationChildOrders![storageKey];
  if (!current?.length) {
    return;
  }
  const next = current.filter((key) => key !== childKey);
  if (!next.length) {
    delete store.organizationChildOrders![storageKey];
    return;
  }
  store.organizationChildOrders![storageKey] = next;
}

export function appendOrganizationChildToOrder(
  store: { organizationChildOrders?: Record<string, string[]> },
  tenantId: string,
  parentPath: string,
  childKey: string,
): void {
  ensureOrganizationChildOrdersStore(store);
  const storageKey = organizationChildOrderStorageKey(tenantId, parentPath);
  const current = store.organizationChildOrders![storageKey] ?? [];
  if (current.includes(childKey)) {
    return;
  }
  store.organizationChildOrders![storageKey] = [...current, childKey];
}

export function relocateOrganizationChildInOrders(
  store: { organizationChildOrders?: Record<string, string[]> },
  tenantId: string,
  params: {
    fromParentPath: string;
    toParentPath: string;
    fromChildKey: string;
    toChildKey?: string;
  },
): void {
  removeOrganizationChildFromOrder(store, tenantId, params.fromParentPath, params.fromChildKey);
  appendOrganizationChildToOrder(
    store,
    tenantId,
    params.toParentPath,
    params.toChildKey ?? params.fromChildKey,
  );
}
