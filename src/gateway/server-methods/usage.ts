import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
} from "../../config/sessions/paths.js";
import { isSessionStoreRecord } from "../../config/sessions/store.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { loadProviderUsageSummary } from "../../infra/provider-usage.js";
import type {
  CostUsageSummary,
  SessionDailyModelUsage,
  SessionMessageCounts,
  SessionModelUsage,
} from "../../infra/session-cost-usage.js";
import {
  loadCostUsageSummary,
  loadSessionCostSummary,
  loadSessionUsageTimeSeries,
  discoverAllSessions,
  type DiscoveredSession,
} from "../../infra/session-cost-usage.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import {
  buildUsageAggregateTail,
  mergeUsageDailyLatency,
  mergeUsageLatency,
} from "../../shared/usage-aggregates.js";
import type {
  SessionUsageEntry,
  SessionsUsageAggregates,
  SessionsUsageResult,
} from "../../shared/usage-types.js";
import {
  buildEmployeeSessionVisibilityContext,
  isSessionVisibleToEmployeeActor,
  type EmployeeSessionVisibilityContext,
} from "../employee-workbench-scope.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSessionsUsageParams,
} from "../protocol/index.js";
import {
  listAgentsForGateway,
  loadCombinedSessionStoreForGateway,
  loadSessionEntry,
} from "../session-utils.js";
import { buildSessionStorePathResolver } from "../tenant-context.js";
import { enterpriseUsageHandlers } from "./enterprise-usage.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const COST_USAGE_CACHE_TTL_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type DateRange = { startMs: number; endMs: number };
type DateInterpretation =
  | { mode: "utc" | "gateway" }
  | { mode: "specific"; utcOffsetMinutes: number };

type CostUsageCacheEntry = {
  summary?: CostUsageSummary;
  updatedAt?: number;
  inFlight?: Promise<CostUsageSummary>;
};

const costUsageCache = new Map<string, CostUsageCacheEntry>();

function resolveSessionUsageFileOrRespond(
  key: string,
  respond: RespondFn,
  resolveAgentStorePath?: (agentId: string) => string,
): {
  config: ReturnType<typeof loadConfig>;
  entry: SessionEntry | undefined;
  agentId: string | undefined;
  sessionId: string;
  sessionFile: string;
} | null {
  const config = loadConfig();
  const { entry, storePath } = loadSessionEntry(key, { resolveAgentStorePath });

  // For discovered sessions (not in store), try using key as sessionId directly
  const parsed = parseAgentSessionKey(key);
  const agentId = parsed?.agentId;
  const rawSessionId = parsed?.rest ?? key;
  const sessionId = entry?.sessionId ?? rawSessionId;
  let sessionFile: string;
  try {
    const pathOpts = resolveSessionFilePathOptions({ storePath, agentId });
    sessionFile = resolveSessionFilePath(sessionId, entry, pathOpts);
  } catch {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `Invalid session key: ${key}`),
    );
    return null;
  }

  return { config, entry, agentId, sessionId, sessionFile };
}

/**
 * Personal-workbench usage detail RPCs must authorize the key before opening any
 * session store / transcript path (P0: do not open out-of-scope stores).
 */
async function authorizePersonalWorkbenchUsageKeyAccess(params: {
  client: Parameters<typeof buildEmployeeSessionVisibilityContext>[0]["client"];
  key: string;
  logGateway?: { warn?: (message: string) => void };
  respond: RespondFn;
}): Promise<{ resolveAgentStorePath: (agentId: string) => string } | null> {
  const config = loadConfig();
  const personalWorkbench =
    params.client?.sessionDomain === "employee" || params.client?.sessionDomain === "enterprise";
  if (personalWorkbench) {
    const visibility = await buildEmployeeSessionVisibilityContext({
      client: params.client,
      logGateway: params.logGateway,
    });
    if (!visibility) {
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Unable to resolve employee session scope for usage", {
          retryable: true,
        }),
      );
      return null;
    }
    if (!isSessionVisibleToEmployeeActor({ key: params.key }, visibility)) {
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "you do not have permission to access this session"),
      );
      return null;
    }
  }
  try {
    const resolveAgentStorePath = await buildSessionStorePathResolver(
      params.client ?? null,
      config,
    );
    return { resolveAgentStorePath };
  } catch (err) {
    if (personalWorkbench) {
      params.logGateway?.warn?.(`usage detail store unavailable: ${String(err)}`);
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Unable to read employee session scope for usage", {
          retryable: true,
        }),
      );
      return null;
    }
    throw err;
  }
}

const parseDateParts = (
  raw: unknown,
): { year: number; monthIndex: number; day: number } | undefined => {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return undefined;
  }
  return { year, monthIndex, day };
};

/**
 * Parse a UTC offset string in the format UTC+H, UTC-H, UTC+HH, UTC-HH, UTC+H:MM, UTC-HH:MM.
 * Returns the UTC offset in minutes (east-positive), or undefined if invalid.
 */
const parseUtcOffsetToMinutes = (raw: unknown): number | undefined => {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const match = /^UTC([+-])(\d{1,2})(?::([0-5]\d))?$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return undefined;
  }
  if (hours > 14 || (hours === 14 && minutes !== 0)) {
    return undefined;
  }
  const totalMinutes = sign * (hours * 60 + minutes);
  if (totalMinutes < -12 * 60 || totalMinutes > 14 * 60) {
    return undefined;
  }
  return totalMinutes;
};

