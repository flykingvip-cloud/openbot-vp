import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import { parseCognitiveProvenanceRef } from "./envelope-cognitive.js";
import { resolveCognitiveProvenanceRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  ActorRef,
  CognitiveProvenanceBinding,
  CognitiveProvenanceRef,
  EnvelopeValidationError,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 50;
const BINDING_KEYS = new Set([
  "bindingId",
  "resourceId",
  "tenantId",
  "ref",
  "previousBindingId",
  "createdAt",
  "actor",
]);

function tenantPartition(tenantId: string | null): string {
  const raw = tenantId && tenantId.trim() ? tenantId.trim() : "local";
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return /^[A-Za-z0-9]/.test(safe) ? safe : `t${safe}`;
}

function resourceRoot(params: {
  resourceId: string;
  tenantId: string | null;
  stateDir?: string;
}): string {
  const resourceId = assertSafeRecoveryReceiptToken(params.resourceId, "operationId");
  const partition = assertSafeRecoveryReceiptToken(
    tenantPartition(params.tenantId).replace(/[^A-Za-z0-9._-]/g, "_"),
    "operationId",
  );
  const root = path.resolve(
    resolveCognitiveProvenanceRoot(params.stateDir ?? resolveStateDir()),
    partition,
    resourceId,
  );
  return root;
}

export function resolveCognitiveProvenanceBindingPath(params: {
  resourceId: string;
  tenantId: string | null;
  bindingId: string;
  stateDir?: string;
}): string {
  const bindingId = assertSafeRecoveryReceiptToken(params.bindingId, "operationId");
  const root = resourceRoot(params);
  const dest = path.resolve(root, `${bindingId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_cognitive_provenance_path");
  }
  return dest;
}

export function provenanceRefsEqual(
  left: CognitiveProvenanceRef,
  right: CognitiveProvenanceRef,
): boolean {
  return (
    left.schemaPackage === right.schemaPackage &&
    left.nodeType === right.nodeType &&
    left.objectId === right.objectId &&
    left.version === right.version &&
    left.provenanceHash === right.provenanceHash
  );
}

export function provenanceBindingIdFor(params: {
  resourceId: string;
  ref: CognitiveProvenanceRef;
}): string {
  const digest = createHash("sha256")
    .update(
      `${params.resourceId}\0${params.ref.nodeType}\0${params.ref.objectId}\0${params.ref.version}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `pb-${digest}`;
}

export function hashCognitiveGenerationProvenance(value: unknown): string {
  return createHash("sha256").update(canonicalizeCognitiveJson(value)).digest("hex");
}

function parseActor(raw: unknown): ActorRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (row.kind === "user" && typeof row.userId === "string" && row.userId.trim()) {
    return { kind: "user", userId: row.userId };
  }
  if (row.kind === "operator" && typeof row.operatorId === "string" && row.operatorId.trim()) {
    return { kind: "operator", operatorId: row.operatorId };
  }
  if (row.kind === "worker" && typeof row.workerId === "string" && row.workerId.trim()) {
    return { kind: "worker", workerId: row.workerId };
  }
  if (row.kind === "system" && typeof row.systemId === "string" && row.systemId.trim()) {
    return { kind: "system", systemId: row.systemId };
  }
  return null;
}

export function parseCognitiveProvenanceBinding(
  raw: unknown,
  expected: { resourceId: string; tenantId: string | null; bindingId?: string },
): CognitiveProvenanceBinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!BINDING_KEYS.has(key)) {
      return null;
    }
  }
  if (typeof row.bindingId !== "string" || !row.bindingId.trim()) {
    return null;
  }
  if (expected.bindingId && row.bindingId !== expected.bindingId) {
    return null;
  }
  if (row.resourceId !== expected.resourceId) {
    return null;
  }
  if ((row.tenantId ?? null) !== expected.tenantId) {
    return null;
  }
  if (row.previousBindingId !== null && typeof row.previousBindingId !== "string") {
    return null;
  }
  if (typeof row.previousBindingId === "string" && row.previousBindingId.trim().length === 0) {
    return null;
  }
  if (typeof row.createdAt !== "string" || row.createdAt.trim().length === 0) {
    return null;
  }
  const actor = parseActor(row.actor);
  const errors: EnvelopeValidationError[] = [];
  const ref = parseCognitiveProvenanceRef(row.ref, errors);
  if (!actor || !ref || errors.length > 0) {
    return null;
  }
  if (row.bindingId !== provenanceBindingIdFor({ resourceId: expected.resourceId, ref })) {
    return null;
  }
  return {
    bindingId: row.bindingId,
    resourceId: expected.resourceId,
    tenantId: expected.tenantId,
    ref,
    previousBindingId: row.previousBindingId,
    createdAt: row.createdAt,
    actor,
  };
}

export function getCognitiveProvenanceBinding(params: {
  resourceId: string;
  tenantId: string | null;
  bindingId: string;
  stateDir?: string;
}): CognitiveProvenanceBinding | null {
  const dest = resolveCognitiveProvenanceBindingPath(params);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseCognitiveProvenanceBinding(JSON.parse(fs.readFileSync(dest, "utf8")), {
      resourceId: params.resourceId,
      tenantId: params.tenantId,
      bindingId: params.bindingId,
    });
  } catch {
    return null;
  }
}

export function listCognitiveProvenanceHistory(params: {
  resourceId: string;
  tenantId: string | null;
  headBindingId: string;
  cursor?: string;
  limit?: number;
  stateDir?: string;
}): { bindings: CognitiveProvenanceBinding[]; nextCursor: string | null } {
  const limit =
    typeof params.limit === "number" && Number.isInteger(params.limit) && params.limit > 0
      ? Math.min(params.limit, DEFAULT_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const bindings: CognitiveProvenanceBinding[] = [];
  let cursor = params.cursor ?? params.headBindingId;
  while (cursor && bindings.length < limit) {
    const row = getCognitiveProvenanceBinding({
      resourceId: params.resourceId,
      tenantId: params.tenantId,
      bindingId: cursor,
      stateDir: params.stateDir,
    });
    if (!row) {
      break;
    }
    bindings.push(row);
    cursor = row.previousBindingId ?? "";
  }
  return { bindings, nextCursor: cursor || null };
}
