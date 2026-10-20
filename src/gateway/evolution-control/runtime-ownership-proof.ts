/**
 * Server-issued tenant ownership proof for evolution ingest.
 *
 * Service aliases (assistant-runtime / group-supervisor) are never tenants.
 * Proof binds tenant + concrete agent + run context + version/time.
 * Missing, expired, or mismatched proof stays fail-closed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { resolveEvolutionControlRoot } from "./persistent-store.js";

export const EVOLUTION_SERVICE_ALIASES = new Set(["assistant-runtime", "group-supervisor"]);
export const RUNTIME_OWNERSHIP_PROOF_VERSION = 1;
export const RUNTIME_OWNERSHIP_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
const PROOF_PREFIX = "evop1";

export type RuntimeOwnershipBinding = {
  runId: string;
  agentId: string;
  tenantId: string;
  issuedAt: number;
  expiresAt: number;
  proofVersion: typeof RUNTIME_OWNERSHIP_PROOF_VERSION;
};

export type IssuedRuntimeOwnershipProof = {
  binding: RuntimeOwnershipBinding;
  token: string;
  fingerprint: string;
};

export type VerifyRuntimeOwnershipProofOk = {
  ok: true;
  binding: RuntimeOwnershipBinding;
  source: "token" | "binding";
};

export type VerifyRuntimeOwnershipProofDenied = {
  ok: false;
  reason:
    | "missing_proof"
    | "missing_secret"
    | "malformed_proof"
    | "expired"
    | "tenant_mismatch"
    | "agent_mismatch"
    | "run_mismatch"
    | "cross_tenant"
    | "binding_not_found";
};

type ProofPayload = {
  v: typeof RUNTIME_OWNERSHIP_PROOF_VERSION;
  runId: string;
  agentId: string;
  tenantId: string;
  issuedAt: number;
  expiresAt: number;
};

const memoryBindings = new Map<string, RuntimeOwnershipBinding>();

function concreteAgentId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeAgentId(trimmed);
  return normalized || null;
}

export function isEvolutionServiceAlias(agentId: string | null | undefined): boolean {
  const normalized = concreteAgentId(agentId);
  return normalized !== null && EVOLUTION_SERVICE_ALIASES.has(normalized);
}

export function resolveConcreteAgentFromSessionKey(
  sessionKey: string | null | undefined,
): string | null {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed?.agentId) {
    return null;
  }
  const agentId = concreteAgentId(parsed.agentId);
  if (!agentId || isEvolutionServiceAlias(agentId)) {
    return null;
  }
  return agentId;
}

export function resetRuntimeOwnershipProofsForTests(): void {
  memoryBindings.clear();
}

function bindingsPath(persistDir?: string): string {
  return path.join(resolveEvolutionControlRoot(persistDir), "runtime-ownership-bindings.json");
}

function readPersistedBindings(persistDir?: string): Record<string, RuntimeOwnershipBinding> {
  const filePath = bindingsPath(persistDir);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, RuntimeOwnershipBinding>;
  } catch {
    return {};
  }
}

function writePersistedBindings(
  records: Record<string, RuntimeOwnershipBinding>,
  persistDir?: string,
): void {
  const filePath = bindingsPath(persistDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function resolveSecret(explicit?: string): string | null {
  const secret = (explicit ?? process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET ?? "").trim();
  return secret || null;
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function fingerprintsFor(binding: RuntimeOwnershipBinding): string {
  return `binding:${binding.runId}:v${binding.proofVersion}`;
}

function normalizeBinding(input: {
  runId: string;
  agentId: string;
  tenantId: string;
  now?: number;
  ttlMs?: number;
}): RuntimeOwnershipBinding | null {
  const runId = input.runId.trim();
  const agentId = concreteAgentId(input.agentId);
  const tenantId = canonicalizeTenantId(input.tenantId);
  if (!runId || !agentId || !tenantId || isEvolutionServiceAlias(agentId)) {
    return null;
  }
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? RUNTIME_OWNERSHIP_PROOF_TTL_MS;
  return {
    runId,
    agentId,
    tenantId,
    issuedAt: now,
    expiresAt: now + ttlMs,
    proofVersion: RUNTIME_OWNERSHIP_PROOF_VERSION,
  };
}

export function rememberRuntimeOwnershipBinding(
  binding: RuntimeOwnershipBinding,
  persistDir?: string,
): void {
  memoryBindings.set(binding.runId, binding);
  const persistToDisk = Boolean(persistDir?.trim()) || process.env.VITEST !== "true";
  if (!persistToDisk) {
    return;
  }
  const persisted = readPersistedBindings(persistDir);
  persisted[binding.runId] = binding;
  writePersistedBindings(persisted, persistDir);
}

export function lookupRuntimeOwnershipBinding(
  runId: string | null | undefined,
  persistDir?: string,
  now = Date.now(),
): RuntimeOwnershipBinding | null {
  const id = runId?.trim();
  if (!id) {
    return null;
  }
  const binding = memoryBindings.get(id) ?? readPersistedBindings(persistDir)[id];
  if (!binding) {
    return null;
  }
  if (binding.expiresAt <= now) {
    memoryBindings.delete(id);
    return null;
  }
  return binding;
}

export function issueRuntimeOwnershipProof(input: {
  runId: string;
  agentId: string;
  tenantId: string;
  now?: number;
  ttlMs?: number;
  secret?: string;
  persistDir?: string;
}): IssuedRuntimeOwnershipProof | null {
  const binding = normalizeBinding(input);
  if (!binding) {
    return null;
  }
  rememberRuntimeOwnershipBinding(binding, input.persistDir);
  const secret = resolveSecret(input.secret);
  if (!secret) {
    return {
      binding,
      token: fingerprintsFor(binding),
      fingerprint: fingerprintsFor(binding),
    };
  }
  const payload: ProofPayload = {
    v: binding.proofVersion,
    runId: binding.runId,
    agentId: binding.agentId,
    tenantId: binding.tenantId,
    issuedAt: binding.issuedAt,
    expiresAt: binding.expiresAt,
  };
  const encoded = b64url(JSON.stringify(payload));
  const token = `${PROOF_PREFIX}.${encoded}.${signPayload(encoded, secret)}`;
  return {
    binding,
    token,
    fingerprint: fingerprintsFor(binding),
  };
}

function parseToken(
  token: string,
  secret: string,
  now: number,
): { ok: true; binding: RuntimeOwnershipBinding } | VerifyRuntimeOwnershipProofDenied {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PROOF_PREFIX) {
    return { ok: false, reason: "malformed_proof" };
  }
  const [, encoded, signature] = parts;
  const expected = signPayload(encoded, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "malformed_proof" };
  }
  let payload: ProofPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ProofPayload;
  } catch {
    return { ok: false, reason: "malformed_proof" };
  }
  if (payload.v !== RUNTIME_OWNERSHIP_PROOF_VERSION) {
    return { ok: false, reason: "malformed_proof" };
  }
  if (payload.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  const binding = normalizeBinding({
    runId: payload.runId,
    agentId: payload.agentId,
    tenantId: payload.tenantId,
    now: payload.issuedAt,
    ttlMs: payload.expiresAt - payload.issuedAt,
  });
  if (!binding) {
    return { ok: false, reason: "malformed_proof" };
  }
  return { ok: true, binding };
}

export function verifyRuntimeOwnershipProof(input: {
  token?: string | null;
  runId?: string | null;
  expectedAgentId?: string | null;
  expectedTenantId?: string | null;
  now?: number;
  secret?: string;
  persistDir?: string;
}): VerifyRuntimeOwnershipProofOk | VerifyRuntimeOwnershipProofDenied {
  const now = input.now ?? Date.now();
  const token = input.token?.trim() || "";
  if (token.startsWith(`${PROOF_PREFIX}.`)) {
    const secret = resolveSecret(input.secret);
    if (!secret) {
      return { ok: false, reason: "missing_secret" };
    }
    const parsed = parseToken(token, secret, now);
    if (!parsed.ok) {
      return parsed;
    }
    return matchBinding(parsed.binding, input, "token");
  }
  const binding = lookupRuntimeOwnershipBinding(input.runId, input.persistDir, now);
  if (!binding) {
    return { ok: false, reason: token ? "malformed_proof" : "binding_not_found" };
  }
  return matchBinding(binding, input, "binding");
}

function matchBinding(
  binding: RuntimeOwnershipBinding,
  input: {
    runId?: string | null;
    expectedAgentId?: string | null;
    expectedTenantId?: string | null;
  },
  source: "token" | "binding",
): VerifyRuntimeOwnershipProofOk | VerifyRuntimeOwnershipProofDenied {
  const runId = input.runId?.trim();
  if (runId && runId !== binding.runId) {
    return { ok: false, reason: "run_mismatch" };
  }
  const expectedAgent = concreteAgentId(input.expectedAgentId);
  if (expectedAgent && expectedAgent !== binding.agentId) {
    return { ok: false, reason: "agent_mismatch" };
  }
  const expectedTenant = canonicalizeTenantId(input.expectedTenantId);
  if (expectedTenant && expectedTenant !== binding.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  return { ok: true, binding, source };
}
