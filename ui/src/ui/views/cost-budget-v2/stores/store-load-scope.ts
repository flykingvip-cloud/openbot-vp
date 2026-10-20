/**
 * Shared scope helpers for cost-budget-v2 module stores.
 * Client alone is not enough: the same Gateway WebSocket can switch enterprises.
 */

export type EnterpriseLoadScope = {
  clientKey: object;
  tenantId: string;
};

export function normalizeTenantId(tenantId: string | null | undefined): string {
  return typeof tenantId === "string" ? tenantId.trim() : "";
}

export function scopesEqual(
  a: { client: object | null; tenantId: string | null | undefined } | null | undefined,
  client: object | null,
  tenantId: string | null | undefined,
): boolean {
  if (!a || !client) {
    return false;
  }
  return a.client === client && normalizeTenantId(a.tenantId) === normalizeTenantId(tenantId);
}
