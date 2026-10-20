import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  BROWSER_PLAN_ONCE_PHASE_GATES,
  isPlanOnceProductionEnv,
  resolvePlanOncePhaseGates,
} from "../../account-computer/browser-plan-once-phase-gates.js";
import type {
  BrowserSnapshotLike,
  PlanOnceBrowserPort,
  PlanOnceWireResult,
} from "../../account-computer/browser-plan-once-wire.js";
import {
  runPlanOnceViaBrowser,
  shapeBFromToolParams,
} from "../../account-computer/browser-plan-once-wire.js";
import { browserAct, browserConsoleMessages } from "../../browser/client-actions.js";
import { browserSnapshot, browserTabs } from "../../browser/client.js";
import { DEFAULT_AI_SNAPSHOT_MAX_CHARS } from "../../browser/constants.js";
import { loadConfig } from "../../config/config.js";
import { wrapExternalContent } from "../../security/external-content.js";
import { ensureAccountBrowserCoordinator } from "../../site-capability/coordinator.js";
import { imageResultFromFile, jsonResult } from "./common.js";

type BrowserProxyRequest = (opts: {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
}) => Promise<unknown>;

function wrapBrowserExternalJson(params: {
  kind: "snapshot" | "console" | "tabs";
  payload: unknown;
  includeWarning?: boolean;
}): { wrappedText: string; safeDetails: Record<string, unknown> } {
  const extractedText = JSON.stringify(params.payload, null, 2);
  const wrappedText = wrapExternalContent(extractedText, {
    source: "browser",
    includeWarning: params.includeWarning ?? true,
  });
  return {
    wrappedText,
    safeDetails: {
      ok: true,
      externalContent: {
        untrusted: true,
        source: "browser",
        kind: params.kind,
        wrapped: true,
      },
    },
  };
}

function formatTabsToolResult(tabs: unknown[]): AgentToolResult<unknown> {
  const wrapped = wrapBrowserExternalJson({
    kind: "tabs",
    payload: { tabs },
    includeWarning: false,
  });
  const content: AgentToolResult<unknown>["content"] = [
    { type: "text", text: wrapped.wrappedText },
  ];
  return {
    content,
    details: { ...wrapped.safeDetails, tabCount: tabs.length },
  };
}

function isChromeStaleTargetError(profile: string | undefined, err: unknown): boolean {
  if (profile !== "chrome") {
    return false;
  }
  const msg = String(err);
  return msg.includes("404:") && msg.includes("tab not found");
}

function stripTargetIdFromActRequest(
  request: Parameters<typeof browserAct>[1],
): Parameters<typeof browserAct>[1] | null {
  const targetId = typeof request.targetId === "string" ? request.targetId.trim() : undefined;
  if (!targetId) {
    return null;
  }
  const retryRequest = { ...request };
  delete retryRequest.targetId;
  return retryRequest as Parameters<typeof browserAct>[1];
}

function canRetryChromeActWithoutTargetId(request: Parameters<typeof browserAct>[1]): boolean {
  const typedRequest = request as Partial<Record<"kind" | "action", unknown>>;
  const kind =
    typeof typedRequest.kind === "string"
      ? typedRequest.kind
      : typeof typedRequest.action === "string"
        ? typedRequest.action
        : "";
  return kind === "hover" || kind === "scrollIntoView" || kind === "wait";
}

export async function executeTabsAction(params: {
  baseUrl?: string;
  profile?: string;
  proxyRequest: BrowserProxyRequest | null;
}): Promise<AgentToolResult<unknown>> {
  const { baseUrl, profile, proxyRequest } = params;
  if (proxyRequest) {
    const result = await proxyRequest({
      method: "GET",
      path: "/tabs",
      profile,
    });
    const tabs = (result as { tabs?: unknown[] }).tabs ?? [];
    return formatTabsToolResult(tabs);
  }
  const tabs = await browserTabs(baseUrl, { profile });
  return formatTabsToolResult(tabs);
}

