import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../../config/config.js";
import { coerceSecretRef } from "../../../config/types.secrets.js";
import { fetchWithSsrFGuard, withStrictGuardedFetchMode } from "../../../infra/net/fetch-guard.js";
import { CONFIG_DIR } from "../../../utils.js";
import { resolveConfiguredSecretInputString } from "../../resolve-configured-secret-input-string.js";
import { listKnowledgeSourceBindings } from "./source-binding-store.js";
import type { SourceDescriptor } from "./source-descriptor.js";
import type { KnowledgeSourceContext } from "./types.js";

export type ApiCatalog = {
  sourceId: string;
  fetchedAtMs: number;
  summary: string;
  entries: unknown[];
};

type ApiCatalogStore = { catalogs: Record<string, ApiCatalog> };
type FetchLike = typeof fetch;

export type ApiSourceRuntimeOptions = {
  bindingsStorePath?: string;
  catalogStorePath?: string;
  fetchFn?: FetchLike;
  env?: NodeJS.ProcessEnv;
  authorizedKnowledgeBaseIds?: ReadonlySet<string>;
};

export type ApiSourceInvokeOptions = ApiSourceRuntimeOptions & {
  method?: string;
  body?: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

const DEFAULT_CATALOG_STORE = path.join(CONFIG_DIR, "knowledge", "source-api-catalogs.json");
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function readStore(storePath = DEFAULT_CATALOG_STORE): ApiCatalogStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as Partial<ApiCatalogStore>;
    return parsed.catalogs && typeof parsed.catalogs === "object"
      ? { catalogs: parsed.catalogs }
      : { catalogs: {} };
  } catch {
    return { catalogs: {} };
  }
}

function writeStore(store: ApiCatalogStore, storePath = DEFAULT_CATALOG_STORE): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function authorizedSource(
  sourceId: string,
  context: KnowledgeSourceContext,
  options: Pick<ApiSourceRuntimeOptions, "authorizedKnowledgeBaseIds" | "bindingsStorePath">,
): SourceDescriptor {
  const ownerId = context.userId?.trim();
  if (!ownerId) {
    throw new Error("user context required for API source access");
  }
  const source = listKnowledgeSourceBindings({}, options.bindingsStorePath).find(
    (item) => item.id === sourceId,
  );
  const knowledgeBaseAuthorized = Boolean(
    source?.knowledgeBaseId && options.authorizedKnowledgeBaseIds?.has(source.knowledgeBaseId),
  );
  if (!source || source.kind !== "api" || !source.endpoint) {
    throw new Error("API source not found or not authorized");
  }
  if (source.ownerId !== ownerId && !knowledgeBaseAuthorized) {
    throw new Error("API source not found or not authorized");
  }
  if (source.metadata?.expiresAt && Date.parse(source.metadata.expiresAt) <= Date.now()) {
    throw new Error("API source expired");
  }
  return source;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

function assertSafeBaseUrl(source: SourceDescriptor): URL {
  const base = new URL(source.endpoint!);
  // HTTP is permitted ONLY when explicitly opted in via request.allowHttp. A legacy
  // inline auth.apiKey must never silently relax transport security — such bindings
  // must be migrated to HTTPS (credentials are additionally refused over plaintext in
  // `request`, so even an explicit allowHttp cannot exfiltrate a secret header).
  const allowHttp = source.metadata?.["request.allowHttp"] === "true";
  if (base.protocol !== "https:" && !(allowHttp && base.protocol === "http:")) {
    throw new Error("API source requires HTTPS unless request.allowHttp is explicitly enabled");
  }
  const hostname = base.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("API source target is not allowed by the network policy");
  }
  return base;
}

export function validateApiSourceEndpoint(endpoint: string, allowHttp = false): URL {
  return assertSafeBaseUrl({
    id: "validation",
    kind: "api",
    plane: "active",
    title: "validation",
    endpoint,
    metadata: allowHttp ? { "request.allowHttp": "true" } : undefined,
    createdAtMs: 0,
  });
}

async function resolveHeaders(
  source: SourceDescriptor,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const name = source.metadata?.["auth.header"]?.trim();
  if (!name) {
    return {};
  }
  if (!HEADER_NAME_PATTERN.test(name)) {
    throw new Error("API source auth header name is invalid");
  }

  let value = source.metadata?.["auth.apiKey"]?.trim();
  const serializedRef = source.metadata?.["auth.secretRef"]?.trim();
  if (serializedRef) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedRef);
    } catch {
      throw new Error("API source credential reference is invalid");
    }
    const ref = coerceSecretRef(parsed);
    if (!ref) {
      throw new Error("API source credential reference is invalid");
    }
    const resolved = await resolveConfiguredSecretInputString({
      config: loadConfig(),
      env,
      value: ref,
      path: `knowledge source ${source.id} credential`,
    });
    if (!resolved.value) {
      throw new Error("API source credential reference could not be resolved");
    }
    value = resolved.value;
  }
  if (!value) {
    throw new Error("API source credential is not configured");
  }
  const scheme = source.metadata?.["auth.scheme"]?.trim();
  return { [name]: scheme ? `${scheme} ${value}` : value };
}

