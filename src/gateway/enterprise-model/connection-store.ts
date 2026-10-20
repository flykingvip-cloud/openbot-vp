/**
 * Tenant-keyed enterprise model provider connection store.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { EnterpriseModelError } from "./errors.js";
import { buildCredentialRef } from "./ids.js";
import type {
  EnterpriseModelConnectionStatus,
  EnterpriseModelHealthStatus,
  EnterpriseModelProbeCode,
  EnterpriseModelProviderConnection,
  EnterpriseModelProviderType,
} from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  /** key = connectionId */
  connections: Record<string, EnterpriseModelProviderConnection>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, connections: {} };
}

export function resolveDefaultConnectionStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-enterprise-model-connections.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultConnectionStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.connections !== "object" || parsed.connections === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, connections: parsed.connections };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultConnectionStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

const PROVIDER_TYPES: ReadonlySet<EnterpriseModelProviderType> = new Set([
  "openai",
  "anthropic",
  "openai-compatible",
  "custom",
]);

export function parseProviderType(raw: unknown): EnterpriseModelProviderType | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim() as EnterpriseModelProviderType;
  return PROVIDER_TYPES.has(value) ? value : null;
}

export async function listEnterpriseModelConnections(
  tenantId: string,
  storePath?: string,
): Promise<EnterpriseModelProviderConnection[]> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return [];
  }
  const store = await loadStore(storePath);
  return Object.values(store.connections)
    .filter((row) => row.tenantId === canonical)
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getEnterpriseModelConnection(
  tenantId: string,
  connectionId: string,
  storePath?: string,
): Promise<EnterpriseModelProviderConnection | null> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return null;
  }
  const store = await loadStore(storePath);
  const row = store.connections[connectionId];
  if (!row || row.tenantId !== canonical) {
    return null;
  }
  return row;
}

export async function createEnterpriseModelConnection(
  input: {
    tenantId: string;
    providerType: EnterpriseModelProviderType;
    displayName: string;
    baseUrl?: string;
    protocol?: string;
    connectionId?: string;
  },
  storePath?: string,
): Promise<EnterpriseModelProviderConnection> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "invalid tenantId");
  }
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "displayName required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const connectionId = input.connectionId?.trim() || randomUUID();
    if (store.connections[connectionId]) {
      throw new EnterpriseModelError(
        "ENTERPRISE_MODEL_INVALID_REQUEST",
        "connectionId already exists",
      );
    }
    const now = new Date().toISOString();
    const record: EnterpriseModelProviderConnection = {
      tenantId: canonical,
      connectionId,
      providerType: input.providerType,
      displayName,
      ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
      protocol: input.protocol?.trim() || defaultProtocol(input.providerType),
      credentialRef: buildCredentialRef(canonical, connectionId),
      status: "draft",
      healthStatus: "unchecked",
      createdAt: now,
      updatedAt: now,
    };
    store.connections[connectionId] = record;
    await saveStore(store, storePath);
    return record;
  });
}

function defaultProtocol(providerType: EnterpriseModelProviderType): string {
  if (providerType === "anthropic") {
    return "anthropic-messages";
  }
  return "openai-completions";
}

function normalizeOptionalUrl(value: string | null | undefined): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Connection statuses that may back catalog registration / runtime resolve. */
export function isEnterpriseModelConnectionCatalogReady(
  status: EnterpriseModelConnectionStatus,
): boolean {
  return status === "verified" || status === "models_discovered" || status === "active";
}