export async function executeSnapshotAction(params: {
  input: Record<string, unknown>;
  baseUrl?: string;
  profile?: string;
  proxyRequest: BrowserProxyRequest | null;
}): Promise<AgentToolResult<unknown>> {
  const { input, baseUrl, profile, proxyRequest } = params;
  const snapshotDefaults = loadConfig().browser?.snapshotDefaults;
  const format: "ai" | "aria" | undefined =
    input.snapshotFormat === "ai" || input.snapshotFormat === "aria"
      ? input.snapshotFormat
      : undefined;
  const mode: "efficient" | undefined =
    input.mode === "efficient"
      ? "efficient"
      : format !== "aria" && snapshotDefaults?.mode === "efficient"
        ? "efficient"
        : undefined;
  const labels = typeof input.labels === "boolean" ? input.labels : undefined;
  const refs: "aria" | "role" | undefined =
    input.refs === "aria" || input.refs === "role" ? input.refs : undefined;
  const hasMaxChars = Object.hasOwn(input, "maxChars");
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : undefined;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : undefined;
  const maxChars =
    typeof input.maxChars === "number" && Number.isFinite(input.maxChars) && input.maxChars > 0
      ? Math.floor(input.maxChars)
      : undefined;
  const interactive = typeof input.interactive === "boolean" ? input.interactive : undefined;
  const compact = typeof input.compact === "boolean" ? input.compact : undefined;
  const depth =
    typeof input.depth === "number" && Number.isFinite(input.depth) ? input.depth : undefined;
  const selector = typeof input.selector === "string" ? input.selector.trim() : undefined;
  const frame = typeof input.frame === "string" ? input.frame.trim() : undefined;
  const resolvedMaxChars =
    format === "ai"
      ? hasMaxChars
        ? maxChars
        : mode === "efficient"
          ? undefined
          : DEFAULT_AI_SNAPSHOT_MAX_CHARS
      : hasMaxChars
        ? maxChars
        : undefined;
  const snapshotQuery = {
    ...(format ? { format } : {}),
    targetId,
    limit,
    ...(typeof resolvedMaxChars === "number" ? { maxChars: resolvedMaxChars } : {}),
    refs,
    interactive,
    compact,
    depth,
    selector,
    frame,
    labels,
    mode,
  };
  const snapshot = proxyRequest
    ? ((await proxyRequest({
        method: "GET",
        path: "/snapshot",
        profile,
        query: snapshotQuery,
      })) as Awaited<ReturnType<typeof browserSnapshot>>)
    : await browserSnapshot(baseUrl, {
        ...snapshotQuery,
        profile,
      });
  if (snapshot.format === "ai") {
    const extractedText = snapshot.snapshot ?? "";
    const wrappedSnapshot = wrapExternalContent(extractedText, {
      source: "browser",
      includeWarning: true,
    });
    const safeDetails = {
      ok: true,
      format: snapshot.format,
      targetId: snapshot.targetId,
      url: snapshot.url,
      truncated: snapshot.truncated,
      stats: snapshot.stats,
      refs: snapshot.refs ? Object.keys(snapshot.refs).length : undefined,
      labels: snapshot.labels,
      labelsCount: snapshot.labelsCount,
      labelsSkipped: snapshot.labelsSkipped,
      imagePath: snapshot.imagePath,
      imageType: snapshot.imageType,
      externalContent: {
        untrusted: true,
        source: "browser",
        kind: "snapshot",
        format: "ai",
        wrapped: true,
      },
    };
    if (labels && snapshot.imagePath) {
      return await imageResultFromFile({
        label: "browser:snapshot",
        path: snapshot.imagePath,
        extraText: wrappedSnapshot,
        details: safeDetails,
      });
    }
    return {
      content: [{ type: "text" as const, text: wrappedSnapshot }],
      details: safeDetails,
    };
  }
  {
    const wrapped = wrapBrowserExternalJson({
      kind: "snapshot",
      payload: snapshot,
    });
    return {
      content: [{ type: "text" as const, text: wrapped.wrappedText }],
      details: {
        ...wrapped.safeDetails,
        format: "aria",
        targetId: snapshot.targetId,
        url: snapshot.url,
        nodeCount: snapshot.nodes.length,
        externalContent: {
          untrusted: true,
          source: "browser",
          kind: "snapshot",
          format: "aria",
          wrapped: true,
        },
      },
    };
  }
}