const resolveDateInterpretation = (params: {
  mode?: unknown;
  utcOffset?: unknown;
}): DateInterpretation => {
  if (params.mode === "gateway") {
    return { mode: "gateway" };
  }
  if (params.mode === "specific") {
    const utcOffsetMinutes = parseUtcOffsetToMinutes(params.utcOffset);
    if (utcOffsetMinutes !== undefined) {
      return { mode: "specific", utcOffsetMinutes };
    }
  }
  // Backward compatibility: when mode is missing (or invalid), keep current UTC interpretation.
  return { mode: "utc" };
};

/**
 * Parse a date string (YYYY-MM-DD) to start-of-day timestamp based on interpretation mode.
 * Returns undefined if invalid.
 */
const parseDateToMs = (
  raw: unknown,
  interpretation: DateInterpretation = { mode: "utc" },
): number | undefined => {
  const parts = parseDateParts(raw);
  if (!parts) {
    return undefined;
  }
  const { year, monthIndex, day } = parts;
  if (interpretation.mode === "gateway") {
    const ms = new Date(year, monthIndex, day).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (interpretation.mode === "specific") {
    const ms = Date.UTC(year, monthIndex, day) - interpretation.utcOffsetMinutes * 60 * 1000;
    return Number.isNaN(ms) ? undefined : ms;
  }
  const ms = Date.UTC(year, monthIndex, day);
  return Number.isNaN(ms) ? undefined : ms;
};

const getTodayStartMs = (now: Date, interpretation: DateInterpretation): number => {
  if (interpretation.mode === "gateway") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (interpretation.mode === "specific") {
    const shifted = new Date(now.getTime() + interpretation.utcOffsetMinutes * 60 * 1000);
    return (
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      interpretation.utcOffsetMinutes * 60 * 1000
    );
  }
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const parseDays = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return undefined;
};

/**
 * Get date range from params (startDate/endDate or days).
 * Falls back to last 30 days if not provided.
 */
const parseDateRange = (params: {
  startDate?: unknown;
  endDate?: unknown;
  days?: unknown;
  mode?: unknown;
  utcOffset?: unknown;
}): DateRange => {
  const now = new Date();
  const interpretation = resolveDateInterpretation(params);
  const todayStartMs = getTodayStartMs(now, interpretation);
  const todayEndMs = todayStartMs + DAY_MS - 1;

  const startMs = parseDateToMs(params.startDate, interpretation);
  const endMs = parseDateToMs(params.endDate, interpretation);

  if (startMs !== undefined && endMs !== undefined) {
    // endMs should be end of day
    return { startMs, endMs: endMs + DAY_MS - 1 };
  }

  const days = parseDays(params.days);
  if (days !== undefined) {
    const clampedDays = Math.max(1, days);
    const start = todayStartMs - (clampedDays - 1) * DAY_MS;
    return { startMs: start, endMs: todayEndMs };
  }

  // Default to last 30 days
  const defaultStartMs = todayStartMs - 29 * DAY_MS;
  return { startMs: defaultStartMs, endMs: todayEndMs };
};

type DiscoveredSessionWithAgent = DiscoveredSession & { agentId: string };

function buildStoreBySessionId(
  store: Record<string, SessionEntry>,
): Map<string, { key: string; entry: SessionEntry }> {
  const storeBySessionId = new Map<string, { key: string; entry: SessionEntry }>();
  for (const [key, entry] of Object.entries(store)) {
    if (entry?.sessionId) {
      storeBySessionId.set(entry.sessionId, { key, entry });
    }
  }
  return storeBySessionId;
}

function isStoreEntryVisibleToEmployee(params: {
  key: string;
  entry: SessionEntry | undefined;
  visibility: EmployeeSessionVisibilityContext | null;
}): boolean {
  if (!params.visibility) {
    return true;
  }
  if (!params.entry) {
    // Discovered-only transcripts cannot be safely attributed to an employee.
    return false;
  }
  return isSessionVisibleToEmployeeActor(
    {
      key: params.key,
      groupId: params.entry.groupId,
      chatType: params.entry.chatType,
    },
    params.visibility,
  );
}

/**
 * Employee usage must never certify totals it could not actually read. A truly
 * absent store is an empty scope; unreadable or corrupt stores fail closed.
 */
function assertEmployeeStoreReadable(storePath: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new Error(`unable to read employee session store: ${storePath}`, { cause: err });
  }
  if (!raw.trim()) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid employee session store JSON: ${storePath}`, { cause: err });
  }
  // Valid JSON is not sufficient: `loadSessionStore` silently discards a
  // null/array/scalar (any non-record) and proceeds with an empty store, which
  // would let a corrupt store certify a confident "zero usage". Fail closed on a
  // store whose top-level shape is not a session-key record.
  if (!isSessionStoreRecord(parsed)) {
    throw new Error(`invalid employee session store shape: ${storePath}`);
  }
}

function loadEmployeeVisibleSessionStore(params: {
  config: ReturnType<typeof loadConfig>;
  visibleAgentIds: ReadonlySet<string>;
  resolveAgentStorePath: (agentId: string) => string;
}): {
  storePath: string;
  store: Record<string, SessionEntry>;
  storePathByAgentId: Map<string, string>;
} {
  const combined: Record<string, SessionEntry> = {};
  const storePathByAgentId = new Map<string, string>();
  for (const rawAgentId of params.visibleAgentIds) {
    const agentId = rawAgentId.trim().toLowerCase();
    if (!agentId) {
      continue;
    }
    const agentStorePath = params.resolveAgentStorePath(agentId);
    assertEmployeeStoreReadable(agentStorePath);
    storePathByAgentId.set(agentId, agentStorePath);
    const configuredAgent = params.config.agents?.list?.find(
      (agent) => agent.id.trim().toLowerCase() === agentId,
    );
    const scopedConfig: ReturnType<typeof loadConfig> = {
      ...params.config,
      session: { ...params.config.session, store: agentStorePath },
      agents: {
        ...params.config.agents,
        list: [{ ...configuredAgent, id: agentId, default: true }],
      },
    };
    const { store } = loadCombinedSessionStoreForGateway(scopedConfig, {
      resolveAgentStorePath: () => agentStorePath,
    });
    for (const [key, entry] of Object.entries(store)) {
      const keyAgentId = parseAgentSessionKey(key)?.agentId.trim().toLowerCase();
      if (keyAgentId !== agentId) {
        continue;
      }
      const existing = combined[key];
      if (!existing || (entry.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
        combined[key] = entry;
      }
    }
  }
  return { storePath: "(multiple)", store: combined, storePathByAgentId };
}

async function discoverAllSessionsForUsage(params: {
  config: ReturnType<typeof loadConfig>;
  startMs: number;
  endMs: number;
}): Promise<DiscoveredSessionWithAgent[]> {
  const agents = listAgentsForGateway(params.config).agents;
  const results = await Promise.all(
    agents.map(async (agent) => {
      const sessions = await discoverAllSessions({
        agentId: agent.id,
        startMs: params.startMs,
        endMs: params.endMs,
      });
      return sessions.map((session) => ({ ...session, agentId: agent.id }));
    }),
  );
  return results.flat().toSorted((a, b) => b.mtime - a.mtime);
}

/** Tenant-safe session discovery against an explicit sessions directory. */
async function discoverSessionsInExplicitDir(params: {
  sessionsDir: string;
  startMs?: number;
  endMs?: number;
}): Promise<DiscoveredSession[]> {
  const sessionsDir = path.resolve(params.sessionsDir);
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const discovered: DiscoveredSession[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const sessionFile = path.join(sessionsDir, entry.name);
    const stats = await fs.promises.stat(sessionFile).catch(() => null);
    if (!stats) {
      continue;
    }
    if (params.startMs && stats.mtimeMs < params.startMs) {
      continue;
    }
    discovered.push({
      sessionId: entry.name.slice(0, -6),
      sessionFile,
      mtime: stats.mtimeMs,
    });
  }
  return discovered.toSorted((a, b) => b.mtime - a.mtime);
}

async function loadCostUsageSummaryCached(params: {
  startMs: number;
  endMs: number;
  config: ReturnType<typeof loadConfig>;
}): Promise<CostUsageSummary> {
  const cacheKey = `${params.startMs}-${params.endMs}`;
  const now = Date.now();
  const cached = costUsageCache.get(cacheKey);
  if (cached?.summary && cached.updatedAt && now - cached.updatedAt < COST_USAGE_CACHE_TTL_MS) {
    return cached.summary;
  }

  if (cached?.inFlight) {
    if (cached.summary) {
      return cached.summary;
    }
    return await cached.inFlight;
  }

  const entry: CostUsageCacheEntry = cached ?? {};
  const inFlight = loadCostUsageSummary({
    startMs: params.startMs,
    endMs: params.endMs,
    config: params.config,
  })
    .then((summary) => {
      costUsageCache.set(cacheKey, { summary, updatedAt: Date.now() });
      return summary;
    })
    .catch((err) => {
      if (entry.summary) {
        return entry.summary;
      }
      throw err;
    })
    .finally(() => {
      const current = costUsageCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        current.inFlight = undefined;
        costUsageCache.set(cacheKey, current);
      }
    });

  entry.inFlight = inFlight;
  costUsageCache.set(cacheKey, entry);

  if (entry.summary) {
    return entry.summary;
  }
  return await inFlight;
}

// Exposed for unit tests (kept as a single export to avoid widening the public API surface).
export const __test = {
  parseDateParts,
  parseUtcOffsetToMinutes,
  resolveDateInterpretation,
  parseDateToMs,
  getTodayStartMs,
  parseDays,
  parseDateRange,
  discoverAllSessionsForUsage,
  loadCostUsageSummaryCached,
  costUsageCache,
};

export type { SessionUsageEntry, SessionsUsageAggregates, SessionsUsageResult };

export const usageHandlers: GatewayRequestHandlers = {
  ...enterpriseUsageHandlers,
  "usage.status": async ({ respond }) => {
    const summary = await loadProviderUsageSummary();
    respond(true, summary, undefined);
  },
  "usage.cost": async ({ respond, params }) => {
    const config = loadConfig();
    const { startMs, endMs } = parseDateRange({
      startDate: params?.startDate,
      endDate: params?.endDate,
      days: params?.days,
      mode: params?.mode,
      utcOffset: params?.utcOffset,
    });
    const summary = await loadCostUsageSummaryCached({ startMs, endMs, config });
    respond(true, summary, undefined);
  },
  "sessions.usage": async ({ respond, params, client, context }) => {
    if (!validateSessionsUsageParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.usage params: ${formatValidationErrors(validateSessionsUsageParams.errors)}`,
        ),
      );
      return;
    }

    const p = params;
    let employeeVisibility: EmployeeSessionVisibilityContext | null = null;
    let enterpriseTenantUsage: { tenantId: string; visibleAgentIds: Set<string> } | null = null;
    // Default is personal/self (employee-visible). Tenant-wide usage is opt-in for
    // 机巢 / mesh — enterprise-admin personal "AI 模型" must not inherit that path,
    // or the UI rejects scope !== "employee-visible" and shows 用量暂不可用.
    const wantsTenantScope = p?.scope === "tenant";
    if (wantsTenantScope && client?.sessionDomain === "enterprise") {
      // Enterprise mesh / cost views need tenant-wide usage with transcript discovery
      // (aligned with enterprise.organization.monthly-seat-usage). Do not reuse the
      // employee store-only visibility path — that yields $0 costs when stores are sparse.
      const { resolveEnterpriseTenantIdForClient, resolveEnterpriseTenantVisibleAgentIds } =
        await import("../enterprise-tenant-roster-scope.js");
      const tenantId = await resolveEnterpriseTenantIdForClient(client);
      const visibleAgentIds = await resolveEnterpriseTenantVisibleAgentIds(client);
      if (!tenantId || !visibleAgentIds) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "Unable to resolve enterprise tenant scope for usage",
            { retryable: true },
          ),
        );
        return;
      }
      enterpriseTenantUsage = { tenantId, visibleAgentIds };
    } else if (client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise") {
      employeeVisibility = await buildEmployeeSessionVisibilityContext({
        client,
        logGateway: context.logGateway,
      });
      if (!employeeVisibility) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Unable to resolve employee session scope for usage", {
            retryable: true,
          }),
        );
        return;
      }
    }

    const config = loadConfig();
    const { startMs, endMs } = parseDateRange({
      startDate: p.startDate,
      endDate: p.endDate,
      mode: p.mode,
      utcOffset: p.utcOffset,
    });
    const limit = typeof p.limit === "number" && Number.isFinite(p.limit) ? p.limit : 50;
    const aggregateAll = p.aggregateAll ?? false;
    const includeContextWeight = p.includeContextWeight ?? false;
    const specificKey = typeof p.key === "string" ? p.key.trim() : null;
    const specificAgentId = specificKey
      ? parseAgentSessionKey(specificKey)?.agentId.trim().toLowerCase()
      : undefined;
    const foreignSpecificAgent = Boolean(
      (employeeVisibility &&
        specificAgentId &&
        !employeeVisibility.visibleAgentIds.has(specificAgentId)) ||
      (enterpriseTenantUsage &&
        specificAgentId &&
        !enterpriseTenantUsage.visibleAgentIds.has(specificAgentId)),
    );
    const configuredStore = config.session?.store?.trim();
    if (
      employeeVisibility &&
      !foreignSpecificAgent &&
      configuredStore &&
      !configuredStore.includes("{agentId}") &&
      !isSharedTenantAddressingEnabled(config)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Employee usage requires agent-scoped session stores", {
          retryable: true,
        }),
      );
      return;
    }

    // A foreign agent-prefixed key is hidden before tenant path resolution or
    // any session-store read. Other employee requests open visible stores only.
    let sessionStore: {
      storePath: string;
      store: Record<string, SessionEntry>;
      storePathByAgentId?: Map<string, string>;
    };
    try {
      if (foreignSpecificAgent) {
        sessionStore = { storePath: "(multiple)", store: {} };
      } else {
        const resolveAgentStorePath = await buildSessionStorePathResolver(client, config);
        sessionStore = employeeVisibility
          ? loadEmployeeVisibleSessionStore({
              config,
              visibleAgentIds: employeeVisibility.visibleAgentIds,
              resolveAgentStorePath,
            })
          : enterpriseTenantUsage
            ? loadEmployeeVisibleSessionStore({
                config,
                visibleAgentIds: enterpriseTenantUsage.visibleAgentIds,
                resolveAgentStorePath,
              })
            : loadCombinedSessionStoreForGateway(config, { resolveAgentStorePath });
      }
    } catch (err) {
      if (!employeeVisibility) {
        throw err;
      }
      context.logGateway?.warn?.(`employee usage store unavailable: ${String(err)}`);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Unable to read employee session scope for usage", {
          retryable: true,
        }),
      );
      return;
    }
    const { storePath, store } = sessionStore;
    const now = Date.now();

    // Merge discovered sessions with store entries
    type MergedEntry = {
      key: string;
      sessionId: string;
      sessionFile: string;
      label?: string;
      updatedAt: number;
      storeEntry?: SessionEntry;
      firstUserMessage?: string;
    };

    const mergedEntries: MergedEntry[] = [];
    // Set when an authorized row could not be fully accounted for (unresolvable
    // path, missing/anomalous transcript, or a partially unreadable transcript).
    // Such a scope must never be certified `aggregatesComplete`.
    let scopeIncomplete = false;

    // Optimization: If a specific key is requested, skip full directory scan
    if (specificKey) {
      const parsed = parseAgentSessionKey(specificKey);
      const agentIdFromKey = parsed?.agentId;
      const keyRest = parsed?.rest ?? specificKey;

      // Prefer the store entry when available, even if the caller provides a discovered key
      // (`agent:<id>:<sessionId>`) for a session that now has a canonical store key.
      const storeBySessionId = buildStoreBySessionId(store);

      const storeMatch = store[specificKey]
        ? { key: specificKey, entry: store[specificKey] }
        : null;
      const storeByIdMatch = storeBySessionId.get(keyRest) ?? null;
      const resolvedStoreKey = storeMatch?.key ?? storeByIdMatch?.key ?? specificKey;
      const storeEntry = storeMatch?.entry ?? storeByIdMatch?.entry;
      const sessionId = storeEntry?.sessionId ?? keyRest;

      if (
        isStoreEntryVisibleToEmployee({
          key: resolvedStoreKey,
          entry: storeEntry,
          visibility: employeeVisibility,
        })
      ) {
        // Pin the transcript root to the same tenant-scoped store the employee
        // list view uses. A "(multiple)" employee store must NOT fall back to the
        // global agent transcript dir (which could read another root's transcript
        // for the same sessionId), so mirror the list branch by resolving the
        // agent's tenant store path from storePathByAgentId.
        const specificStoreAgentId =
          parseAgentSessionKey(resolvedStoreKey)?.agentId?.trim().toLowerCase() ??
          agentIdFromKey?.trim().toLowerCase();
        const specificAgentStorePath =
          employeeVisibility && specificStoreAgentId
            ? sessionStore.storePathByAgentId?.get(specificStoreAgentId)
            : undefined;
        // Resolve paths only after the object-level authorization check so an
        // invisible key cannot leak transcript existence through errors/timing.
        let sessionFile: string;
        try {
          const pathOpts = resolveSessionFilePathOptions({
            storePath:
              specificAgentStorePath ?? (storePath !== "(multiple)" ? storePath : undefined),
            agentId: agentIdFromKey,
          });
          sessionFile = resolveSessionFilePath(sessionId, storeEntry, pathOpts);
        } catch {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `Invalid session reference: ${specificKey}`),
          );
          return;
        }

        try {
          const stats = fs.statSync(sessionFile);
          if (stats.isFile()) {
            mergedEntries.push({
              key: resolvedStoreKey,
              sessionId,
              sessionFile,
              label: storeEntry?.label,
              updatedAt: storeEntry?.updatedAt ?? stats.mtimeMs,
              storeEntry,
            });
          }
        } catch (err) {
          // ENOENT = genuinely absent transcript (no results for this key). Any
          // other error (EACCES/EIO/EMFILE/…) on an authorized object must fail
          // closed in the employee scope rather than be reported as an empty
          // success. The gateway (non-employee) view keeps the lenient behavior.
          if ((err as NodeJS.ErrnoException).code !== "ENOENT" && employeeVisibility) {
            context.logGateway?.warn?.(`employee usage transcript unreadable: ${String(err)}`);
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.UNAVAILABLE,
                "Unable to read employee session scope for usage",
                { retryable: true },
              ),
            );
            return;
          }
        }
      }
    } else if (enterpriseTenantUsage) {
      // Discover transcripts for every tenant-visible agent (not store-only).
      const { listTenantAgentSessionsDirs } = await import("../tenant-store-paths.js");
      const storeBySessionId = buildStoreBySessionId(store);
      const agentIds = [...enterpriseTenantUsage.visibleAgentIds];
      const useTenantDirs = isSharedTenantAddressingEnabled(config);
      const discoveredBatches = await Promise.all(
        agentIds.map(async (agentId) => {
          const sessionsDirs = useTenantDirs
            ? await listTenantAgentSessionsDirs({
                tenantId: enterpriseTenantUsage.tenantId,
                agentId,
              })
            : [undefined];
          const rows: Array<{
            agentId: string;
            sessionId: string;
            sessionFile: string;
            mtime: number;
          }> = [];
          for (const sessionsDir of sessionsDirs) {
            const sessions = sessionsDir
              ? await discoverSessionsInExplicitDir({
                  sessionsDir,
                  startMs,
                  endMs,
                })
              : await discoverAllSessions({
                  agentId,
                  startMs,
                  endMs,
                });
            for (const session of sessions) {
              rows.push({
                agentId,
                sessionId: session.sessionId,
                sessionFile: session.sessionFile,
                mtime: session.mtime,
              });
            }
          }
          return rows;
        }),
      );
      for (const session of discoveredBatches.flat()) {
        const storeMatch = storeBySessionId.get(session.sessionId);
        if (storeMatch) {
          mergedEntries.push({
            key: storeMatch.key,
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
            label: storeMatch.entry.label,
            updatedAt: storeMatch.entry.updatedAt ?? session.mtime,
            storeEntry: storeMatch.entry,
          });
        } else {
          mergedEntries.push({
            key: `agent:${session.agentId}:${session.sessionId}`,
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
            label: undefined,
            updatedAt: session.mtime,
          });
        }
      }
    } else if (employeeVisibility) {
      // Employee list view is driven by authorized store rows only: no transcript
      // directory is scanned, so hidden or unattributable transcripts are never
      // opened. Any unreadable transcript fails the request closed.
      try {
        for (const [key, entry] of Object.entries(store)) {
          if (
            !isStoreEntryVisibleToEmployee({
              key,
              entry,
              visibility: employeeVisibility,
            })
          ) {
            continue;
          }
          const agentId = parseAgentSessionKey(key)?.agentId;
          const sessionId = entry.sessionId?.trim();
          if (!sessionId) {
            continue;
          }
          const agentStorePath = agentId
            ? sessionStore.storePathByAgentId?.get(agentId.trim().toLowerCase())
            : undefined;
          // An unlocatable/unreadable transcript only threatens completeness when
          // the store itself claims activity inside the requested window. Rows the
          // store already places before `startMs` are out of scope, so pruned or
          // rotated history must not permanently mark the scope incomplete. A row
          // with no `updatedAt` is treated as in-window (fail closed).
          const claimsActivityInWindow = (entry.updatedAt ?? Number.POSITIVE_INFINITY) >= startMs;
          let sessionFile: string;
          try {
            sessionFile = resolveSessionFilePath(
              sessionId,
              entry,
              resolveSessionFilePathOptions({ storePath: agentStorePath, agentId }),
            );
          } catch {
            // Stale/invalid stored reference: the authorized row cannot be
            // located, so an in-window aggregate can no longer be certified.
            if (claimsActivityInWindow) {
              scopeIncomplete = true;
            }
            continue;
          }
          let stats: fs.Stats;
          try {
            stats = fs.statSync(sessionFile);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              // Authorized row whose transcript is missing: in-window usage cannot
              // be verified as truly zero, so the scope is not complete.
              if (claimsActivityInWindow) {
                scopeIncomplete = true;
              }
              continue;
            }
            throw new Error(`unable to read employee transcript: ${sessionFile}`, { cause: err });
          }
          if (!stats.isFile()) {
            // Path resolves to a non-file: anomalous, cannot account for the row.
            if (claimsActivityInWindow) {
              scopeIncomplete = true;
            }
            continue;
          }
          if (stats.mtimeMs < startMs) {
            // Outside the requested window: a legitimate scope filter, not an
            // integrity gap — does not affect completeness.
            continue;
          }
          mergedEntries.push({
            key,
            sessionId,
            sessionFile,
            label: entry.label,
            updatedAt: entry.updatedAt ?? stats.mtimeMs,
            storeEntry: entry,
          });
        }
      } catch (err) {
        context.logGateway?.warn?.(`employee usage transcripts unavailable: ${String(err)}`);
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Unable to read employee session scope for usage", {
            retryable: true,
          }),
        );
        return;
      }
    } else {
      // Full discovery for the gateway list view (legacy behavior).
      const discoveredSessions = await discoverAllSessionsForUsage({
        config,
        startMs,
        endMs,
      });

      // Build a map of sessionId -> store entry for quick lookup
      const storeBySessionId = buildStoreBySessionId(store);

      for (const discovered of discoveredSessions) {
        const storeMatch = storeBySessionId.get(discovered.sessionId);
        if (storeMatch) {
          mergedEntries.push({
            key: storeMatch.key,
            sessionId: discovered.sessionId,
            sessionFile: discovered.sessionFile,
            label: storeMatch.entry.label,
            updatedAt: storeMatch.entry.updatedAt ?? discovered.mtime,
            storeEntry: storeMatch.entry,
          });
        } else {
          // Gateway-scoped callers retain discovered-only sessions; the employee
          // branch above never admits them (no canonical ownership row).
          mergedEntries.push({
            key: `agent:${discovered.agentId}:${discovered.sessionId}`,
            sessionId: discovered.sessionId,
            sessionFile: discovered.sessionFile,
            label: undefined,
            updatedAt: discovered.mtime,
          });
        }
      }
    }

    // Sort by most recent first
    mergedEntries.sort((a, b) => b.updatedAt - a.updatedAt);

    // `limit` controls detail rows only when aggregateAll is requested.
    const limitedEntries = mergedEntries.slice(0, limit);
    const aggregateEntries = aggregateAll ? mergedEntries : limitedEntries;

    // Load usage for each session
    const sessions: SessionUsageEntry[] = [];
    let successfulSummaryCount = 0;
    const aggregateTotals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    };
    const aggregateMessages: SessionMessageCounts = {
      total: 0,
      user: 0,
      assistant: 0,
      toolCalls: 0,
      toolResults: 0,
      errors: 0,
    };
    const toolAggregateMap = new Map<string, number>();
    const byModelMap = new Map<string, SessionModelUsage>();
    const byProviderMap = new Map<string, SessionModelUsage>();
    const byAgentMap = new Map<string, CostUsageSummary["totals"]>();
    const byChannelMap = new Map<string, CostUsageSummary["totals"]>();
    const dailyAggregateMap = new Map<
      string,
      {
        date: string;
        tokens: number;
        cost: number;
        messages: number;
        toolCalls: number;
        errors: number;
      }
    >();
    const latencyTotals = {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
      p95Max: 0,
    };
    const dailyLatencyMap = new Map<
      string,
      { date: string; count: number; sum: number; min: number; max: number; p95Max: number }
    >();
    const modelDailyMap = new Map<string, SessionDailyModelUsage>();

    const emptyTotals = (): CostUsageSummary["totals"] => ({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    });
    const mergeTotals = (
      target: CostUsageSummary["totals"],
      source: CostUsageSummary["totals"],
    ) => {
      target.input += source.input;
      target.output += source.output;
      target.cacheRead += source.cacheRead;
      target.cacheWrite += source.cacheWrite;
      target.totalTokens += source.totalTokens;
      target.totalCost += source.totalCost;
      target.inputCost += source.inputCost;
      target.outputCost += source.outputCost;
      target.cacheReadCost += source.cacheReadCost;
      target.cacheWriteCost += source.cacheWriteCost;
      target.missingCostEntries += source.missingCostEntries;
    };

    for (const [index, merged] of aggregateEntries.entries()) {
      const agentId = parseAgentSessionKey(merged.key)?.agentId;
      const usage = await loadSessionCostSummary({
        sessionId: merged.sessionId,
        sessionEntry: merged.storeEntry,
        sessionFile: merged.sessionFile,
        config,
        agentId,
        startMs,
        endMs,
      });

      if (usage) {
        if ((usage.parseErrors ?? 0) > 0) {
          // Transcript was partially unreadable (malformed JSONL). Keep the
          // recovered totals for visibility but never certify the aggregate as
          // complete off a corrupt transcript.
          scopeIncomplete = true;
        }
        successfulSummaryCount += 1;
        aggregateTotals.input += usage.input;
        aggregateTotals.output += usage.output;
        aggregateTotals.cacheRead += usage.cacheRead;
        aggregateTotals.cacheWrite += usage.cacheWrite;
        aggregateTotals.totalTokens += usage.totalTokens;
        aggregateTotals.totalCost += usage.totalCost;
        aggregateTotals.inputCost += usage.inputCost;
        aggregateTotals.outputCost += usage.outputCost;
        aggregateTotals.cacheReadCost += usage.cacheReadCost;
        aggregateTotals.cacheWriteCost += usage.cacheWriteCost;
        aggregateTotals.missingCostEntries += usage.missingCostEntries;
      }

      const channel = merged.storeEntry?.channel ?? merged.storeEntry?.origin?.provider;
      const chatType = merged.storeEntry?.chatType ?? merged.storeEntry?.origin?.chatType;

      if (usage) {
        if (usage.messageCounts) {
          aggregateMessages.total += usage.messageCounts.total;
          aggregateMessages.user += usage.messageCounts.user;
          aggregateMessages.assistant += usage.messageCounts.assistant;
          aggregateMessages.toolCalls += usage.messageCounts.toolCalls;
          aggregateMessages.toolResults += usage.messageCounts.toolResults;
          aggregateMessages.errors += usage.messageCounts.errors;
        }

        if (usage.toolUsage) {
          for (const tool of usage.toolUsage.tools) {
            toolAggregateMap.set(tool.name, (toolAggregateMap.get(tool.name) ?? 0) + tool.count);
          }
        }

        if (usage.modelUsage) {
          for (const entry of usage.modelUsage) {
            const modelKey = `${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
            const modelExisting =
              byModelMap.get(modelKey) ??
              ({
                provider: entry.provider,
                model: entry.model,
                count: 0,
                totals: emptyTotals(),
              } as SessionModelUsage);
            modelExisting.count += entry.count;
            mergeTotals(modelExisting.totals, entry.totals);
            byModelMap.set(modelKey, modelExisting);

            const providerKey = entry.provider ?? "unknown";
            const providerExisting =
              byProviderMap.get(providerKey) ??
              ({
                provider: entry.provider,
                model: undefined,
                count: 0,
                totals: emptyTotals(),
              } as SessionModelUsage);
            providerExisting.count += entry.count;
            mergeTotals(providerExisting.totals, entry.totals);
            byProviderMap.set(providerKey, providerExisting);
          }
        }

        mergeUsageLatency(latencyTotals, usage.latency);
        mergeUsageDailyLatency(dailyLatencyMap, usage.dailyLatency);

        if (usage.dailyModelUsage) {
          for (const entry of usage.dailyModelUsage) {
            const key = `${entry.date}::${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
            const existing =
              modelDailyMap.get(key) ??
              ({
                date: entry.date,
                provider: entry.provider,
                model: entry.model,
                tokens: 0,
                cost: 0,
                count: 0,
              } as SessionDailyModelUsage);
            existing.tokens += entry.tokens;
            existing.cost += entry.cost;
            existing.count += entry.count;
            modelDailyMap.set(key, existing);
          }
        }

        if (agentId) {
          const agentTotals = byAgentMap.get(agentId) ?? emptyTotals();
          mergeTotals(agentTotals, usage);
          byAgentMap.set(agentId, agentTotals);
        }

        if (channel) {
          const channelTotals = byChannelMap.get(channel) ?? emptyTotals();
          mergeTotals(channelTotals, usage);
          byChannelMap.set(channel, channelTotals);
        }

        if (usage.dailyBreakdown) {
          for (const day of usage.dailyBreakdown) {
            const daily = dailyAggregateMap.get(day.date) ?? {
              date: day.date,
              tokens: 0,
              cost: 0,
              messages: 0,
              toolCalls: 0,
              errors: 0,
            };
            daily.tokens += day.tokens;
            daily.cost += day.cost;
            dailyAggregateMap.set(day.date, daily);
          }
        }

        if (usage.dailyMessageCounts) {
          for (const day of usage.dailyMessageCounts) {
            const daily = dailyAggregateMap.get(day.date) ?? {
              date: day.date,
              tokens: 0,
              cost: 0,
              messages: 0,
              toolCalls: 0,
              errors: 0,
            };
            daily.messages += day.total;
            daily.toolCalls += day.toolCalls;
            daily.errors += day.errors;
            dailyAggregateMap.set(day.date, daily);
          }
        }
      }

      if (index < limitedEntries.length) {
        sessions.push({
          key: merged.key,
          label: merged.label,
          sessionId: merged.sessionId,
          updatedAt: merged.updatedAt,
          agentId,
          channel,
          chatType,
          origin: merged.storeEntry?.origin,
          modelProvider: merged.storeEntry?.modelProvider,
          model: merged.storeEntry?.model,
          usage,
          contextWeight: includeContextWeight
            ? (merged.storeEntry?.systemPromptReport ?? null)
            : undefined,
        });
      }
    }

    // Format dates back to YYYY-MM-DD strings
    const formatDateStr = (ms: number) => {
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    const tail = buildUsageAggregateTail({
      byChannelMap: byChannelMap,
      latencyTotals,
      dailyLatencyMap,
      modelDailyMap,
      dailyMap: dailyAggregateMap,
    });

    const aggregates: SessionsUsageAggregates = {
      messages: aggregateMessages,
      tools: {
        totalCalls: Array.from(toolAggregateMap.values()).reduce((sum, count) => sum + count, 0),
        uniqueTools: toolAggregateMap.size,
        tools: Array.from(toolAggregateMap.entries())
          .map(([name, count]) => ({ name, count }))
          .toSorted((a, b) => b.count - a.count),
      },
      byModel: Array.from(byModelMap.values()).toSorted((a, b) => {
        const costDiff = b.totals.totalCost - a.totals.totalCost;
        if (costDiff !== 0) {
          return costDiff;
        }
        return b.totals.totalTokens - a.totals.totalTokens;
      }),
      byProvider: Array.from(byProviderMap.values()).toSorted((a, b) => {
        const costDiff = b.totals.totalCost - a.totals.totalCost;
        if (costDiff !== 0) {
          return costDiff;
        }
        return b.totals.totalTokens - a.totals.totalTokens;
      }),
      byAgent: Array.from(byAgentMap.entries())
        .map(([id, totals]) => ({ agentId: id, totals }))
        .toSorted((a, b) => b.totals.totalCost - a.totals.totalCost),
      ...tail,
    };

    const result: SessionsUsageResult = {
      updatedAt: now,
      startDate: formatDateStr(startMs),
      endDate: formatDateStr(endMs),
      sessions,
      totals: aggregateTotals,
      aggregates,
      // "enterprise-tenant" is emitted for mesh/tenant scope; widen locally until
      // SessionsUsageScope lands with the shared usage-types update.
      scope: (employeeVisibility
        ? "employee-visible"
        : enterpriseTenantUsage
          ? "enterprise-tenant"
          : "gateway") as SessionsUsageResult["scope"],
      aggregatesComplete:
        aggregateEntries.length === mergedEntries.length &&
        successfulSummaryCount === aggregateEntries.length &&
        !scopeIncomplete,
      totalSessions: mergedEntries.length,
    };

    respond(true, result, undefined);
  },
  "sessions.usage.timeseries": async ({ respond, params, client, context }) => {
    const key = typeof params?.key === "string" ? params.key.trim() : null;
    if (!key) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "key is required for timeseries"),
      );
      return;
    }

    const authorized = await authorizePersonalWorkbenchUsageKeyAccess({
      client,
      key,
      logGateway: context.logGateway,
      respond,
    });
    if (!authorized) {
      return;
    }
    const resolved = resolveSessionUsageFileOrRespond(
      key,
      respond,
      authorized.resolveAgentStorePath,
    );
    if (!resolved) {
      return;
    }
    const { config: sessionConfig, entry, agentId, sessionId, sessionFile } = resolved;

    const timeseries = await loadSessionUsageTimeSeries({
      sessionId,
      sessionEntry: entry,
      sessionFile,
      config: sessionConfig,
      agentId,
      maxPoints: 200,
    });

    if (!timeseries) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No transcript found for session: ${key}`),
      );
      return;
    }

    respond(true, timeseries, undefined);
  },
  "sessions.usage.logs": async ({ respond, params, client, context }) => {
    const key = typeof params?.key === "string" ? params.key.trim() : null;
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key is required for logs"));
      return;
    }

    const limit =
      typeof params?.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(params.limit, 1000)
        : 200;

    const authorized = await authorizePersonalWorkbenchUsageKeyAccess({
      client,
      key,
      logGateway: context.logGateway,
      respond,
    });
    if (!authorized) {
      return;
    }
    const resolved = resolveSessionUsageFileOrRespond(
      key,
      respond,
      authorized.resolveAgentStorePath,
    );
    if (!resolved) {
      return;
    }
    const { config: sessionConfig, entry, agentId, sessionId, sessionFile } = resolved;

    const { loadSessionLogs } = await import("../../infra/session-cost-usage.js");
    const logs = await loadSessionLogs({
      sessionId,
      sessionEntry: entry,
      sessionFile,
      config: sessionConfig,
      agentId,
      limit,
    });

    respond(true, { logs: logs ?? [] }, undefined);
  },
};
