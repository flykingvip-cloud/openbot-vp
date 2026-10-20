/**
 * Xiaohongshu personal-note connector adapters.
 *
 * Primary target: https://github.com/vmxmy/xiaohongshu-mcp (REST under /api/v1/*)
 * Fallback: generic OpenBot connector contract (/v1/notes, /v1/comments/:id/replies, /v1/users/:handle)
 */

export type XiaohongshuConnectorKind = "builtin:simulate" | "xiaohongshu-mcp" | "openbot";

export type XiaohongshuPublishInput = {
  title: string;
  content: string;
  images?: string[];
  tags?: string[];
  location?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveXiaohongshuApiBase(): string | null {
  const base =
    process.env.OPENBOT_XIAOHONGSHU_API_BASE?.trim() ||
    process.env.OPENCLAW_XIAOHONGSHU_API_BASE?.trim() ||
    "";
  return base ? base.replace(/\/$/, "") : null;
}

export function isXiaohongshuExecutionConfigured(): boolean {
  return Boolean(resolveXiaohongshuApiBase());
}

function isBuiltinSimulateBase(base: string): boolean {
  const normalized = base.trim().toLowerCase();
  return (
    normalized === "builtin:simulate" || normalized === "simulate" || normalized === "simulated"
  );
}

/** Resolve which HTTP dialect to speak against OPENBOT_XIAOHONGSHU_API_BASE. */
export function resolveXiaohongshuConnectorKind(base?: string | null): XiaohongshuConnectorKind {
  const resolved = (base ?? resolveXiaohongshuApiBase() ?? "").trim();
  if (!resolved) {
    return "openbot";
  }
  if (isBuiltinSimulateBase(resolved)) {
    return "builtin:simulate";
  }
  const forced =
    process.env.OPENBOT_XIAOHONGSHU_CONNECTOR?.trim().toLowerCase() ||
    process.env.OPENCLAW_XIAOHONGSHU_CONNECTOR?.trim().toLowerCase() ||
    "";
  if (forced === "xiaohongshu-mcp" || forced === "mcp" || forced === "xhs-mcp") {
    return "xiaohongshu-mcp";
  }
  if (forced === "openbot" || forced === "generic") {
    return "openbot";
  }
  // Auto-detect common local MCP default port / path hints.
  if (
    /:18060\b/i.test(resolved) ||
    /xiaohongshu-mcp/i.test(resolved) ||
    /\/api\/v1\/?$/i.test(resolved)
  ) {
    return "xiaohongshu-mcp";
  }
  return "openbot";
}

/** Normalize cookie header / EditThisCookie JSON into xiaohongshu-mcp cookies_json. */
export function normalizeXiaohongshuMcpCookiesJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Xiaohongshu cookie / token is empty.");
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("cookies_json must be a non-empty JSON array.");
    }
    return JSON.stringify(parsed);
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.cookies_json === "string") {
      return normalizeXiaohongshuMcpCookiesJson(parsed.cookies_json);
    }
    if (Array.isArray(parsed.cookies)) {
      return JSON.stringify(parsed.cookies);
    }
  }
  // Cookie header: "a1=...; web_session=..."
  const cookies = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) {
        return null;
      }
      return {
        name: part.slice(0, eq).trim(),
        value: part.slice(eq + 1).trim(),
        domain: ".xiaohongshu.com",
        path: "/",
      };
    })
    .filter((entry): entry is { name: string; value: string; domain: string; path: string } =>
      Boolean(entry?.name && entry.value),
    );
  if (cookies.length === 0) {
    throw new Error(
      "Unable to parse Xiaohongshu cookie string (expected a1=...; web_session=...).",
    );
  }
  return JSON.stringify(cookies);
}

function mcpRoot(base: string): string {
  // Allow users to set either http://host:18060 or http://host:18060/api/v1
  return base.replace(/\/api\/v1\/?$/i, "");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function extractErrorMessage(payload: Record<string, unknown>, status: number): string {
  return (
    stringValue(payload.message) ||
    stringValue(payload.error) ||
    stringValue(payload.msg) ||
    `Xiaohongshu connector failed: HTTP ${status}`
  );
}

export async function syncXiaohongshuMcpCookies(params: {
  base: string;
  cookieOrToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; status: Record<string, unknown> } | { ok: false; error: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const root = mcpRoot(params.base);
  let cookiesJson: string;
  try {
    cookiesJson = normalizeXiaohongshuMcpCookiesJson(params.cookieOrToken);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid Xiaohongshu cookie.",
    };
  }
  const syncResponse = await fetchImpl(`${root}/api/v1/login/sync_cookies`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
    body: JSON.stringify({ cookies_json: cookiesJson }),
  });
  const syncPayload = await readJson(syncResponse);
  if (!syncResponse.ok) {
    return { ok: false, error: extractErrorMessage(syncPayload, syncResponse.status) };
  }
  const statusResponse = await fetchImpl(`${root}/api/v1/login/status`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
  });
  const statusPayload = await readJson(statusResponse);
  if (!statusResponse.ok) {
    return { ok: false, error: extractErrorMessage(statusPayload, statusResponse.status) };
  }
  const loggedIn =
    statusPayload.logged_in === true ||
    statusPayload.is_logged_in === true ||
    statusPayload.ok === true ||
    stringValue(statusPayload.status).toLowerCase() === "ok";
  if (statusPayload.logged_in === false || statusPayload.is_logged_in === false) {
    return {
      ok: false,
      error: "xiaohongshu-mcp reports not logged in after cookie sync. Refresh cookies and retry.",
    };
  }
  return { ok: true, status: { ...statusPayload, loggedIn: loggedIn || true } };
}

export async function publishXiaohongshuMcpNote(params: {
  base: string;
  input: XiaohongshuPublishInput;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const root = mcpRoot(params.base);
  const body: Record<string, unknown> = {
    title: params.input.title,
    content: params.input.content,
  };
  if (params.input.images?.length) {
    body.images = params.input.images;
  }
  if (params.input.tags?.length) {
    body.tags = params.input.tags;
  }
  if (params.input.location) {
    body.location = params.input.location;
  }
  const response = await fetchImpl(`${root}/api/v1/publish`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response.status));
  }
  return payload;
}

export async function replyXiaohongshuMcpComment(params: {
  base: string;
  feedId: string;
  commentId?: string;
  content: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const root = mcpRoot(params.base);
  const response = await fetchImpl(`${root}/api/v1/feeds/comment/reply`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
    body: JSON.stringify({
      feed_id: params.feedId,
      comment_id: params.commentId || undefined,
      content: params.content,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response.status));
  }
  return payload;
}

export async function syncXiaohongshuMcpProfile(params: {
  base: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const root = mcpRoot(params.base);
  const meResponse = await fetchImpl(`${root}/api/v1/user/me`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
  });
  const me = await readJson(meResponse);
  if (!meResponse.ok) {
    throw new Error(extractErrorMessage(me, meResponse.status));
  }
  const fansResponse = await fetchImpl(`${root}/api/v1/analytics/fans`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
  });
  const fans = fansResponse.ok ? await readJson(fansResponse) : null;
  return { me, fans };
}

export async function publishXiaohongshuOpenbotNote(params: {
  base: string;
  token: string;
  handle: string;
  input: XiaohongshuPublishInput;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(`${params.base}/v1/notes`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
    body: JSON.stringify({
      title: params.input.title,
      content: params.input.content,
      images: params.input.images,
      tags: params.input.tags,
      accountHandle: params.handle,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response.status));
  }
  return payload;
}
