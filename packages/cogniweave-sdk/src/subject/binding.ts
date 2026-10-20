import { createHash, randomUUID } from "node:crypto";
import type {
  AuthorizeMemoryAccessInput,
  AuthorizeMemoryAccessResult,
  MemoryPartitionKeyV1,
  MemorySubject,
  MemorySubjectBinding,
  MemorySubjectOwnerType,
  MemorySubjectScopeType,
  Scope,
} from "../models.js";

/**
 * CW2-P3-01 MemorySubject binding — authorization plane helpers.
 * Op-key / partition identity stay untouched.
 */

/** Sentinel when OpenBot has no authenticated enterprise tenant. */
export const LOCAL_TENANT_SENTINEL = "__local__" as const;

const OWNER_TYPES: ReadonlySet<MemorySubjectOwnerType> = new Set([
  "user",
  "agent",
  "seat",
  "space",
  "team",
  "organization",
]);

export function isMemorySubjectOwnerType(value: string): value is MemorySubjectOwnerType {
  return OWNER_TYPES.has(value as MemorySubjectOwnerType);
}

/** Stable string for partition indexing (not an op-key). */
export function serializePartitionKey(partition: MemoryPartitionKeyV1): string {
  return `v${partition.partitionKeyVersion}|${partition.dataPlaneId}|${partition.scopeFingerprint}`;
}

export function resolveLocalMemorySubject(
  ownerId: string,
  ownerType: MemorySubjectOwnerType = "agent",
): MemorySubject {
  const trimmed = ownerId.trim();
  if (!trimmed) {
    throw new Error("resolveLocalMemorySubject: ownerId is required");
  }
  return {
    tenantId: LOCAL_TENANT_SENTINEL,
    ownerType,
    ownerId: trimmed,
  };
}

/**
 * Normalize caller tenant: null/undefined/blank → local sentinel.
 * Never invents a fake enterprise tenant id.
 */
export function resolveMemorySubjectTenantId(tenantId: string | null | undefined): string {
  const trimmed = typeof tenantId === "string" ? tenantId.trim() : "";
  return trimmed.length > 0 ? trimmed : LOCAL_TENANT_SENTINEL;
}

export function normalizeMemorySubject(input: {
  tenantId?: string | null;
  ownerType: MemorySubjectOwnerType;
  ownerId: string;
}): MemorySubject {
  const ownerId = input.ownerId.trim();
  if (!ownerId) {
    throw new Error("normalizeMemorySubject: ownerId is required");
  }
  if (!isMemorySubjectOwnerType(input.ownerType)) {
    throw new Error(`normalizeMemorySubject: invalid ownerType ${String(input.ownerType)}`);
  }
  return {
    tenantId: resolveMemorySubjectTenantId(input.tenantId),
    ownerType: input.ownerType,
    ownerId,
  };
}

export function createMemorySubjectBindingId(
  partition: MemoryPartitionKeyV1,
  subject: MemorySubject,
): string {
  const digest = createHash("sha256")
    .update(
      [serializePartitionKey(partition), subject.tenantId, subject.ownerType, subject.ownerId].join(
        "\0",
      ),
    )
    .digest("hex")
    .slice(0, 24);
  return `msb_${digest}`;
}

export function createMemorySubjectBinding(input: {
  partition: MemoryPartitionKeyV1;
  scope: Scope;
  subject: MemorySubject;
  scopeType?: MemorySubjectScopeType;
  now?: string;
  id?: string;
}): MemorySubjectBinding {
  const subject = normalizeMemorySubject(input.subject);
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? createMemorySubjectBindingId(input.partition, subject),
    partition: {
      partitionKeyVersion: 1,
      dataPlaneId: input.partition.dataPlaneId,
      scopeFingerprint: input.partition.scopeFingerprint,
    },
    scope: { ...input.scope },
    subject,
    scopeType: input.scopeType,
    createdAt: now,
    updatedAt: now,
  };
}

export function markMemorySubjectBindingUnbound(
  binding: MemorySubjectBinding,
  now = new Date().toISOString(),
): MemorySubjectBinding {
  return {
    ...binding,
    unboundAt: now,
    updatedAt: now,
  };
}

export function isLiveMemorySubjectBinding(binding: MemorySubjectBinding): boolean {
  return !binding.unboundAt;
}

function samePartition(a: MemoryPartitionKeyV1, b: MemoryPartitionKeyV1): boolean {
  return (
    a.partitionKeyVersion === b.partitionKeyVersion &&
    a.dataPlaneId === b.dataPlaneId &&
    a.scopeFingerprint === b.scopeFingerprint
  );
}

function sameSubject(a: MemorySubject, b: MemorySubject): boolean {
  return a.tenantId === b.tenantId && a.ownerType === b.ownerType && a.ownerId === b.ownerId;
}

/**
 * Authorize against live bindings for a partition.
 * Order: tenant → owner match (plan §8.3 prefix). Fail closed.
 */
export function authorizeMemoryAccess(
  bindings: ReadonlyArray<MemorySubjectBinding>,
  input: AuthorizeMemoryAccessInput,
): AuthorizeMemoryAccessResult {
  const caller = normalizeMemorySubject(input.caller);
  const live = bindings.filter(
    (binding) =>
      isLiveMemorySubjectBinding(binding) && samePartition(binding.partition, input.partition),
  );
  if (live.length === 0) {
    return { allowed: false, reason: "UNBOUND" };
  }

  // Local sentinel partitions refuse enterprise tenants (no escalation).
  const hasLocalBinding = live.some(
    (binding) => binding.subject.tenantId === LOCAL_TENANT_SENTINEL,
  );
  if (hasLocalBinding && caller.tenantId !== LOCAL_TENANT_SENTINEL) {
    return { allowed: false, reason: "LOCAL_SENTINEL_VIOLATION" };
  }

  const tenantMatches = live.filter((binding) => binding.subject.tenantId === caller.tenantId);
  if (tenantMatches.length === 0) {
    return { allowed: false, reason: "TENANT_MISMATCH" };
  }

  const ownerMatch = tenantMatches.find((binding) => sameSubject(binding.subject, caller));
  if (!ownerMatch) {
    return { allowed: false, reason: "OWNER_MISMATCH" };
  }

  return { allowed: true, bindingId: ownerMatch.id };
}

/** Test helper — unique id when not using deterministic digest. */
export function newMemorySubjectBindingNonce(): string {
  return randomUUID();
}
