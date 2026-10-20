import fs from "node:fs";
import path from "node:path";
import { normalizeAgentId } from "../../routing/session-key.js";
import type { GatewayAgentIdentity } from "../../shared/session-types.js";
import { CONFIG_DIR } from "../../utils.js";

/**
 * Control-plane CatalogPort — authoritative agent **entities**.
 *
 * Production SoT is a shared control plane:
 * - http(s) → HTTP CatalogPort client
 * - file path / file:// → shared-file remote adapter
 * - memory → tests
 * Local CONFIG_DIR JSON is local-file adapter only (dev/self-host single process).
 */

export type AgentCatalogEntity = {
  agentId: string;
  tenantId: string;
  name?: string;
  identity?: GatewayAgentIdentity;
  ownerId?: string;
  ownerName?: string;
  scope?: string;
  shareStatus?: string;
  runtimeBinding?: string;
  disabled?: boolean;
  updatedAt: string;
};

export type AgentCatalogPortKind = "remote" | "local-file" | "memory" | "http";

export type AgentCatalogPort = {
  readonly controlPlaneId: string;
  readonly kind: AgentCatalogPortKind;
  listEntities(tenantId: string): Promise<AgentCatalogEntity[]>;
  getEntity(tenantId: string, agentId: string): Promise<AgentCatalogEntity | null>;
  upsertEntity(
    entity: Omit<AgentCatalogEntity, "updatedAt"> & { updatedAt?: string },
  ): Promise<AgentCatalogEntity>;
};

export type CatalogEntitlementIntegrity =
  | "ok"
  | "catalog_missing"
  | "not_entitled"
  | "tenant_missing"
  | "disabled";

export type AgentCatalogStore = {
  version: 1;
  entries: Record<string, AgentCatalogEntity>;
};

export type AgentCatalogSource = {
  readStore: () => AgentCatalogStore;
  writeStore: (store: AgentCatalogStore) => void;
};

export function requireTenantId(tenantId: string | null | undefined): string | null {
  const trimmed = tenantId?.trim();
  return trimmed ? trimmed : null;
}

export function makeCatalogEntityKey(tenantId: string, agentId: string): string {
  return `${tenantId.trim()}:${normalizeAgentId(agentId)}`;
}

