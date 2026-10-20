import {
  COGNITIVE_ENVELOPE_KEYS,
  isCognitiveEnvelopeKey,
  parseCognitiveEnvelopeFields,
  readEnvelopeSchemaVersion,
} from "./envelope-cognitive.js";
import { CATALOG_FIELD_LIMITS } from "./limits.js";
import type {
  ActiveLifecycleOperation,
  ActorRef,
  DataClassification,
  DataGovernanceEnvelope,
  EnvelopeValidationError,
  GovernedResourceType,
  LegalHold,
  LifecycleState,
  LongRunningLifecycleCommand,
  OwnershipPrincipal,
  ResourceScope,
} from "./types.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

const RESOURCE_TYPES = new Set<GovernedResourceType>([
  "workspace",
  "agent",
  "conversation_archive",
  "knowledge",
  "memory",
  "operational_identity",
]);

const LIFECYCLES = new Set<LifecycleState>([
  "pending",
  "active",
  "read_only",
  "archived",
  "recovery_required",
  "quarantined",
  "retired",
  "deletion_pending",
  "purged",
]);

const LONG_RUNNING_COMMANDS = new Set<LongRunningLifecycleCommand>([
  "archive",
  "restore",
  "retire",
  "requestPurge",
  "forget",
]);

const CLASSIFICATIONS = new Set<DataClassification>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

const ENVELOPE_KEYS = new Set([
  "resourceId",
  "resourceType",
  "schemaVersion",
  "tenantId",
  "owner",
  "scope",
  "lifecycleState",
  "classification",
  "governanceVersion",
  "canonicalBindingId",
  "createdAt",
  "updatedAt",
  "projection",
  "legalHold",
  "activeLifecycleOperation",
]);

const ENVELOPE_KEYS_V2 = new Set([...ENVELOPE_KEYS, ...COGNITIVE_ENVELOPE_KEYS]);

/** Second-wave Catalog projection allowlists — IDs/refs only; never bodies/secrets. */
const KNOWLEDGE_PROJECTION_ALLOWLIST = new Set([
  "contentClass",
  "kbId",
  "docId",
  "versionId",
  "projectionId",
  "sourceBindingRef",
]);
const MEMORY_PROJECTION_ALLOWLIST = new Set([
  "canonicalKind",
  "atomId",
  "sourceId",
  "memoryTier",
  "sourceWorkspaceResourceId",
  // P3-e L2 scalars only (B27). Arrays stay off-envelope.
  "derivedRole",
  "mergeReceiptId",
]);
const OI_PROJECTION_ALLOWLIST = new Set([
  "identityId",
  "provider",
  "credentialHandleId",
  "credentialBindingId",
  "agentAssetId",
]);
/** P4-c Catalog refs only — checksum/tombstone/consent/policy/contentVersion. Never bodies. */
const FIRST_WAVE_PLACEMENT_PROJECTION_ALLOWLIST = new Set([
  "checksum",
  "consentVersion",
  "contentVersion",
  "policyVersion",
  "tombstoneVersion",
]);

const FORBIDDEN_PROJECTION_KEY =
  /^(body|claim|chunk|embedding|vector|token|password|secret|credentials?|accessToken|refreshToken|apiKey|privateKey|smtpPassword|clientSecret)$/i;

const FORBIDDEN_PROJECTION_VALUE = /^(sk-|Bearer\s|-----BEGIN\s)/i;

function projectionAllowlistFor(
  resourceType: GovernedResourceType | undefined,
): Set<string> | null {
  if (resourceType === "knowledge") {
    return KNOWLEDGE_PROJECTION_ALLOWLIST;
  }
  if (resourceType === "memory") {
    return MEMORY_PROJECTION_ALLOWLIST;
  }
  if (resourceType === "operational_identity") {
    return OI_PROJECTION_ALLOWLIST;
  }
  if (
    resourceType === "workspace" ||
    resourceType === "agent" ||
    resourceType === "conversation_archive"
  ) {
    return FIRST_WAVE_PLACEMENT_PROJECTION_ALLOWLIST;
  }
  return null;
}

