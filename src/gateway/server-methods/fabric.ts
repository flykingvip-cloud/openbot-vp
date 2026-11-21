import { persistAuthorizedFabricRequest } from "../../agent-runtime/wiring/fabric-rpc-admission.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
/**
 * fabric.ts — OpenBot Fabric public API handlers (R7).
 *
 * Maps the gateway methods to the Fabric service facade:
 *  - fabric.tool.execute   → /v1/tool/execute   (full pipeline)
 *  - fabric.policy.check   → /v1/policy/check    (dry-run; returns decisionTrace)
 *  - fabric.adapter.register → /v1/adapter/register
 *  - fabric.tool.stream    → /v1/tool/stream/:executionId  (tool-events)
 *  - fabric.audit.query    → recent execution audit records (read; platform UI)
 *  - fabric.status         → control-plane enablement + audit stats (read)
 *  - fabric.feature.set    → toggle gateway.fabric.enabled (write; platform UI)
 *
 * Feature-gated (R13.1, D1): when Fabric is not enabled the methods report
 * UNAVAILABLE and nothing in the existing tool path changes. The service is
 * obtained via an injectable provider; the default is FAIL-CLOSED for exec-class
 * tools until the real enforcement-point probes / TOL runner are wired (9.2).
 *
 * Authorization is unchanged: these methods sit behind the gateway's existing
 * role/scope/domain checks (registered in method-scopes.ts at task 9.2).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.8.
 */
import { AdapterRegistry } from "../../fabric/adapter-registry.js";
import type { FabricAuditStore } from "../../fabric/audit-store.js";
import type { AuditQuery } from "../../fabric/audit.js";
import { FabricContractError, ToolRequest, parseContract } from "../../fabric/contract.js";
import { isFabricEnabled } from "../../fabric/feature.js";
import { createProbeDecideFor } from "../../fabric/probes.js";
import { createFabricService, type FabricService } from "../../fabric/service.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

let serviceProvider: (() => FabricService | null) | null = null;
let auditStoreProvider: (() => FabricAuditStore | null) | null = null;

/** Inject the Fabric service (wiring, task 9.2). Null provider ⇒ feature off. */
export function setFabricServiceProvider(provider: (() => FabricService | null) | null): void {
  serviceProvider = provider;
}

/** Inject the Fabric audit store (read side for the platform UI). */
export function setFabricAuditStoreProvider(
  provider: (() => FabricAuditStore | null) | null,
): void {
  auditStoreProvider = provider;
}

/** Resolve the currently-provided Fabric audit store (null ⇒ none wired). */
export function getFabricAuditStore(): FabricAuditStore | null {
  return auditStoreProvider ? auditStoreProvider() : null;
}

/** Resolve the currently-provided Fabric service (null ⇒ feature off). */
export function getFabricService(): FabricService | null {
  // Explicit provider (tests / real wiring) wins; otherwise env-gated default.
  if (serviceProvider) {
    return serviceProvider();
  }
  return isFabricEnabled() ? defaultService() : null;
}

/** Default service: in-process registry + REAL exec policy probes + no-op executor. */
function defaultService(): FabricService {
  return createFabricService({
    registry: new AdapterRegistry(),
    pipeline: {
      decideFor: createProbeDecideFor(),
      executeNode: async (node) => {
        const now = Date.now();
        return {
          id: node.id,
          status: "failed",
          output: { stderr: "fabric execution runner not configured" },
          timing: { start: now, end: now },
          trace: { policyDecisionId: node.id, executionId: `exec-${now}` },
        };
      },
    },
  });
}

function resolveService(respond: RespondFn): FabricService | null {
  const service = getFabricService();
  if (!service) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "fabric is not enabled"));
    return null;
  }
  return service;
}

function parseRequest(raw: unknown, respond: RespondFn): ToolRequest | null {
  try {
    return parseContract(ToolRequest, raw, "ToolRequest");
  } catch (err) {
    const message = err instanceof FabricContractError ? err.message : String(err);
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    return null;
  }
}