function normalizeMethod(source: SourceDescriptor, requested?: string): string {
  const method = (requested ?? source.metadata?.["request.method"] ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error("API source method is not allowed");
  }
  return method;
}

function resolveRequestUrl(source: SourceDescriptor, pathSuffix: string): URL {
  const base = assertSafeBaseUrl(source);
  const url = new URL(pathSuffix || "/", base);
  if (url.origin !== base.origin) {
    throw new Error("API source request must stay on the bound origin");
  }
  url.username = "";
  url.password = "";
  return url;
}

async function request(
  source: SourceDescriptor,
  pathSuffix: string,
  options: ApiSourceInvokeOptions = {},
): Promise<unknown> {
  const url = resolveRequestUrl(source, pathSuffix);
  const method = normalizeMethod(source, options.method);
  const body = options.body ? JSON.stringify(options.body) : undefined;
  if (body && Buffer.byteLength(body) > MAX_REQUEST_BODY_BYTES) {
    throw new Error("API source request body exceeds the 64 KiB limit");
  }
  const authHeaders = await resolveHeaders(source, options.env ?? process.env);
  // Transport-security invariant: never transmit a credential header over plaintext,
  // even if request.allowHttp was explicitly set. Legacy inline-key bindings must be
  // migrated to HTTPS rather than downgrading the connection.
  if (url.protocol !== "https:" && Object.keys(authHeaders).length > 0) {
    throw new Error(
      "API source refuses to transmit credentials over a non-HTTPS transport; migrate the binding to HTTPS",
    );
  }
  const requestInit: RequestInit = {
    method,
    headers: {
      accept: "application/json",
      ...authHeaders,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body } : {}),
    signal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "manual",
  };
  const guarded = options.fetchFn
    ? null
    : await fetchWithSsrFGuard(
        withStrictGuardedFetchMode({ url: url.toString(), init: requestInit, maxRedirects: 0 }),
      );
  const response = guarded?.response ?? (await options.fetchFn!(url, requestInit));
  try {
    if (response.status >= 300 && response.status < 400) {
      throw new Error("API source redirect refused");
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (declaredBytes > MAX_RESPONSE_BYTES) {
      throw new Error("API source response exceeds 2 MiB");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("API source response exceeds 2 MiB");
    }
    if (bytes.byteLength === 0) {
      return null;
    }
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error("API source returned invalid JSON");
    }
  } finally {
    await guarded?.release();
  }
}

function catalogEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["entries", "tools", "capabilities", "functions", "routes"]) {
    if (Array.isArray(record[key])) {
      return record[key];
    }
  }
  return [];
}

export async function syncApiSourceCatalog(
  sourceId: string,
  context: KnowledgeSourceContext,
  options: ApiSourceRuntimeOptions & { path?: string } = {},
): Promise<ApiCatalog> {
  const source = authorizedSource(sourceId, context, options);
  const catalogPath = options.path ?? source.metadata?.["catalog.path"] ?? "/catalog";
  const payload = await request(source, catalogPath, options);
  const summary =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { summary?: unknown }).summary === "string"
      ? (payload as { summary: string }).summary
      : source.title;
  const catalog = {
    sourceId,
    fetchedAtMs: Date.now(),
    summary,
    entries: catalogEntries(payload),
  };
  const store = readStore(options.catalogStorePath);
  store.catalogs[sourceId] = catalog;
  writeStore(store, options.catalogStorePath);
  return catalog;
}

export function getApiSourceCatalog(
  sourceId: string,
  options: Pick<ApiSourceRuntimeOptions, "catalogStorePath"> = {},
): ApiCatalog | null {
  const catalog = readStore(options.catalogStorePath).catalogs[sourceId];
  if (!catalog || typeof catalog !== "object") {
    return null;
  }
  return {
    sourceId,
    fetchedAtMs: Number.isFinite(catalog.fetchedAtMs) ? catalog.fetchedAtMs : 0,
    summary: typeof catalog.summary === "string" ? catalog.summary : "",
    entries: Array.isArray(catalog.entries) ? catalog.entries : [],
  };
}

export async function invokeApiSource(
  sourceId: string,
  requestPath: string,
  context: KnowledgeSourceContext,
  options: ApiSourceInvokeOptions = {},
): Promise<{ sourceId: string; fetchedAtMs: number; data: unknown }> {
  const source = authorizedSource(sourceId, context, options);
  return {
    sourceId,
    fetchedAtMs: Date.now(),
    data: await request(source, requestPath, options),
  };
}