function validateProjectionMap(params: {
  resourceType: GovernedResourceType | undefined;
  raw: Record<string, unknown>;
  errors: EnvelopeValidationError[];
}): Record<string, string | null> | undefined {
  const allowlist = projectionAllowlistFor(params.resourceType);
  const projection: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(params.raw)) {
    if (k.length > 64) {
      params.errors.push({
        code: "field_too_long",
        field: `projection.${k}`,
        message: "projection key too long",
      });
      continue;
    }
    if (
      FORBIDDEN_PROJECTION_KEY.test(k) ||
      /body|claim|chunk|embedding|token|password|secret/i.test(k)
    ) {
      // Allow credentialHandleId / credentialBindingId via allowlist path below.
      if (k !== "credentialHandleId" && k !== "credentialBindingId") {
        params.errors.push({
          code: "invalid_projection",
          field: `projection.${k}`,
          message: `projection key forbidden for Catalog: ${k}`,
        });
        continue;
      }
    }
    if (isCognitiveEnvelopeKey(k)) {
      params.errors.push({
        code: "invalid_projection",
        field: `projection.${k}`,
        message: "cognitive keys are not projection",
      });
      continue;
    }
    if (allowlist && !allowlist.has(k)) {
      params.errors.push({
        code: "invalid_projection",
        field: `projection.${k}`,
        message: `projection key not allowlisted for ${params.resourceType}`,
      });
      continue;
    }
    if (!allowlist && k.length > 0) {
      // First-wave envelopes should not carry second-wave content projections.
      params.errors.push({
        code: "invalid_projection",
        field: `projection.${k}`,
        message: "projection not allowed for first-wave resourceType",
      });
      continue;
    }
    if (v === null) {
      projection[k] = null;
    } else if (typeof v === "string" && v.length <= CATALOG_FIELD_LIMITS.principalIdMax) {
      if (FORBIDDEN_PROJECTION_VALUE.test(v)) {
        params.errors.push({
          code: "invalid_projection",
          field: `projection.${k}`,
          message: "projection value looks like a secret",
        });
        continue;
      }
      projection[k] = v;
    } else {
      params.errors.push({
        code: "invalid_projection",
        field: `projection.${k}`,
        message: "projection values must be string|null within limits",
      });
    }
  }
  return Object.keys(projection).length > 0 ? projection : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedString(
  value: unknown,
  field: string,
  max: number,
  errors: EnvelopeValidationError[],
): string | undefined {
  if (!isNonEmptyString(value)) {
    errors.push({ code: "missing_field", field, message: `${field} required` });
    return undefined;
  }
  if (value.length > max) {
    errors.push({ code: "field_too_long", field, message: `${field} exceeds ${max}` });
    return undefined;
  }
  return value.trim();
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function parseActorRef(
  input: unknown,
  field: string,
  errors: EnvelopeValidationError[],
): ActorRef | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push({ code: "invalid_actor_ref", field, message: "actor ref invalid" });
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set(["kind", "userId", "operatorId", "workerId", "systemId"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "unknown_field",
        field: `${field}.${key}`,
        message: "unknown actor field",
      });
      return undefined;
    }
  }
  switch (raw.kind) {
    case "user": {
      const userId = boundedString(
        raw.userId,
        `${field}.userId`,
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return userId ? { kind: "user", userId } : undefined;
    }
    case "operator": {
      const operatorId = boundedString(
        raw.operatorId,
        `${field}.operatorId`,
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return operatorId ? { kind: "operator", operatorId } : undefined;
    }
    case "worker": {
      const workerId = boundedString(
        raw.workerId,
        `${field}.workerId`,
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return workerId ? { kind: "worker", workerId } : undefined;
    }
    case "system": {
      const systemId = boundedString(
        raw.systemId,
        `${field}.systemId`,
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return systemId ? { kind: "system", systemId } : undefined;
    }
    default:
      errors.push({
        code: "invalid_actor_ref",
        field: `${field}.kind`,
        message: "actor.kind invalid",
      });
      return undefined;
  }
}

function parseLegalHold(
  input: unknown,
  errors: EnvelopeValidationError[],
): LegalHold | null | undefined {
  if (input === null) {
    return null;
  }
  if (input === undefined) {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push({ code: "invalid_legal_hold", field: "legalHold", message: "legalHold invalid" });
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set(["holdId", "reason", "appliedBy", "appliedAt", "releasedAt"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "unknown_field",
        field: `legalHold.${key}`,
        message: "unknown legalHold field",
      });
      return undefined;
    }
  }
  const holdId = boundedString(raw.holdId, "legalHold.holdId", 128, errors);
  const reason = boundedString(raw.reason, "legalHold.reason", 512, errors);
  const appliedBy = parseActorRef(raw.appliedBy, "legalHold.appliedBy", errors);
  const appliedAt = boundedString(raw.appliedAt, "legalHold.appliedAt", 64, errors);
  let releasedAt: string | undefined;
  if (raw.releasedAt !== undefined) {
    releasedAt = boundedString(raw.releasedAt, "legalHold.releasedAt", 64, errors);
    if (releasedAt && !isIsoTimestamp(releasedAt)) {
      errors.push({
        code: "invalid_timestamp",
        field: "legalHold.releasedAt",
        message: "releasedAt must be ISO-8601 Z",
      });
    }
  }
  if (appliedAt && !isIsoTimestamp(appliedAt)) {
    errors.push({
      code: "invalid_timestamp",
      field: "legalHold.appliedAt",
      message: "appliedAt must be ISO-8601 Z",
    });
  }
  if (!holdId || !reason || !appliedBy || !appliedAt) {
    return undefined;
  }
  return {
    holdId,
    reason,
    appliedBy,
    appliedAt,
    ...(releasedAt ? { releasedAt } : {}),
  };
}

function parseActiveLifecycleOperation(
  input: unknown,
  errors: EnvelopeValidationError[],
): ActiveLifecycleOperation | null | undefined {
  if (input === null) {
    return null;
  }
  if (input === undefined) {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push({
      code: "invalid_active_lifecycle_operation",
      field: "activeLifecycleOperation",
      message: "activeLifecycleOperation invalid",
    });
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set([
    "operationId",
    "command",
    "receiptId",
    "previousLifecycleState",
    "startedAt",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "unknown_field",
        field: `activeLifecycleOperation.${key}`,
        message: "unknown activeLifecycleOperation field",
      });
      return undefined;
    }
  }
  const operationId = boundedString(
    raw.operationId,
    "activeLifecycleOperation.operationId",
    128,
    errors,
  );
  const receiptId = boundedString(raw.receiptId, "activeLifecycleOperation.receiptId", 128, errors);
  const startedAt = boundedString(raw.startedAt, "activeLifecycleOperation.startedAt", 64, errors);
  if (
    typeof raw.command !== "string" ||
    !LONG_RUNNING_COMMANDS.has(raw.command as LongRunningLifecycleCommand)
  ) {
    errors.push({
      code: "invalid_active_lifecycle_operation",
      field: "activeLifecycleOperation.command",
      message: "command must be a long-running open command",
    });
  }
  if (
    typeof raw.previousLifecycleState !== "string" ||
    !LIFECYCLES.has(raw.previousLifecycleState as LifecycleState)
  ) {
    errors.push({
      code: "invalid_active_lifecycle_operation",
      field: "activeLifecycleOperation.previousLifecycleState",
      message: "previousLifecycleState invalid",
    });
  }
  if (startedAt && !isIsoTimestamp(startedAt)) {
    errors.push({
      code: "invalid_timestamp",
      field: "activeLifecycleOperation.startedAt",
      message: "startedAt must be ISO-8601 Z",
    });
  }
  if (
    !operationId ||
    !receiptId ||
    !startedAt ||
    typeof raw.command !== "string" ||
    !LONG_RUNNING_COMMANDS.has(raw.command as LongRunningLifecycleCommand) ||
    typeof raw.previousLifecycleState !== "string" ||
    !LIFECYCLES.has(raw.previousLifecycleState as LifecycleState)
  ) {
    return undefined;
  }
  return {
    operationId,
    command: raw.command as LongRunningLifecycleCommand,
    receiptId,
    previousLifecycleState: raw.previousLifecycleState as LifecycleState,
    startedAt,
  };
}

/** Active hold = holdId present and releasedAt absent. */
export function isLegalHoldActive(envelope: DataGovernanceEnvelope): boolean {
  const hold = envelope.legalHold;
  return Boolean(hold && hold.holdId && !hold.releasedAt);
}

function parseOwner(
  owner: unknown,
  errors: EnvelopeValidationError[],
): OwnershipPrincipal | undefined {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
    errors.push({ code: "invalid_owner", field: "owner", message: "owner principal invalid" });
    return undefined;
  }
  const raw = owner as Record<string, unknown>;
  const kind = raw.kind;
  const allowedOwnerKeys = new Set(["kind", "userId", "seatId", "groupId", "systemId"]);
  for (const key of Object.keys(raw)) {
    if (!allowedOwnerKeys.has(key)) {
      errors.push({ code: "unknown_field", field: `owner.${key}`, message: "unknown owner field" });
      return undefined;
    }
  }
  switch (kind) {
    case "user": {
      const userId = boundedString(
        raw.userId,
        "owner.userId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return userId ? { kind: "user", userId } : undefined;
    }
    case "position": {
      const seatId = boundedString(
        raw.seatId,
        "owner.seatId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return seatId ? { kind: "position", seatId } : undefined;
    }
    case "group": {
      const groupId = boundedString(
        raw.groupId,
        "owner.groupId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return groupId ? { kind: "group", groupId } : undefined;
    }
    case "system": {
      const systemId = boundedString(
        raw.systemId,
        "owner.systemId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return systemId ? { kind: "system", systemId } : undefined;
    }
    default:
      errors.push({ code: "invalid_owner", field: "owner.kind", message: "owner.kind invalid" });
      return undefined;
  }
}

function parseScope(scope: unknown, errors: EnvelopeValidationError[]): ResourceScope | undefined {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    errors.push({ code: "invalid_scope", field: "scope", message: "scope required" });
    return undefined;
  }
  const raw = scope as Record<string, unknown>;
  const allowedScopeKeys = new Set(["kind", "userId", "tenantId", "groupId"]);
  for (const key of Object.keys(raw)) {
    if (!allowedScopeKeys.has(key)) {
      errors.push({ code: "unknown_field", field: `scope.${key}`, message: "unknown scope field" });
      return undefined;
    }
  }
  switch (raw.kind) {
    case "user": {
      const userId = boundedString(
        raw.userId,
        "scope.userId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return userId ? { kind: "user", userId } : undefined;
    }
    case "tenant": {
      const tenantId = boundedString(
        raw.tenantId,
        "scope.tenantId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return tenantId ? { kind: "tenant", tenantId } : undefined;
    }
    case "group": {
      const groupId = boundedString(
        raw.groupId,
        "scope.groupId",
        CATALOG_FIELD_LIMITS.principalIdMax,
        errors,
      );
      return groupId ? { kind: "group", groupId } : undefined;
    }
    case "system":
      return { kind: "system" };
    default:
      errors.push({ code: "invalid_scope", field: "scope.kind", message: "scope.kind invalid" });
      return undefined;
  }
}

function checkOwnerScopeTenantConsistency(params: {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  errors: EnvelopeValidationError[];
}): void {
  const { errors } = params;
  if (params.scope.kind === "tenant") {
    if (params.tenantId === null) {
      errors.push({
        code: "inconsistent_tenant",
        field: "tenantId",
        message: "tenant scope requires non-null envelope.tenantId",
      });
    } else if (params.scope.tenantId !== params.tenantId) {
      errors.push({
        code: "inconsistent_tenant",
        field: "scope.tenantId",
        message: "scope.tenantId must equal envelope.tenantId",
      });
    }
  }

  if (params.owner.kind === "user" && params.scope.kind === "user") {
    if (params.owner.userId !== params.scope.userId) {
      errors.push({
        code: "inconsistent_owner_scope",
        field: "scope.userId",
        message: "user owner and user scope must share userId",
      });
    }
  }
  if (params.owner.kind === "group" && params.scope.kind === "group") {
    if (params.owner.groupId !== params.scope.groupId) {
      errors.push({
        code: "inconsistent_owner_scope",
        field: "scope.groupId",
        message: "group owner and group scope must share groupId",
      });
    }
  }
  if (params.owner.kind === "position" && params.scope.kind === "user") {
    errors.push({
      code: "inconsistent_owner_scope",
      field: "scope",
      message: "position owner cannot use user scope",
    });
  }
}

/**
 * Fail-closed validation of the governance envelope.
 * Dual-reader (default) accepts envelope schemaVersion 1 and 2.
 * v1-only reader returns schema_unsupported for v2 rows without failing sibling parsing.
 */
export function validateGovernanceEnvelope(
  input: unknown,
  options?: { reader?: "dual" | "v1-only" },
):
  | { ok: true; envelope: DataGovernanceEnvelope }
  | { ok: false; errors: EnvelopeValidationError[] } {
  const errors: EnvelopeValidationError[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ code: "missing_field", message: "envelope must be an object" }],
    };
  }
  const raw = input as Record<string, unknown>;
  const reader = options?.reader ?? "dual";
  const schemaVersion = readEnvelopeSchemaVersion(raw);
  if (schemaVersion === 2 && reader === "v1-only") {
    return {
      ok: false,
      errors: [
        {
          code: "schema_unsupported",
          field: "schemaVersion",
          message: "v1-only reader cannot parse envelope schemaVersion 2",
        },
      ],
    };
  }
  const allowedKeys = schemaVersion === 2 ? ENVELOPE_KEYS_V2 : ENVELOPE_KEYS;
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      errors.push({ code: "unknown_field", field: key, message: `unknown envelope field: ${key}` });
    }
  }

  const resourceId = boundedString(
    raw.resourceId,
    "resourceId",
    CATALOG_FIELD_LIMITS.resourceIdMax,
    errors,
  );
  if (!raw.resourceType || !RESOURCE_TYPES.has(raw.resourceType as GovernedResourceType)) {
    errors.push({
      code: "invalid_resource_type",
      field: "resourceType",
      message:
        "resourceType must be workspace|agent|conversation_archive|knowledge|memory|operational_identity",
    });
  }
  if (schemaVersion === null) {
    errors.push({
      code: "invalid_schema_version",
      field: "schemaVersion",
      message: "schemaVersion must be 1 or 2",
    });
  }

  let tenantId: string | null | undefined;
  if (raw.tenantId === null) {
    tenantId = null;
  } else if (raw.tenantId === undefined) {
    errors.push({
      code: "missing_field",
      field: "tenantId",
      message: "tenantId must be string|null",
    });
  } else {
    tenantId = boundedString(raw.tenantId, "tenantId", CATALOG_FIELD_LIMITS.principalIdMax, errors);
  }

  const owner = parseOwner(raw.owner, errors);
  const scope = parseScope(raw.scope, errors);

  if (!raw.lifecycleState || !LIFECYCLES.has(raw.lifecycleState as LifecycleState)) {
    errors.push({
      code: "invalid_lifecycle",
      field: "lifecycleState",
      message: "lifecycleState invalid",
    });
  }
  if (!raw.classification || !CLASSIFICATIONS.has(raw.classification as DataClassification)) {
    errors.push({
      code: "invalid_classification",
      field: "classification",
      message: "classification invalid",
    });
  }
  if (
    typeof raw.governanceVersion !== "number" ||
    !Number.isInteger(raw.governanceVersion) ||
    raw.governanceVersion < 1
  ) {
    errors.push({
      code: "invalid_governance_version",
      field: "governanceVersion",
      message: "governanceVersion must be an integer >= 1",
    });
  }
  const canonicalBindingId = boundedString(
    raw.canonicalBindingId,
    "canonicalBindingId",
    CATALOG_FIELD_LIMITS.bindingIdMax,
    errors,
  );
  const createdAt = boundedString(raw.createdAt, "createdAt", 64, errors);
  const updatedAt = boundedString(raw.updatedAt, "updatedAt", 64, errors);
  if (createdAt && !isIsoTimestamp(createdAt)) {
    errors.push({
      code: "invalid_timestamp",
      field: "createdAt",
      message: "createdAt must be ISO-8601 Z",
    });
  }
  if (updatedAt && !isIsoTimestamp(updatedAt)) {
    errors.push({
      code: "invalid_timestamp",
      field: "updatedAt",
      message: "updatedAt must be ISO-8601 Z",
    });
  }
  if (createdAt && updatedAt && isIsoTimestamp(createdAt) && isIsoTimestamp(updatedAt)) {
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      errors.push({
        code: "invalid_timestamp",
        field: "updatedAt",
        message: "updatedAt must be >= createdAt",
      });
    }
  }

  if (owner && scope && tenantId !== undefined) {
    checkOwnerScopeTenantConsistency({ tenantId, owner, scope, errors });
  }

  let projection: Record<string, string | null> | undefined;
  if (raw.projection !== undefined) {
    if (!raw.projection || typeof raw.projection !== "object" || Array.isArray(raw.projection)) {
      errors.push({
        code: "invalid_projection",
        field: "projection",
        message: "projection must be a string-map object",
      });
    } else {
      const projRaw = raw.projection as Record<string, unknown>;
      if (
        "legalHold" in projRaw ||
        "activeLifecycleOperation" in projRaw ||
        "deletionAuthority" in projRaw
      ) {
        errors.push({
          code: "invalid_projection",
          field: "projection",
          message: "projection must not carry hold/active op/deletion authority",
        });
      }
      projection = validateProjectionMap({
        resourceType: raw.resourceType as GovernedResourceType | undefined,
        raw: projRaw,
        errors,
      });
    }
  }

  let legalHold: LegalHold | null | undefined;
  if (raw.legalHold !== undefined) {
    legalHold = parseLegalHold(raw.legalHold, errors);
  }
  let activeLifecycleOperation: ActiveLifecycleOperation | null | undefined;
  if (raw.activeLifecycleOperation !== undefined) {
    activeLifecycleOperation = parseActiveLifecycleOperation(raw.activeLifecycleOperation, errors);
  }

  const cognitiveFields = schemaVersion === 2 ? parseCognitiveEnvelopeFields(raw, errors) : {};

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    envelope: {
      resourceId: resourceId!,
      resourceType: raw.resourceType as GovernedResourceType,
      schemaVersion: schemaVersion ?? GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: tenantId!,
      owner: owner!,
      scope: scope!,
      lifecycleState: raw.lifecycleState as LifecycleState,
      classification: raw.classification as DataClassification,
      governanceVersion: raw.governanceVersion as number,
      canonicalBindingId: canonicalBindingId!,
      createdAt: createdAt!,
      updatedAt: updatedAt!,
      ...(projection ? { projection } : {}),
      ...(legalHold !== undefined ? { legalHold } : {}),
      ...(activeLifecycleOperation !== undefined ? { activeLifecycleOperation } : {}),
      ...cognitiveFields,
    },
  };
}