function emptyStore(): AgentCatalogStore {
  return { version: 1, entries: {} };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(filePath: string): AgentCatalogStore {
  try {
    if (!fs.existsSync(filePath)) {
      return emptyStore();
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentCatalogStore;
  } catch {
    return emptyStore();
  }
}

function writeJsonFile(filePath: string, data: AgentCatalogStore): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function classifyCatalogEntitlement(params: {
  tenantId: string | null | undefined;
  agentId: string;
  entitledIds: ReadonlySet<string>;
  entity: AgentCatalogEntity | null | undefined;
}): CatalogEntitlementIntegrity {
  if (!requireTenantId(params.tenantId)) {
    return "tenant_missing";
  }
  const agentId = normalizeAgentId(params.agentId);
  if (!params.entitledIds.has(agentId)) {
    return "not_entitled";
  }
  if (!params.entity) {
    return "catalog_missing";
  }
  if (params.entity.disabled) {
    return "disabled";
  }
  return "ok";
}

export function createInMemoryAgentCatalogPort(controlPlaneId = "memory-cp"): AgentCatalogPort {
  const entries = new Map<string, AgentCatalogEntity>();
  return {
    controlPlaneId,
    kind: "memory",
    async listEntities(tenantId) {
      const tid = requireTenantId(tenantId);
      if (!tid) {
        return [];
      }
      return [...entries.values()].filter((entry) => entry.tenantId === tid);
    },
    async getEntity(tenantId, agentId) {
      const tid = requireTenantId(tenantId);
      if (!tid) {
        return null;
      }
      return entries.get(makeCatalogEntityKey(tid, agentId)) ?? null;
    },
    async upsertEntity(entity) {
      const tid = requireTenantId(entity.tenantId);
      if (!tid) {
        throw new Error("tenantId required for catalog upsert");
      }
      const agentId = normalizeAgentId(entity.agentId);
      const key = makeCatalogEntityKey(tid, agentId);
      const previous = entries.get(key);
      const next: AgentCatalogEntity = {
        ...previous,
        ...entity,
        tenantId: tid,
        agentId,
        updatedAt: entity.updatedAt ?? new Date().toISOString(),
      };
      entries.set(key, next);
      return next;
    },
  };
}

export function createFileAgentCatalogSource(storeFile: string): AgentCatalogSource {
  return {
    readStore: () => readJsonFile(storeFile),
    writeStore: (store) => writeJsonFile(storeFile, store),
  };
}

function createFileBackedPort(
  source: AgentCatalogSource,
  controlPlaneId: string,
  kind: "local-file" | "remote",
): AgentCatalogPort {
  return {
    controlPlaneId,
    kind,
    async listEntities(tenantId) {
      const tid = requireTenantId(tenantId);
      if (!tid) {
        return [];
      }
      return Object.values(source.readStore().entries).filter((entry) => entry.tenantId === tid);
    },
    async getEntity(tenantId, agentId) {
      const tid = requireTenantId(tenantId);
      if (!tid) {
        return null;
      }
      return source.readStore().entries[makeCatalogEntityKey(tid, agentId)] ?? null;
    },
    async upsertEntity(entity) {
      const tid = requireTenantId(entity.tenantId);
      if (!tid) {
        throw new Error("tenantId required for catalog upsert (fail closed; no default tenant)");
      }
      const store = source.readStore();
      const agentId = normalizeAgentId(entity.agentId);
      const key = makeCatalogEntityKey(tid, agentId);
      const previous = store.entries[key];
      const next: AgentCatalogEntity = {
        ...previous,
        ...entity,
        tenantId: tid,
        agentId,
        updatedAt: entity.updatedAt ?? new Date().toISOString(),
      };
      store.entries[key] = next;
      source.writeStore(store);
      return next;
    },
  };
}

export function createLocalFileAgentCatalogPort(
  sourceOrFile?: AgentCatalogSource | string,
  controlPlaneId = "local-file-adapter",
): AgentCatalogPort {
  const source =
    typeof sourceOrFile === "string"
      ? createFileAgentCatalogSource(sourceOrFile)
      : (sourceOrFile ??
        createFileAgentCatalogSource(path.join(CONFIG_DIR, "organization", "agent-catalog.json")));
  return createFileBackedPort(source, controlPlaneId, "local-file");
}

export function createRemoteAgentCatalogPort(params: {
  storeFile: string;
  controlPlaneId: string;
}): AgentCatalogPort {
  const storeFile = params.storeFile.trim();
  if (!storeFile) {
    throw new Error("remote catalog requires storeFile");
  }
  const controlPlaneId = params.controlPlaneId.trim() || `remote:${storeFile}`;
  return createFileBackedPort(createFileAgentCatalogSource(storeFile), controlPlaneId, "remote");
}

export type HttpAgentCatalogFetch = typeof fetch;

/**
 * HTTP CatalogPort client — talks to a control-plane Gateway serving
 * `/__openbot/control-plane/v1/tenants/{tenantId}/agent-catalog`.
 */
export function createHttpAgentCatalogPort(params: {
  baseUrl: string;
  controlPlaneId?: string;
  token?: string;
  fetchImpl?: HttpAgentCatalogFetch;
}): AgentCatalogPort {
  const base = params.baseUrl.replace(/\/+$/, "");
  const controlPlaneId = params.controlPlaneId?.trim() || `http:${base}`;
  const fetchImpl = params.fetchImpl ?? fetch;
  const token = params.token?.trim() || process.env.OPENBOT_CONTROL_PLANE_TOKEN?.trim() || "";

  async function request(method: string, pathname: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetchImpl(`${base}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return {
    controlPlaneId,
    kind: "http",
    async listEntities(tenantId) {
      const tid = requireTenantId(tenantId);
      if (!tid) {
        return [];
      }
      const res = await request(
        "GET",
        `/__openbot/control-plane/v1/tenants/${encodeURIComponent(tid)}/agent-catalog`,
      );
      if (!res.ok) {
        throw new Error(`catalog list failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { entities?: AgentCatalogEntity[] };
      return Array.isArray(json.entities) ? json.entities : [];
    },
    async getEntity(tenantId, agentId) {
      const tid = requireTenantId(tenantId);
      if (!tid) {
        return null;
      }
      const id = normalizeAgentId(agentId);
      const res = await request(
        "GET",
        `/__openbot/control-plane/v1/tenants/${encodeURIComponent(tid)}/agent-catalog/${encodeURIComponent(id)}`,
      );
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`catalog get failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { entity?: AgentCatalogEntity | null };
      return json.entity ?? null;
    },
    async upsertEntity(entity) {
      const tid = requireTenantId(entity.tenantId);
      if (!tid) {
        throw new Error("tenantId required for catalog upsert");
      }
      const id = normalizeAgentId(entity.agentId);
      const res = await request(
        "PUT",
        `/__openbot/control-plane/v1/tenants/${encodeURIComponent(tid)}/agent-catalog/${encodeURIComponent(id)}`,
        entity,
      );
      if (!res.ok) {
        throw new Error(`catalog upsert failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { entity: AgentCatalogEntity };
      return json.entity;
    },
  };
}

let activeCatalogPort: AgentCatalogPort | null = null;
/** Serving port for HTTP handler — never the HTTP client (avoids loops). */
let servingCatalogPort: AgentCatalogPort | null = null;

export function setAgentCatalogPortForTests(port: AgentCatalogPort | null): void {
  activeCatalogPort = port;
  servingCatalogPort = port;
}

function resolveSharedFileFromEnv(): { storeFile: string; controlPlaneId: string } | null {
  const catalogPath = process.env.OPENBOT_CONTROL_PLANE_CATALOG_PATH?.trim();
  if (catalogPath) {
    return {
      storeFile: path.isAbsolute(catalogPath)
        ? catalogPath
        : path.resolve(process.cwd(), catalogPath),
      controlPlaneId: `remote:path:${catalogPath}`,
    };
  }
  const url = process.env.OPENBOT_CONTROL_PLANE_URL?.trim();
  if (!url) {
    return null;
  }
  if (url.startsWith("file://")) {
    return {
      storeFile: url.slice("file://".length),
      controlPlaneId: `remote:url:${url}`,
    };
  }
  if (url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url)) {
    return {
      storeFile: url,
      controlPlaneId: `remote:path:${url}`,
    };
  }
  return null;
}

/**
 * Port used by this process when *serving* catalog HTTP (never http client).
 */
export function resolveServingAgentCatalogPort(): AgentCatalogPort {
  if (servingCatalogPort) {
    return servingCatalogPort;
  }
  const shared = resolveSharedFileFromEnv();
  if (shared) {
    servingCatalogPort = createRemoteAgentCatalogPort(shared);
    return servingCatalogPort;
  }
  servingCatalogPort = createLocalFileAgentCatalogPort(
    path.join(CONFIG_DIR, "organization", "agent-catalog.json"),
    "local-file-adapter",
  );
  return servingCatalogPort;
}

/**
 * Port used by roster projection / migration clients.
 */
export function resolveAgentCatalogPort(): AgentCatalogPort {
  if (activeCatalogPort) {
    return activeCatalogPort;
  }
  const mode = process.env.OPENBOT_AGENT_CATALOG_PORT?.trim().toLowerCase();
  if (mode === "memory") {
    activeCatalogPort = createInMemoryAgentCatalogPort("env-memory-cp");
    return activeCatalogPort;
  }
  if (mode === "local-file") {
    activeCatalogPort = createLocalFileAgentCatalogPort(
      path.join(CONFIG_DIR, "organization", "agent-catalog.json"),
      "local-file-adapter",
    );
    return activeCatalogPort;
  }

  const url = process.env.OPENBOT_CONTROL_PLANE_URL?.trim();
  if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
    activeCatalogPort = createHttpAgentCatalogPort({
      baseUrl: url,
      controlPlaneId: `http:${url.replace(/\/+$/, "")}`,
    });
    return activeCatalogPort;
  }

  const shared = resolveSharedFileFromEnv();
  if (shared) {
    activeCatalogPort = createRemoteAgentCatalogPort(shared);
    return activeCatalogPort;
  }

  if (mode === "remote") {
    throw new Error(
      "OPENBOT_AGENT_CATALOG_PORT=remote requires OPENBOT_CONTROL_PLANE_URL (http/file) or OPENBOT_CONTROL_PLANE_CATALOG_PATH",
    );
  }

  activeCatalogPort = createLocalFileAgentCatalogPort(
    path.join(CONFIG_DIR, "organization", "agent-catalog.json"),
    "local-file-adapter",
  );
  return activeCatalogPort;
}
