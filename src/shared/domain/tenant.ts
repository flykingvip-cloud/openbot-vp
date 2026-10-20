export type TenantPlan = "free" | "pro" | "enterprise";

export type TenantStatus = "active" | "inactive" | "suspended";

export type Tenant = {
  tenantId: string;
  name: string;
  primaryDomain?: string;
  orgId?: string;
  plan?: TenantPlan;
  status: TenantStatus;
  createdAt: number;
};