export const fabricHandlers: GatewayRequestHandlers = {
  "fabric.policy.check": ({ params, respond }) => {
    const service = resolveService(respond);
    if (!service) {
      return;
    }
    const request = parseRequest(params.request, respond);
    if (!request) {
      return;
    }
    const decision = service.check(request);
    respond(true, { decision, trace: request.trace });
  },

  "fabric.tool.execute": async ({ params, respond, client }) => {
    const service = resolveService(respond);
    if (!service) {
      return;
    }
    const request = parseRequest(params.request, respond);
    if (!request) {
      return;
    }
    if (request.source.tenantId) {
      const authority = await resolveAuthoritativeMembership(client);
      if (
        authority.tenantId !== request.source.tenantId ||
        (request.source.userId && authority.userId !== request.source.userId)
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "Fabric execution tenant identity is not authorized",
          ),
        );
        return;
      }
      request.source.userId = authority.userId ?? undefined;
    }
    await persistAuthorizedFabricRequest(request);
    const { result } = await service.execute(request);
    respond(true, { result, trace: request.trace });
  },

  "fabric.adapter.register": ({ params, respond }) => {
    const service = resolveService(respond);
    if (!service) {
      return;
    }
    try {
      const adapter = service.registerAdapter(params.adapter);
      respond(true, { adapter });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "fabric.tool.stream": async ({ params, client, context, respond }) => {
    const service = resolveService(respond);
    if (!service) {
      return;
    }
    const connId = client?.connId;
    if (!connId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "stream requires a connected client"),
      );
      return;
    }
    const request = parseRequest(params.request, respond);
    if (!request) {
      return;
    }
    // Reuse the tool-events transport: register this connection as a recipient
    // for the run, then push each ExecutionEvent to it (R12.2). The execution
    // id keys the run so a client can correlate the event stream to its request.
    if (request.source.tenantId) {
      const authority = await resolveAuthoritativeMembership(client);
      if (
        authority.tenantId !== request.source.tenantId ||
        (request.source.userId && authority.userId !== request.source.userId)
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Fabric stream tenant identity is not authorized"),
        );
        return;
      }
      request.source.userId = authority.userId ?? undefined;
    }
    await persistAuthorizedFabricRequest(request);
    const executionId = request.id;
    const recipients = new Set([connId]);
    context.registerToolEventRecipient(executionId, connId);
    const { result } = await service.stream(request, (event) => {
      context.broadcastToConnIds("fabric.tool.event", { executionId, event }, recipients);
    });
    respond(true, { result, executionId, trace: request.trace });
  },

  // Read-only observability for the platform admin surface. Returns recent
  // execution audit records (already redacted) + aggregate stats. When the
  // feature is off the store is absent ⇒ report empty rather than UNAVAILABLE,
  // so the platform panel can always render a (disabled/empty) state.
  "fabric.audit.query": ({ params, respond }) => {
    const store = getFabricAuditStore();
    const enabled = isFabricEnabled();
    if (!store) {
      respond(true, { enabled, records: [], stats: null });
      return;
    }
    const query: AuditQuery = {};
    if (typeof params.tenantId === "string") {
      query.tenantId = params.tenantId;
    }
    if (typeof params.sessionId === "string") {
      query.sessionId = params.sessionId;
    }
    if (typeof params.correlationId === "string") {
      query.correlationId = params.correlationId;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    respond(true, {
      enabled,
      records: store.query(query, limit),
      stats: store.stats(query),
    });
  },

  "fabric.status": ({ respond }) => {
    const store = getFabricAuditStore();
    respond(true, {
      enabled: isFabricEnabled(),
      serviceInstalled: getFabricService() !== null,
      auditRetained: store?.size() ?? 0,
      stats: store?.stats() ?? null,
    });
  },

  // Platform-level enablement toggle. Persists `gateway.fabric.enabled` to the
  // config file; writeConfigFile clears the config cache so isFabricEnabled()
  // reflects the new value live (the bootstrap-installed provider then resolves
  // a real service without a restart). WRITE-scoped (operator.write).
  "fabric.feature.set": async ({ params, respond }) => {
    const enabled = params.enabled === true;
    try {
      const cfg = loadConfig();
      const next = {
        ...cfg,
        gateway: {
          ...cfg.gateway,
          fabric: { ...cfg.gateway?.fabric, enabled },
        },
      };
      await writeConfigFile(next);
      respond(true, { enabled });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
