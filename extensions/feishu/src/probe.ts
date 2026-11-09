import { raceWithTimeoutAndAbort } from "./async.js";
import { createFeishuClient, type FeishuClientCredentials } from "./client.js";
import type { FeishuProbeResult } from "./types.js";

/** Cache probe results to reduce repeated health-check calls.
 * Gateway health checks call probeFeishu() every minute; without caching this
 * burns ~43,200 calls/month, easily exceeding Feishu's free-tier quota.
 * Successful bot info is effectively static, while failures are cached briefly
 * to avoid hammering the API during transient outages. */
const probeCache = new Map<string, { result: FeishuProbeResult; expiresAt: number }>();
const PROBE_SUCCESS_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PROBE_ERROR_TTL_MS = 60 * 1000; // 1 minute
const MAX_PROBE_CACHE_SIZE = 64;
export const FEISHU_PROBE_REQUEST_TIMEOUT_MS = 10_000;
export type ProbeFeishuOptions = {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

type FeishuBotInfoResponse = {
  code: number;
  msg?: string;
  bot?: { bot_name?: string; open_id?: string };
  data?: { bot?: { bot_name?: string; open_id?: string } };
};

function setCachedProbeResult(
  cacheKey: string,
  result: FeishuProbeResult,
  ttlMs: number,
): FeishuProbeResult {
  probeCache.set(cacheKey, { result, expiresAt: Date.now() + ttlMs });
  if (probeCache.size > MAX_PROBE_CACHE_SIZE) {
    const oldest = probeCache.keys().next().value;
    if (oldest !== undefined) {
      probeCache.delete(oldest);
    }
  }
  return result;
}

export async function probeFeishu(
  creds?: FeishuClientCredentials,
  options: ProbeFeishuOptions = {},
): Promise<FeishuProbeResult> {
  if (!creds?.appId || !creds?.appSecret) {
    return {
      ok: false,
      error: "missing credentials (appId, appSecret)",
    };
  }
  if (options.abortSignal?.aborted) {
    return {
      ok: false,
      appId: creds.appId,
      error: "probe aborted",
    };
  }

  const timeoutMs = options.timeoutMs ?? FEISHU_PROBE_REQUEST_TIMEOUT_MS;

  // Return cached result if still valid.
  // Use accountId when available; otherwise include appSecret prefix so two
  // accounts sharing the same appId (e.g. after secret rotation) don't
  // pollute each other's cache entry.
  const cacheKey = creds.accountId ?? `${creds.appId}:${creds.appSecret.slice(0, 8)}`;
  const cached = probeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const client = createFeishuClient(creds);
    // Use bot/v3/info API to get bot information
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK generic request method
    const responseResult = await raceWithTimeoutAndAbort<FeishuBotInfoResponse>(
      (client as any).request({
        method: "GET",
        url: "/open-apis/bot/v3/info",
        data: {},
        timeout: timeoutMs,
      }) as Promise<FeishuBotInfoResponse>,
      {
        timeoutMs,
        abortSignal: options.abortSignal,
      },
    );

    if (responseResult.status === "aborted") {
      return {
        ok: false,
        appId: creds.appId,
        error: "probe aborted",
      };
    }
    if (responseResult.status === "timeout") {
      return setCachedProbeResult(
        cacheKey,
        {
          ok: false,
          appId: creds.appId,
          error: `probe timed out after ${timeoutMs}ms`,
        },
        PROBE_ERROR_TTL_MS,
      );
    }

    const response = responseResult.value;
    if (options.abortSignal?.aborted) {
      return {
        ok: false,
        appId: creds.appId,
        error: "probe aborted",
      };
    }

    if (response.code !== 0) {
      return setCachedProbeResult(
        cacheKey,
        {
          ok: false,
          appId: creds.appId,
          error: `API error: ${response.msg || `code ${response.code}`}`,
        },
        PROBE_ERROR_TTL_MS,
      );
    }

    const bot = response.bot || response.data?.bot;
    const observation = await observeFeishuEnterpriseApp(client, {
      timeoutMs,
      abortSignal: options.abortSignal,
    });
    return setCachedProbeResult(
      cacheKey,
      {
        ok: true,
        appId: creds.appId,
        botName: bot?.bot_name,
        botOpenId: bot?.open_id,
        ...(observation.tenantKey ? { tenantKey: observation.tenantKey } : {}),
        grantedScopeNames: observation.grantedScopeNames,
      },
      PROBE_SUCCESS_TTL_MS,
    );
  } catch (err) {
    return setCachedProbeResult(
      cacheKey,
      {
        ok: false,
        appId: creds.appId,
        error: err instanceof Error ? err.message : String(err),
      },
      PROBE_ERROR_TTL_MS,
    );
  }
}

type FeishuRequestClient = {
  request: (args: {
    method: string;
    url: string;
    data?: unknown;
    timeout?: number;
  }) => Promise<unknown>;
};

function readTenantKey(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as {
    data?: { tenant?: { tenant_key?: unknown } };
    tenant?: { tenant_key?: unknown };
  };
  const key = record.data?.tenant?.tenant_key ?? record.tenant?.tenant_key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function readGrantedScopeNames(body: unknown): string[] | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as { data?: { scopes?: unknown }; scopes?: unknown };
  const scopes = record.data?.scopes ?? record.scopes;
  if (!Array.isArray(scopes)) {
    return null;
  }
  const names: string[] = [];
  for (const scope of scopes) {
    if (!scope || typeof scope !== "object") {
      continue;
    }
    const row = scope as { scope_name?: unknown; grant_status?: unknown };
    const granted =
      row.grant_status === 1 || row.grant_status === "1" || row.grant_status === "granted";
    if (granted && typeof row.scope_name === "string" && row.scope_name.trim()) {
      names.push(row.scope_name.trim());
    }
  }
  return names;
}

async function observeFeishuEnterpriseApp(
  client: FeishuRequestClient,
  options: { timeoutMs: number; abortSignal?: AbortSignal },
): Promise<{ tenantKey: string | null; grantedScopeNames: string[] | null }> {
  const read = async (url: string): Promise<unknown | null> => {
    try {
      const raced = await raceWithTimeoutAndAbort(
        client.request({ method: "GET", url, data: {}, timeout: options.timeoutMs }),
        { timeoutMs: options.timeoutMs, abortSignal: options.abortSignal },
      );
      return raced.status === "resolved" ? raced.value : null;
    } catch {
      return null;
    }
  };
  const [tenantBody, scopeBody] = await Promise.all([
    read("/open-apis/tenant/v2/tenant/query"),
    read("/open-apis/application/v6/scopes"),
  ]);
  return {
    tenantKey: readTenantKey(tenantBody),
    grantedScopeNames: readGrantedScopeNames(scopeBody),
  };
}

/** Clear the probe cache (for testing). */
export function clearProbeCache(): void {
  probeCache.clear();
}
