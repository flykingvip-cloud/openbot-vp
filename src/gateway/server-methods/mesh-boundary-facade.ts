/**
 * mesh.operations.* / mesh.performance.* — Enterprise Mesh command surface (Phase 0 facade).
 *
 * Facades existing governance.* / mesh.governance.* handlers into the Strong Separation buckets.
 * Spec: docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md §5.2 / §7.2
 */

import { ErrorCodes, errorShape, type ErrorShape } from "../protocol/index.js";
import { agentGrowthHandlers } from "./agent-growth.js";
import { governanceHandlers } from "./governance.js";
import { meshGovernanceHandlers } from "./mesh-governance.js";
import type {
  GatewayRequestHandler,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
} from "./types.js";

async function invokeHandler(
  handlers: GatewayRequestHandlers,
  method: string,
  options: GatewayRequestHandlerOptions,
): Promise<{ ok: boolean; payload?: unknown; error?: ErrorShape }> {
  const handler = handlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `missing underlying handler: ${method}`),
    };
  }
  return await new Promise((resolve) => {
    void handler({
      ...options,
      req: { ...options.req, method },
      respond: (ok, payload, error) => {
        resolve({ ok, payload, error });
      },
    });
  });
}
export const meshBoundaryFacadeHandlers: GatewayRequestHandlers = {
  /**
   * Operations: online / anomaly-oriented asset list (enterprise-only metrics allowed).
   */
  "mesh.operations.listOnline": async (options) => {
    const result = await invokeHandler(governanceHandlers, "governance.assets.list", {
      ...options,
      params: {
        ...options.params,
        filters: {
          ...(options.params as { filters?: Record<string, unknown> } | null)?.filters,
          status: "active",
        },
      },
    });
    options.respond(result.ok, result.payload, result.error);
  },

  "mesh.operations.listAnomalies": async (options) => {
    const result = await invokeHandler(governanceHandlers, "governance.anomalies.list", options);
    options.respond(result.ok, result.payload, result.error);
  },

  /**
   * Intervene: prefer mesh.governance.executeAction (audit); falls back to governance.actions.execute.
   */
  "mesh.operations.intervene": async (options) => {
    const params = options.params ?? {};
    if (params.issueId && params.actionType && params.targetId) {
      const result = await invokeHandler(
        meshGovernanceHandlers,
        "mesh.governance.executeAction",
        options,
      );
      options.respond(result.ok, result.payload, result.error);
      return;
    }
    if (params.actionId) {
      const result = await invokeHandler(governanceHandlers, "governance.actions.execute", options);
      options.respond(result.ok, result.payload, result.error);
      return;
    }
    options.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "mesh.operations.intervene requires issueId+actionType+targetId or actionId",
      ),
    );
  },

  "mesh.performance.summary": async (options) => {
    const result = await invokeHandler(governanceHandlers, "governance.metrics.dashboard", options);
    options.respond(result.ok, result.payload, result.error);
  },

  "mesh.performance.ranking": async (options) => {
    const result = await invokeHandler(governanceHandlers, "governance.ranking.get", options);
    options.respond(result.ok, result.payload, result.error);
  },

  /** P3：机巢绩效 — 成长速度（企业统计），只读聚合。 */
  "mesh.performance.growthSummary": async (options) => {
    const result = await invokeHandler(agentGrowthHandlers, "growth.aggregate", options);
    options.respond(result.ok, result.payload, result.error);
  },

  /** P3.1：机巢绩效 — 协作组成长速度（企业统计），只读聚合。 */
  "mesh.performance.groupGrowthSummary": async (options) => {
    const result = await invokeHandler(agentGrowthHandlers, "growth.groupAggregate", options);
    options.respond(result.ok, result.payload, result.error);
  },
};
