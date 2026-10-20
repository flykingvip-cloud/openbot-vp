/**
 * supervisor/execution-context.ts — per-run ExecutionContext resolver (M0.5).
 *
 * The Supervisor Engine consumes an immutable ExecutionContext and must not
 * branch on credential policy or execution placement. This module is the default
 * gateway implementation: tenant policy + resolvers → ExecutionContext.
 */

import { resolveCredentialForRun } from "../../agents/cli-backend-credential-resolve.js";
import type { OpenBotConfig } from "../../config/config.js";
import type {
  CredentialResolver,
  ExecutionContext,
  ExecutionPlacement,
  PlacementFallback,
  PlacementResolution,
  PlacementResolver,
  ResolvedIdentity,
} from "../../fabric/worker/types.js";
import { DEFAULT_AGENT_ID } from "../../routing/session-key.js";
import { resolveAgentRunEntitlementScope } from "../model-entitlement/resolve-agent-run-scope.js";
import type { ExecutionContextPort, ExecutionContextResolution } from "./engine.js";
import { createDefaultNodeAgentRegistry, type NodeAgentRegistry } from "./node-agent-registry.js";
import type { SupervisedTask } from "./types.js";
import { getWorkerExecutionProfile } from "./worker-policy-store.js";

export class EnterpriseSharedCredentialResolver implements CredentialResolver {
  constructor(private readonly cfg: OpenBotConfig) {}

  async resolve(input: {
    tenantId?: string;
    seatId?: string;
    workerId: string;
    model?: string;
    policy: "enterprise_shared" | "local_ide_login" | "seat_personal";
  }): Promise<ResolvedIdentity> {
    if (input.policy === "local_ide_login") {
      return { policy: input.policy, status: "configured" };
    }
    if (!input.tenantId) {
      return { policy: input.policy, status: "missing" };
    }
    const resolved = await resolveCredentialForRun({
      scope: { tenantId: input.tenantId, ...(input.seatId ? { subjectId: input.seatId } : {}) },
      config: this.cfg,
      backendId: input.workerId,
      ...(input.model ? { model: input.model } : {}),
      role: "worker",
    }).catch(() => undefined);
    return resolved
      ? {
          policy: input.policy,
          status: "validated",
          credentialEnv: resolved.env,
          credentialId: resolved.credentialId,
        }
      : { policy: input.policy, status: "missing" };
  }
}

export class GatewayPlacementResolver implements PlacementResolver {
  constructor(private readonly nodeAgents: NodeAgentRegistry = createDefaultNodeAgentRegistry()) {}

  async resolve(input: {
    tenantId?: string;
    seatId?: string;
    workerId: string;
    requested: ExecutionPlacement;
    fallback?: PlacementFallback;
  }): Promise<PlacementResolution> {
    if (input.requested === "gateway") {
      return { placement: "gateway", executor: "gateway", fallback: input.fallback ?? "escalate" };
    }
    const node = await this.nodeAgents.resolveNodeAgent({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.seatId ? { seatId: input.seatId } : {}),
    });
    if (node?.online) {
      if (node.supportsSupervisorWorker === false) {
        return {
          fallback: input.fallback ?? "escalate",
          reason: `Node Agent "${node.nodeAgentId}" does not support supervisor workers`,
        };
      }
      return {
        placement: "node_agent",
        executor: "node_agent",
        nodeAgentId: node.nodeAgentId,
        fallback: input.fallback ?? "escalate",
      };
    }
    if (node) {
      return {
        fallback: input.fallback ?? "escalate",
        reason: `Node Agent "${node.nodeAgentId}" is offline`,
      };
    }
    return {
      fallback: input.fallback ?? "escalate",
      reason: `Node Agent placement is not available for worker "${input.workerId}"`,
    };
  }
}

export function createGatewayExecutionContextPort(params: {
  cfg: OpenBotConfig;
  credentialResolver?: CredentialResolver;
  placementResolver?: PlacementResolver;
  nodeAgentRegistry?: NodeAgentRegistry;
}): ExecutionContextPort {
  const credentialResolver =
    params.credentialResolver ?? new EnterpriseSharedCredentialResolver(params.cfg);
  const placementResolver =
    params.placementResolver ??
    new GatewayPlacementResolver(params.nodeAgentRegistry ?? createDefaultNodeAgentRegistry());

  return {
    async resolve(task: SupervisedTask): Promise<ExecutionContextResolution> {
      const agentId = (task.agentId ?? DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
      const entitlementScope = await resolveAgentRunEntitlementScope({
        agentId,
        ...(task.tenantId?.trim() ? { tenantId: task.tenantId.trim() } : {}),
      }).catch(() => null);
      const tenantId = task.tenantId ?? entitlementScope?.tenantId;
      // Prefer task.seatId (bound seat). Do not treat userId as seatId — that
      // mis-attributes placement/credential scope to the login principal.
      const seatId =
        task.seatId?.trim() ||
        entitlementScope?.seatId?.trim() ||
        entitlementScope?.employeeId?.trim() ||
        undefined;
      const workerId = task.worker.backendId.trim();
      const model = task.worker.model?.trim() || undefined;

      const profile = await getWorkerExecutionProfile({
        ...(tenantId ? { tenantId } : {}),
        workerId,
      });
      // local_ide_login must never run on Gateway (same red line as execution-chain-gate).
      const requestedPlacement =
        profile.credentialPolicy === "local_ide_login" ? "node_agent" : profile.executionPlacement;

      const placement = await placementResolver.resolve({
        ...(tenantId ? { tenantId } : {}),
        ...(seatId ? { seatId } : {}),
        workerId,
        requested: requestedPlacement,
        fallback: "escalate",
      });
      if (!("placement" in placement)) {
        return placement;
      }

      const identity = await credentialResolver.resolve({
        ...(tenantId ? { tenantId } : {}),
        ...(seatId ? { seatId } : {}),
        workerId,
        ...(model ? { model } : {}),
        policy: profile.credentialPolicy,
      });

      return {
        identity,
        placement,
        attribution: {
          ...(tenantId ? { tenantId } : {}),
          ...(seatId ? { seatId } : {}),
          ...(task.userId ? { userId: task.userId } : {}),
          ...(identity.credentialId ? { credentialId: identity.credentialId } : {}),
          workerId,
          ...(model ? { model } : {}),
        },
      } satisfies ExecutionContext;
    },
  };
}