/**
 * Managed content-write gate: only lifecycleState === "active" is writable,
 * and no in-flight activeLifecycleOperation may be present.
 */
export function assertWritableEnvelope(input: unknown): DataGovernanceEnvelope {
  const result = validateGovernanceEnvelope(input);
  if (!result.ok) {
    const detail = result.errors.map((e) => e.code).join(",");
    throw new Error(`governance_envelope_invalid:${detail}`);
  }
  if (result.envelope.activeLifecycleOperation) {
    throw new Error("governance_envelope_not_writable:active_lifecycle_operation");
  }
  if (result.envelope.lifecycleState !== "active") {
    throw new Error(`governance_envelope_not_writable:${result.envelope.lifecycleState}`);
  }
  return result.envelope;
}

/**
 * Catalog-internal mutation gate for state-machine puts (pending→active, …, →purged).
 * Allows writing terminal destinations (`purged` / `retired`).
 * Store layer must still refuse mutations when the *existing* row is already terminal.
 */
export function assertCatalogMutableEnvelope(input: unknown): DataGovernanceEnvelope {
  const result = validateGovernanceEnvelope(input);
  if (!result.ok) {
    const detail = result.errors.map((e) => e.code).join(",");
    throw new Error(`governance_envelope_invalid:${detail}`);
  }
  return result.envelope;
}

/** True when Catalog row is a terminal lifecycle (no further metadata puts). */
export function isCatalogTerminalLifecycle(state: LifecycleState): boolean {
  return state === "retired" || state === "purged";
}