export async function updateEnterpriseModelConnection(
  input: {
    tenantId: string;
    connectionId: string;
    displayName?: string;
    baseUrl?: string | null;
    protocol?: string;
    status?: EnterpriseModelConnectionStatus;
    healthStatus?: EnterpriseModelHealthStatus;
    secretHint?: string;
    lastVerifiedAt?: string | null;
    lastVerificationResult?: EnterpriseModelProviderConnection["lastVerificationResult"] | null;
    disabledAt?: string | null;
    /**
     * When true, skip automatic invalidate-on-endpoint-change.
     * Used by probe success paths that only bump status/health.
     */
    skipEndpointInvalidation?: boolean;
  },
  storePath?: string,
): Promise<EnterpriseModelProviderConnection> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "invalid tenantId");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.connections[input.connectionId];
    if (!existing || existing.tenantId !== canonical) {
      throw new EnterpriseModelError("ENTERPRISE_MODEL_NOT_FOUND", "connection not found");
    }

    const nextBaseUrl =
      input.baseUrl !== undefined ? normalizeOptionalUrl(input.baseUrl) : existing.baseUrl;
    const nextProtocol = input.protocol !== undefined ? input.protocol.trim() : existing.protocol;
    const endpointChanged =
      !input.skipEndpointInvalidation &&
      (nextBaseUrl !== existing.baseUrl || nextProtocol !== existing.protocol);

    const next: EnterpriseModelProviderConnection = {
      ...existing,
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
      ...(input.protocol !== undefined ? { protocol: input.protocol.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus } : {}),
      ...(input.secretHint !== undefined ? { secretHint: input.secretHint } : {}),
      ...(input.lastVerifiedAt !== undefined && input.lastVerifiedAt !== null
        ? { lastVerifiedAt: input.lastVerifiedAt }
        : {}),
      ...(input.lastVerificationResult !== undefined && input.lastVerificationResult !== null
        ? { lastVerificationResult: input.lastVerificationResult }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    if (input.baseUrl === null) {
      delete next.baseUrl;
    } else if (typeof input.baseUrl === "string") {
      const trimmed = input.baseUrl.trim();
      if (trimmed) {
        next.baseUrl = trimmed;
      } else {
        delete next.baseUrl;
      }
    }
    if (input.disabledAt === null) {
      delete next.disabledAt;
    } else if (typeof input.disabledAt === "string") {
      next.disabledAt = input.disabledAt;
    }

    // Changing endpoint/protocol voids prior verification trust.
    if (endpointChanged) {
      next.status =
        existing.status === "disabled"
          ? "disabled"
          : existing.secretHint || existing.credentialRef
            ? "credential_saved"
            : "draft";
      next.healthStatus = "unchecked";
      delete next.lastVerifiedAt;
      delete next.lastVerificationResult;
    } else if (input.lastVerifiedAt === null) {
      delete next.lastVerifiedAt;
    }
    if (!endpointChanged && input.lastVerificationResult === null) {
      delete next.lastVerificationResult;
    }

    store.connections[input.connectionId] = next;
    await saveStore(store, storePath);
    return next;
  });
}

export async function deleteEnterpriseModelConnection(
  tenantId: string,
  connectionId: string,
  storePath?: string,
): Promise<EnterpriseModelProviderConnection> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "invalid tenantId");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.connections[connectionId];
    if (!existing || existing.tenantId !== canonical) {
      throw new EnterpriseModelError("ENTERPRISE_MODEL_NOT_FOUND", "connection not found");
    }
    delete store.connections[connectionId];
    await saveStore(store, storePath);
    return existing;
  });
}

export function mapProbeCodeToConnectionStatus(
  code: EnterpriseModelProbeCode,
): EnterpriseModelConnectionStatus {
  switch (code) {
    case "OK":
      return "verified";
    case "ENTERPRISE_MODEL_INVALID_CREDENTIAL":
    case "ENTERPRISE_MODEL_FORBIDDEN":
      return "invalid_credential";
    case "ENTERPRISE_MODEL_NETWORK_UNREACHABLE":
    case "ENTERPRISE_MODEL_TIMEOUT":
      return "network_unreachable";
    case "ENTERPRISE_MODEL_PROTOCOL_MISMATCH":
      return "protocol_incompatible";
    case "ENTERPRISE_MODEL_RATE_LIMITED":
      return "rate_limited";
    default:
      return "invalid_credential";
  }
}
