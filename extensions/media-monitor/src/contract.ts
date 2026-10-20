import type {
  AdapterCommentItem,
  AdapterContentItem,
  AdapterEnvelope,
  AdapterErrorCategory,
  AdapterErrorEnvelope,
  AdapterSuccessEnvelope,
  CrawlMode,
  MonitorPlatform,
} from "./types.js";

export const ADAPTER_SCHEMA_VERSION = 1 as const;

export function buildCrawlArgv(params: {
  platform: MonitorPlatform;
  accountId: string;
  accountUrl?: string;
  mode: CrawlMode;
  contentId?: string;
  output?: "jsonl";
}): string[] {
  const argv = [
    "crawl",
    "--platform",
    params.platform,
    "--account-id",
    params.accountId,
    "--mode",
    params.mode,
    "--output",
    params.output ?? "jsonl",
  ];
  if (params.accountUrl?.trim()) {
    argv.push("--account-url", params.accountUrl.trim());
  }
  if (params.contentId?.trim()) {
    argv.push("--content-id", params.contentId.trim());
  }
  return argv;
}

export function isAdapterErrorEnvelope(value: unknown): value is AdapterErrorEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const root = value as Record<string, unknown>;
  if (root.schema_version !== 1) {
    return false;
  }
  const err = root.error;
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as Record<string, unknown>;
  return typeof e.category === "string" && typeof e.message === "string";
}

export function isAdapterSuccessEnvelope(value: unknown): value is AdapterSuccessEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const root = value as Record<string, unknown>;
  if (root.schema_version !== 1) {
    return false;
  }
  if (root.error) {
    return false;
  }
  if (typeof root.platform !== "string") {
    return false;
  }
  if (!root.target || typeof root.target !== "object") {
    return false;
  }
  if (!root.run || typeof root.run !== "object") {
    return false;
  }
  if (!Array.isArray(root.items)) {
    return false;
  }
  return true;
}

function parseMaybeJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Parse adapter stdout. Protocol: JSONL preferred (one envelope object),
 * or a single JSON object. Never treat stderr/log text as business protocol.
 */
export function parseAdapterStdout(stdout: string): AdapterEnvelope {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("adapter produced empty stdout");
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Prefer the last valid envelope line (JSONL).
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseMaybeJson(lines[i]!);
    if (isAdapterErrorEnvelope(parsed) || isAdapterSuccessEnvelope(parsed)) {
      return normalizeEnvelope(parsed);
    }
  }

  const whole = parseMaybeJson(trimmed);
  if (isAdapterErrorEnvelope(whole) || isAdapterSuccessEnvelope(whole)) {
    return normalizeEnvelope(whole);
  }

  throw new Error("adapter stdout is not a valid schema_version=1 envelope");
}

function normalizeEnvelope(envelope: AdapterEnvelope): AdapterEnvelope {
  if (isAdapterErrorEnvelope(envelope)) {
    return {
      schema_version: 1,
      error: {
        category: normalizeErrorCategory(envelope.error.category),
        retryable: Boolean(envelope.error.retryable),
        provider_code:
          typeof envelope.error.provider_code === "string"
            ? envelope.error.provider_code
            : undefined,
        message: String(envelope.error.message ?? "unknown error").slice(0, 500),
      },
    };
  }

  const items: Array<AdapterContentItem | AdapterCommentItem> = [];
  for (const raw of envelope.items) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const platformId = typeof item.platform_id === "string" ? item.platform_id.trim() : "";
    if (!platformId) {
      continue;
    }
    if (item.type === "comment") {
      const parent =
        typeof item.parent_platform_id === "string" ? item.parent_platform_id.trim() : "";
      if (!parent) {
        continue;
      }
      items.push({
        type: "comment",
        platform_id: platformId,
        parent_platform_id: parent,
        url: typeof item.url === "string" ? item.url : undefined,
        text: typeof item.text === "string" ? item.text.slice(0, 4000) : undefined,
        published_at: typeof item.published_at === "string" ? item.published_at : undefined,
        author_name:
          typeof item.author_name === "string" ? item.author_name.slice(0, 200) : undefined,
        content_hash: typeof item.content_hash === "string" ? item.content_hash : undefined,
      });
      continue;
    }
    if (item.type === "content") {
      items.push({
        type: "content",
        platform_id: platformId,
        url: typeof item.url === "string" ? item.url : undefined,
        title: typeof item.title === "string" ? item.title.slice(0, 500) : undefined,
        text: typeof item.text === "string" ? item.text.slice(0, 4000) : undefined,
        published_at: typeof item.published_at === "string" ? item.published_at : undefined,
        content_hash: typeof item.content_hash === "string" ? item.content_hash : undefined,
      });
    }
  }

  return {
    schema_version: 1,
    platform: envelope.platform === "xhs" ? "xhs" : "xhs",
    target: {
      account_id: String((envelope.target as { account_id?: unknown }).account_id ?? "").trim(),
      url:
        typeof (envelope.target as { url?: unknown }).url === "string"
          ? (envelope.target as { url: string }).url
          : undefined,
    },
    run: {
      id: String((envelope.run as { id?: unknown }).id ?? "unknown"),
      started_at: String((envelope.run as { started_at?: unknown }).started_at ?? ""),
      finished_at: String((envelope.run as { finished_at?: unknown }).finished_at ?? ""),
      mode: (envelope.run as { mode?: unknown }).mode === "comments" ? "comments" : "creator",
    },
    items,
    health: {
      state:
        envelope.health?.state === "rate_limited" ||
        envelope.health?.state === "reauth_required" ||
        envelope.health?.state === "failed" ||
        envelope.health?.state === "degraded"
          ? envelope.health.state
          : "ok",
    },
  };
}

export function normalizeErrorCategory(raw: string): AdapterErrorCategory {
  switch (raw) {
    case "rate_limit":
    case "reauth_required":
    case "captcha":
    case "timeout":
    case "process_error":
    case "invalid_output":
      return raw;
    default:
      return "unknown";
  }
}

export function buildDedupeKey(params: {
  platform: MonitorPlatform;
  targetId: string;
  eventType: string;
  platformObjectId: string;
}): string {
  return [params.platform, params.targetId, params.eventType, params.platformObjectId].join(":");
}
