import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type {
  EnterpriseDataStore,
  ScopeEvaluationContext,
  ScopeEvaluationResult,
  ScopeFilterClause,
  ScopePolicy,
  ScopeType,
} from "./types.js";

const ALLOWED_SCOPE_FIELDS = new Set([
  "customer.owner_id",
  "customer.owner_team",
  "customer.department_id",
  "order.created_by",
  "order.team_id",
  "article.visibility_scope",
]);

const ALLOWED_VALUE_REFS = new Set([
  "current_user.id",
  "current_user.team",
  "current_user.department",
  "current_seat.id",
]);

export function listScopePolicies(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): ScopePolicy[] {
  return Object.values(params.store.scopePolicies)
    .filter((policy) => policy.tenantId === params.tenantId && !policy.archivedAt)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

export function findScopePolicy(
  store: EnterpriseDataStore,
  tenantId: string,
  scopePolicyId: string,
): ScopePolicy | null {
  const policy = store.scopePolicies[scopePolicyId];
  if (!policy || policy.tenantId !== tenantId || policy.archivedAt) {
    return null;
  }
  return policy;
}

export function upsertScopePolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  policy: Omit<
    ScopePolicy,
    "scopePolicyId" | "tenantId" | "createdAt" | "updatedAt" | "archivedAt"
  > & {
    scopePolicyId?: string;
  };
}): ScopePolicy {
  for (const clause of params.policy.filterClauses ?? []) {
    validateScopeFilterClause(clause);
  }
  const existing =
    params.policy.scopePolicyId != null
      ? findScopePolicy(params.store, params.tenantId, params.policy.scopePolicyId)
      : null;
  const record: ScopePolicy = {
    scopePolicyId: params.policy.scopePolicyId ?? existing?.scopePolicyId ?? randomUUID(),
    tenantId: params.tenantId,
    displayName: params.policy.displayName,
    scopeType: params.policy.scopeType,
    filterClauses: params.policy.filterClauses,
    filterDescription: params.policy.filterDescription,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    createdBy: params.policy.createdBy ?? existing?.createdBy,
  };
  params.store.scopePolicies[record.scopePolicyId] = record;
  return record;
}

export function archiveScopePolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  scopePolicyId: string;
  nowIso: string;
}): ScopePolicy {
  const policy = findScopePolicy(params.store, params.tenantId, params.scopePolicyId);
  if (!policy) {
    throw new EnterpriseDataStoreError("SCOPE_POLICY_NOT_FOUND", "Scope policy not found.");
  }
  const inUse = Object.values(params.store.seatActionGrants).some(
    (grant) =>
      grant.tenantId === params.tenantId &&
      !grant.revokedAt &&
      grant.scopePolicyId === params.scopePolicyId,
  );
  if (inUse) {
    throw new EnterpriseDataStoreError(
      "SCOPE_IN_USE",
      "Scope policy is referenced by active grants.",
    );
  }
  policy.archivedAt = params.nowIso;
  policy.updatedAt = params.nowIso;
  return policy;
}

function validateScopeFilterClause(clause: ScopeFilterClause): void {
  if (!ALLOWED_SCOPE_FIELDS.has(clause.field)) {
    throw new EnterpriseDataStoreError(
      "SCOPE_FIELD_NOT_ALLOWED",
      `Scope filter field ${clause.field} is not allowed.`,
    );
  }
  if (!ALLOWED_VALUE_REFS.has(clause.valueRef)) {
    throw new EnterpriseDataStoreError(
      "SCOPE_CONTEXT_MISSING",
      `Scope valueRef ${clause.valueRef} is not allowed.`,
    );
  }
}

function resolveValueRef(
  valueRef: string,
  context: ScopeEvaluationContext,
): string | string[] | null {
  switch (valueRef) {
    case "current_user.id":
      return context.employeeId;
    case "current_user.team":
      return context.teamLabel ?? null;
    case "current_user.department":
      return context.departmentId ?? context.teamLabel ?? null;
    case "current_seat.id":
      return context.seatId;
    default:
      return null;
  }
}

function assertScopeContext(scopeType: ScopeType, context: ScopeEvaluationContext): void {
  if (scopeType === "SELF" && !context.employeeId) {
    throw new EnterpriseDataStoreError(
      "SCOPE_CONTEXT_MISSING",
      "employeeId is required for SELF scope.",
    );
  }
  if (scopeType === "TEAM" && !context.teamLabel?.trim()) {
    throw new EnterpriseDataStoreError(
      "SCOPE_CONTEXT_MISSING",
      "teamLabel is required for TEAM scope and must not be empty.",
    );
  }
  if (scopeType === "DEPARTMENT" && !context.departmentId && !context.teamLabel) {
    throw new EnterpriseDataStoreError(
      "SCOPE_CONTEXT_MISSING",
      "departmentId or teamLabel is required for DEPARTMENT scope.",
    );
  }
}

function buildScopeAppliedLabel(scopeType: ScopeType, context: ScopeEvaluationContext): string {
  switch (scopeType) {
    case "SELF":
      return "本人数据";
    case "TEAM":
      return `团队数据（${context.teamLabel ?? "未知团队"}）`;
    case "DEPARTMENT":
      return `部门数据（${context.departmentId ?? context.teamLabel ?? "未知部门"}）`;
    case "ALL":
      return "全量只读";
    default:
      return scopeType;
  }
}

export function evaluateScopePolicy(params: {
  policy: ScopePolicy;
  context: ScopeEvaluationContext;
}): ScopeEvaluationResult {
  assertScopeContext(params.policy.scopeType, params.context);
  const appliedFilters = params.policy.filterClauses ?? [];
  const resolvedValues: Record<string, string | string[]> = {};
  for (const clause of appliedFilters) {
    validateScopeFilterClause(clause);
    const resolved = resolveValueRef(clause.valueRef, params.context);
    if (resolved == null || (typeof resolved === "string" && !resolved.trim())) {
      throw new EnterpriseDataStoreError(
        "SCOPE_CONTEXT_MISSING",
        `Unable to resolve valueRef ${clause.valueRef} for scope ${params.policy.scopeType}.`,
      );
    }
    resolvedValues[clause.field] = resolved;
  }
  return {
    scopeType: params.policy.scopeType,
    appliedFilters,
    resolvedValues,
    scopeAppliedLabel: buildScopeAppliedLabel(params.policy.scopeType, params.context),
  };
}