export async function executeConsoleAction(params: {
  input: Record<string, unknown>;
  baseUrl?: string;
  profile?: string;
  proxyRequest: BrowserProxyRequest | null;
}): Promise<AgentToolResult<unknown>> {
  const { input, baseUrl, profile, proxyRequest } = params;
  const level = typeof input.level === "string" ? input.level.trim() : undefined;
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : undefined;
  if (proxyRequest) {
    const result = (await proxyRequest({
      method: "GET",
      path: "/console",
      profile,
      query: {
        level,
        targetId,
      },
    })) as { ok?: boolean; targetId?: string; messages?: unknown[] };
    const wrapped = wrapBrowserExternalJson({
      kind: "console",
      payload: result,
      includeWarning: false,
    });
    return {
      content: [{ type: "text" as const, text: wrapped.wrappedText }],
      details: {
        ...wrapped.safeDetails,
        targetId: typeof result.targetId === "string" ? result.targetId : undefined,
        messageCount: Array.isArray(result.messages) ? result.messages.length : undefined,
      },
    };
  }
  const result = await browserConsoleMessages(baseUrl, { level, targetId, profile });
  const wrapped = wrapBrowserExternalJson({
    kind: "console",
    payload: result,
    includeWarning: false,
  });
  return {
    content: [{ type: "text" as const, text: wrapped.wrappedText }],
    details: {
      ...wrapped.safeDetails,
      targetId: result.targetId,
      messageCount: result.messages.length,
    },
  };
}

