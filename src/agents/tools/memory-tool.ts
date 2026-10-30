import { Type } from "@sinclair/typebox";
import type { OpenBotConfig } from "../../config/config.js";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import { resolveEmployeeWorkbenchActor } from "../../gateway/employee-workbench-scope.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { resolveMemoryBackendConfig } from "../../memory/backend-config.js";
import {
  classifyMemoryEmbeddingError,
  memoryEmbeddingUnavailableCopy,
} from "../../memory/embedding-error.js";
import {
  buildMemorySearchGovernanceFromCallEntry,
  getMemorySearchManager,
  type MemorySearchGovernance,
} from "../../memory/index.js";
import {
  assertMemoryContinuityPathAccess,
  filterMemorySearchResultsForAuthz,
  resolveMemoryContinuityAuthz,
} from "../../memory/memory-continuity-authz.js";
import type { MemoryIndexAccessContext } from "../../memory/memory-index-access-context.js";
import type { MemorySearchResult } from "../../memory/types.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { asToolParams, jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

function resolveMemoryToolContext(options: { config?: OpenBotConfig; agentSessionKey?: string }) {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return { cfg, agentId };
}

async function resolveMemoryToolGovernance(options: {
  governance?: MemorySearchGovernance;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
}): Promise<MemorySearchGovernance | undefined> {
  if (options.governance) {
    return options.governance;
  }
  const client = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: options.gatewayClientUser,
    gatewayClientSessionDomain: options.gatewayClientSessionDomain,
  });
  if (!client) {
    return undefined;
  }
  const actor = await resolveEmployeeWorkbenchActor(client).catch(() => null);
  if (!actor?.tenantId) {
    return undefined;
  }
  return buildMemorySearchGovernanceFromCallEntry({
    tenantId: actor.tenantId,
    userId: actor.userId,
    seatId: actor.currentSeatId,
  });
}

function resolveToolContinuityProfile(options: {
  accessContext?: MemoryIndexAccessContext;
  /** Trusted security mode from call entry when full accessContext is unavailable. */
  securityProfile?: "personal_local" | "managed_enterprise";
}): "personal_local" | "managed_enterprise" {
  if (options.accessContext?.securityProfile === "managed_enterprise") {
    return "managed_enterprise";
  }
  if (options.securityProfile === "managed_enterprise") {
    return "managed_enterprise";
  }
  return "personal_local";
}

export function createMemorySearchTool(options: {
  config?: OpenBotConfig;
  agentSessionKey?: string;
  /** Trusted governance from authenticated call entry. */
  governance?: MemorySearchGovernance;
  /** Authenticated human for members.json checks (personal_local / explicit). */
  authenticatedUserId?: string | null;
  /**
   * Trusted security mode from call entry (Item7 Stage C). Required for managed;
   * must not be inferred from tenant presence alone. Absent → personal_local.
   */
  accessContext?: MemoryIndexAccessContext;
  /** Trusted security mode when full accessContext is not built (builtin path). */
  securityProfile?: "personal_local" | "managed_enterprise";
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: search workspace memory, session memory, and runtime memory before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(asToolParams(params), "query", { required: true });
      const maxResults = readNumberParam(asToolParams(params), "maxResults");
      const minScore = readNumberParam(asToolParams(params), "minScore");
      const governance = await resolveMemoryToolGovernance(options);
      const continuityProfile = resolveToolContinuityProfile(options);
      const continuityAuthz = await resolveMemoryContinuityAuthz({
        cfg,
        governance,
        authenticatedUserId: options.authenticatedUserId,
        profile: continuityProfile,
      });
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
        governance,
        authenticatedUserId: options.authenticatedUserId,
        accessContext: options.accessContext,
        continuityAuthz,
      });
      if (!manager) {
        return jsonResult(buildMemorySearchUnavailableResult(error));
      }
      try {
        const citationsMode = resolveMemoryCitationsMode(cfg);
        const includeCitations = shouldIncludeCitations({
          mode: citationsMode,
          sessionKey: options.agentSessionKey,
        });
        const searched = await manager.search(query, {
          maxResults,
          minScore,
          sessionKey: options.agentSessionKey,
        });
        // Defense-in-depth: drop unauthorized collab hits (no snippet rewrite).
        const rawResults = filterMemorySearchResultsForAuthz({
          results: searched,
          authz: continuityAuthz,
        });
        const status = manager.status();
        const decorated = decorateCitations(rawResults, includeCitations);
        const resolved = resolveMemoryBackendConfig({ cfg, agentId });
        const results =
          status.backend === "qmd"
            ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
            : decorated;
        const custom = status.custom as
          | {
              searchMode?: string;
              degraded?: boolean;
              degradeReason?: string;
              degradeRetryable?: boolean;
              degradeError?: string;
            }
          | undefined;
        const recall = summarizeMemorySearchResults(results);
        return jsonResult({
          results,
          ...(recall ? { recall } : {}),
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
          citations: citationsMode,
          mode: custom?.searchMode,
          ...(custom?.degraded
            ? {
                degraded: true,
                reason: custom.degradeReason,
                retryable: custom.degradeRetryable,
                warning:
                  "Memory search degraded to keyword-only results because query embedding failed.",
                error: custom.degradeError,
              }
            : {}),
        });
      } catch (err) {
        return jsonResult(buildMemorySearchUnavailableResult(err));
      }
    },
  };
}

