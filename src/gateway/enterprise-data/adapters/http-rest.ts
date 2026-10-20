import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret, HttpRestAuthScheme } from "../types.js";

export type HttpRestProbeResult = {
  ok: boolean;
  message: string;
};

/** Read action handler ref registered by the http-rest connector package. */
export const HTTP_REST_READ_HANDLER_REF = "enterprise-data/handlers/http-rest-read-resource-v1";

/**
 * Normalize a user-provided base URL: trim, strip trailing slashes, and default
 * to https:// when no scheme is present. The base URL is expected to be a
 * reachable endpoint; the probe targets `${baseUrl}${probePath ?? ""}` and
 * expects a 2xx response when the API is healthy.
 */
export function normalizeHttpRestBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("HTTP REST base URL is required.");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function resolveAuthScheme(secret: DataConnectorCredentialSecret): HttpRestAuthScheme {
  return secret.authScheme ?? "bearer";
}

function resolveAuthToken(secret: DataConnectorCredentialSecret): string {
  const token = secret.apiKey?.trim() || secret.oauthAccessToken?.trim();
  if (!token) {
    throw new Error("HTTP REST access token is required.");
  }
  return token;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.trim().replace(/^\/+/, "");
  return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

/**
 * Apply the configured auth scheme to a request, returning the (possibly
 * rewritten) URL and the headers to send. Throws a descriptive error when a
 * scheme is missing its required configuration so the probe can surface it.
 */
export function buildHttpRestRequest(
  url: string,
  secret: DataConnectorCredentialSecret,
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { Accept: "application/json" };
  const scheme = resolveAuthScheme(secret);
  if (scheme === "none") {
    return { url, headers };
  }
  const token = resolveAuthToken(secret);
  switch (scheme) {
    case "bearer":
      headers.Authorization = `Bearer ${token}`;
      return { url, headers };
    case "basic": {
      const user = secret.basicUsername?.trim() ?? "";
      headers.Authorization = `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
      return { url, headers };
    }
    case "header": {
      const name = secret.authHeaderName?.trim();
      if (!name) {
        throw new Error("HTTP REST 自定义请求头名称缺失（authHeaderName）。");
      }
      headers[name] = token;
      return { url, headers };
    }
    case "query": {
      const param = secret.authQueryParam?.trim();
      if (!param) {
        throw new Error("HTTP REST 查询参数名称缺失（authQueryParam）。");
      }
      const parsed = new URL(url);
      parsed.searchParams.set(param, token);
      return { url: parsed.toString(), headers };
    }
    default:
      return { url, headers };
  }
}

export async function probeHttpRestConnection(
  secret: DataConnectorCredentialSecret,
): Promise<HttpRestProbeResult> {
  let response: Response;
  try {
    const baseUrl = normalizeHttpRestBaseUrl(secret.instanceUrl ?? "");
    const probeUrl = joinUrl(baseUrl, secret.probePath ?? "");
    const { url, headers } = buildHttpRestRequest(probeUrl, secret);
    response = await fetch(url, { method: "GET", headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    return { ok: false, message: `无法连接 REST API：${message}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      message: `REST API 返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`,
    };
  }
  return {
    ok: true,
    message: "REST API 连通性正常（已验证凭证）。",
  };
}

export async function executeHttpRestHandler(
  handlerRef: string,
  input: MockHandlerInput,
  secret: DataConnectorCredentialSecret,
): Promise<MockHandlerResult> {
  if (handlerRef !== HTTP_REST_READ_HANDLER_REF) {
    throw new Error(`HTTP REST adapter does not support handler: ${handlerRef}`);
  }
  const baseUrl = normalizeHttpRestBaseUrl(secret.instanceUrl ?? "");
  // Optional relative resource path from the action input; defaults to base URL.
  const rawPath = typeof input.input?.path === "string" ? input.input.path : "";
  const { url, headers } = buildHttpRestRequest(joinUrl(baseUrl, rawPath), secret);
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`HTTP REST read failed with status ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const resource = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { payload: { resource } };
}