export async function executeActAction(params: {
  request: Parameters<typeof browserAct>[1];
  baseUrl?: string;
  profile?: string;
  proxyRequest: BrowserProxyRequest | null;
}): Promise<AgentToolResult<unknown>> {
  const { request, baseUrl, profile, proxyRequest } = params;
  try {
    const result = proxyRequest
      ? await proxyRequest({
          method: "POST",
          path: "/act",
          profile,
          body: request,
        })
      : await browserAct(baseUrl, request, {
          profile,
        });
    return jsonResult(result);
  } catch (err) {
    if (isChromeStaleTargetError(profile, err)) {
      const retryRequest = stripTargetIdFromActRequest(request);
      const tabs = proxyRequest
        ? ((
            (await proxyRequest({
              method: "GET",
              path: "/tabs",
              profile,
            })) as { tabs?: unknown[] }
          ).tabs ?? [])
        : await browserTabs(baseUrl, { profile }).catch(() => []);
      // Some Chrome relay targetIds can go stale between snapshots and actions.
      // Only retry safe read-only actions, and only when exactly one tab remains attached.
      if (retryRequest && canRetryChromeActWithoutTargetId(request) && tabs.length === 1) {
        try {
          const retryResult = proxyRequest
            ? await proxyRequest({
                method: "POST",
                path: "/act",
                profile,
                body: retryRequest,
              })
            : await browserAct(baseUrl, retryRequest, {
                profile,
              });
          return jsonResult(retryResult);
        } catch {
          // Fall through to explicit stale-target guidance.
        }
      }
      if (!tabs.length) {
        throw new Error(
          "No Chrome tabs are attached via the OpenBot Browser Relay extension. Click the toolbar icon on the tab you want to control (badge ON), then retry.",
          { cause: err },
        );
      }
      throw new Error(
        `Chrome tab not found (stale targetId?). Run action=tabs profile="chrome" and use one of the returned targetIds.`,
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Shape B plan-once against the existing shared browser (/snapshot + /act).
 * Returns allowsChatFinal / pause so M2 can forbid premature chat.final.
 */
export async function executePlanOnceAction(params: {
  input: Record<string, unknown>;
  baseUrl?: string;
  profile?: string;
  proxyRequest: BrowserProxyRequest | null;
  /** Account Computer / gateway production path — require phase gates. */
  accountComputer?: boolean;
  agentSessionKey?: string;
  /** Server-derived account browser scope. Never taken from model tool args. */
  accountBrowserScopeKey?: string;
}): Promise<AgentToolResult<unknown>> {
  const { input, baseUrl, profile, proxyRequest } = params;
  const plan = shapeBFromToolParams(input);
  if (!plan) {
    throw new Error(
      'plan_once requires steps[] (Shape B). Example: action="plan_once", steps=[{action:"click",target:"加入购物车"}]',
    );
  }

  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : undefined;
  const runId = typeof input.runId === "string" ? input.runId.trim() : undefined;

  const port: PlanOnceBrowserPort = {
    snapshot: async (opts) => {
      const format = opts?.format ?? "aria";
      if (proxyRequest) {
        const result = (await proxyRequest({
          method: "GET",
          path: "/snapshot",
          profile,
          query: {
            format,
            targetId: opts?.targetId ?? targetId,
            interactive: opts?.interactive ?? true,
            refs: opts?.refs,
          },
        })) as BrowserSnapshotLike;
        return result;
      }
      const snap = await browserSnapshot(baseUrl, {
        format,
        targetId: opts?.targetId ?? targetId,
        interactive: opts?.interactive ?? true,
        refs: opts?.refs,
        profile,
      });
      return snap as BrowserSnapshotLike;
    },
    act: async (body) => {
      if (proxyRequest) {
        return await proxyRequest({
          method: "POST",
          path: "/act",
          profile,
          body,
        });
      }
      return await browserAct(baseUrl, body as Parameters<typeof browserAct>[1], { profile });
    },
  };

  // Browser-tool path always requires phases (fail closed). Vitest fixtures must
  // pass sessionPhase+ownershipPhase (or register setPlanOncePhaseProvider).
  // allowMissingPhaseGates is intentionally NOT on the public tool schema.
  const requirePhases = true;
  const resolved = resolvePlanOncePhaseGates({
    explicit: {
      sessionPhase: typeof input.sessionPhase === "string" ? input.sessionPhase : undefined,
      ownershipPhase: typeof input.ownershipPhase === "string" ? input.ownershipPhase : undefined,
      humanTakeover: input.humanTakeover === true,
    },
    agentSessionKey: params.agentSessionKey,
    requirePhases,
  });

  if (params.accountBrowserScopeKey?.trim()) {
    ensureAccountBrowserCoordinator();
  }

  const result: PlanOnceWireResult = await runPlanOnceViaBrowser(plan, port, {
    targetId,
    runId,
    snapshotFormat: "aria",
    requirePhases,
    agentSessionKey: params.agentSessionKey,
    resolvedGate: resolved,
    gate: {
      sessionPhase: resolved.sessionPhase,
      ownershipPhase: resolved.ownershipPhase,
      humanTakeover: resolved.humanTakeover === true,
    },
    accountBrowserScopeKey: params.accountBrowserScopeKey,
  });

  // M2 hard mapping surface for chat / executor: only DONE may finalize.
  return jsonResult({
    ok: true,
    planOnce: true,
    landing: result.landing,
    phaseGatesLanding: result.phaseGatesLanding ?? BROWSER_PLAN_ONCE_PHASE_GATES,
    status: result.status,
    reason: result.reason,
    allowsChatFinal: result.allowsChatFinal,
    chatFinalAllowed: result.chatFinalAllowed,
    // Explicit M2 forbid flag for NEEDS_*, BLOCKED, FAIL, REPLAN.
    forbidChatFinal: !result.chatFinalAllowed,
    pause: result.pause,
    needsFrontierReplan: result.needsFrontierReplan,
    stepsCompleted: result.stepsCompleted,
    progress: result.progress,
    runId: result.runId,
    modelObserveWrapped: result.modelObserveWrapped === true,
    phaseGates: {
      source: resolved.source,
      injected: resolved.injected,
      omittedBeforeInject: resolved.omittedBeforeInject,
      missingRequired: resolved.missingRequired,
      sessionPhase: resolved.sessionPhase ?? null,
      ownershipPhase: resolved.ownershipPhase ?? null,
      productionEnv: isPlanOnceProductionEnv(),
      accountComputer: params.accountComputer === true,
    },
  });
}