export function createMemoryGetTool(options: {
  config?: OpenBotConfig;
  agentSessionKey?: string;
  governance?: MemorySearchGovernance;
  authenticatedUserId?: string | null;
  /** Trusted security mode from call entry; absent → personal_local. */
  accessContext?: MemoryIndexAccessContext;
  securityProfile?: "personal_local" | "managed_enterprise";
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from workspace memory or runtime-backed memory with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(asToolParams(params), "path", { required: true });
      const from = readNumberParam(asToolParams(params), "from", { integer: true });
      const lines = readNumberParam(asToolParams(params), "lines", { integer: true });
      const governance = await resolveMemoryToolGovernance(options);
      const continuityProfile = resolveToolContinuityProfile(options);
      const continuityAuthz = await resolveMemoryContinuityAuthz({
        cfg,
        governance,
        authenticatedUserId: options.authenticatedUserId,
        profile: continuityProfile,
      });
      const access = await assertMemoryContinuityPathAccess({
        relPath,
        authz: continuityAuthz,
        cfg,
      });
      if (!access.ok) {
        // Fail closed: no body/snippet leak on deny.
        return jsonResult({
          path: relPath,
          text: "",
          disabled: true,
          error: access.reason,
          reasonCode: access.reasonCode,
        });
      }
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
        governance,
        authenticatedUserId: options.authenticatedUserId,
        accessContext: options.accessContext,
        continuityAuthz,
      });
      if (!manager) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      try {
        const result = await manager.readFile({
          relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, text: "", disabled: true, error: message });
      }
    },
  };
}

function resolveMemoryCitationsMode(cfg: OpenBotConfig): MemoryCitationsMode {
  const mode = cfg.memory?.citations;
  if (mode === "on" || mode === "off" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function decorateCitations(results: MemorySearchResult[], include: boolean): MemorySearchResult[] {
  if (!include) {
    return results.map((entry) => ({ ...entry, citation: undefined }));
  }
  return results.map((entry) => {
    const citation = formatCitation(entry);
    const snippet = `${entry.snippet.trim()}\n\nSource: ${citation}`;
    return { ...entry, citation, snippet };
  });
}

function formatCitation(entry: MemorySearchResult): string {
  const lineRange =
    entry.startLine === entry.endLine
      ? `#L${entry.startLine}`
      : `#L${entry.startLine}-L${entry.endLine}`;
  return `${entry.path}${lineRange}`;
}

function clampResultsByInjectedChars(
  results: MemorySearchResult[],
  budget?: number,
): MemorySearchResult[] {
  if (!budget || budget <= 0) {
    return results;
  }
  let remaining = budget;
  const clamped: MemorySearchResult[] = [];
  for (const entry of results) {
    if (remaining <= 0) {
      break;
    }
    const snippet = entry.snippet ?? "";
    if (snippet.length <= remaining) {
      clamped.push(entry);
      remaining -= snippet.length;
    } else {
      const trimmed = snippet.slice(0, Math.max(0, remaining));
      clamped.push({ ...entry, snippet: trimmed });
      break;
    }
  }
  return clamped;
}

function summarizeMemorySearchResults(results: MemorySearchResult[]) {
  const explainability = results
    .map((entry) => entry.explainability)
    .find((entry): entry is NonNullable<MemorySearchResult["explainability"]> => Boolean(entry));
  const evidence = results
    .flatMap((entry) =>
      (entry.evidence ?? []).map((item) => ({
        path: entry.path,
        uri: item.uri,
        snippet: item.snippet,
        trustScore: item.trustScore,
      })),
    )
    .filter(
      (item, index, list) =>
        list.findIndex(
          (candidate) =>
            candidate.path === item.path &&
            candidate.uri === item.uri &&
            candidate.snippet === item.snippet,
        ) === index,
    )
    .slice(0, 5);
  if (!explainability && evidence.length === 0) {
    return undefined;
  }
  return {
    whySummary: explainability?.whySummary,
    matchedPatterns: explainability?.matchedPatterns ?? [],
    supportingAtoms: explainability?.supportingAtoms ?? [],
    pathSummaries: explainability?.pathSummaries ?? [],
    evidence,
  };
}

function buildMemorySearchUnavailableResult(error: unknown) {
  const classification = classifyMemoryEmbeddingError(error ?? "memory search unavailable");
  const copy = memoryEmbeddingUnavailableCopy(classification.reason);
  return {
    results: [],
    disabled: true,
    unavailable: true,
    reason: classification.reason,
    retryable: classification.retryable,
    degraded: false,
    error: classification.message || "memory search unavailable",
    warning: copy.warning,
    action: copy.action,
  };
}

function shouldIncludeCitations(params: {
  mode: MemoryCitationsMode;
  sessionKey?: string;
}): boolean {
  if (params.mode === "on") {
    return true;
  }
  if (params.mode === "off") {
    return false;
  }
  // auto: show citations in direct chats; suppress in groups/channels by default.
  const chatType = deriveChatTypeFromSessionKey(params.sessionKey);
  return chatType === "direct";
}

function deriveChatTypeFromSessionKey(sessionKey?: string): "direct" | "group" | "channel" {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed?.rest) {
    return "direct";
  }
  const tokens = new Set(parsed.rest.toLowerCase().split(":").filter(Boolean));
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("group")) {
    return "group";
  }
  return "direct";
}
