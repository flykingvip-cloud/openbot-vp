/**
 * supervisor/worker-health.ts — aggregate read-only worker health (M0.5).
 *
 * Combines CredentialResolver + PlacementResolver + WorkerAuthProbe.
 * Exposes CredentialStatus only — never credentialEnv or secret values.
 */

import type { OpenBotConfig } from "../../config/config.js";
import type {
  CredentialPolicy,
  CredentialResolver,
  CredentialStatus,
  ExecutionPlacement,
  PlacementFallback,
  PlacementResolver,
  WorkerAuthProbe,
} from "../../fabric/worker/types.js";
import {
  EnterpriseSharedCredentialResolver,
  GatewayPlacementResolver,
} from "./execution-context.js";
import { probeLocalIdeLoginOnGateway } from "./local-ide-gateway-probe.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import { createGatewayWorkerAuthProbe } from "./worker-auth-probe.js";
import { getWorkerExecutionProfile } from "./worker-policy-store.js";
import { listSupervisorWorkers } from "./workers.js";

export type SupervisorWorkerHealthRow = {
  backendId: string;
  recommendedPolicy: CredentialPolicy;
  recommendedPlacement: ExecutionPlacement;
  identity: {
    policy: CredentialPolicy;
    status: CredentialStatus;
    credentialId?: string;
  };
  placement: {
    available: boolean;
    executor: "gateway" | "node_agent" | null;
    placement?: ExecutionPlacement;
    fallback?: PlacementFallback;
    reason?: string;
  };
  auth: {
    installed: boolean;
    authenticated: boolean;
    status: CredentialStatus;
    expiresAt?: string;
    source: "probe" | "declared";
    reason?: string;
  };
};

export async function listSupervisorWorkerHealth(input: {
  cfg?: OpenBotConfig;
  tenantId?: string;
  backendId?: string;
  seatId?: string;
  credentialResolver?: CredentialResolver;
  placementResolver?: PlacementResolver;
  authProbe?: WorkerAuthProbe;
  nodeInvoke?: NodeInvokePort;
}): Promise<SupervisorWorkerHealthRow[]> {
  const credentialResolver =
    input.credentialResolver ??
    new EnterpriseSharedCredentialResolver(input.cfg ?? ({} as OpenBotConfig));
  const placementResolver = input.placementResolver ?? new GatewayPlacementResolver();
  const authProbe =
    input.authProbe ??
    createGatewayWorkerAuthProbe(input.cfg ?? ({} as OpenBotConfig), input.nodeInvoke);

  const workers = listSupervisorWorkers(input.cfg ?? ({} as OpenBotConfig)).filter((worker) =>
    input.backendId ? worker.backendId === input.backendId.trim() : true,
  );

  const rows: SupervisorWorkerHealthRow[] = [];
  for (const worker of workers) {
    const profile = await getWorkerExecutionProfile({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      workerId: worker.backendId,
    });
    const identity = await credentialResolver.resolve({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.seatId ? { seatId: input.seatId } : {}),
      workerId: worker.backendId,
      policy: profile.credentialPolicy,
    });

    // Mirror gate / exec-context: local_ide_login always requests node_agent.
    const requestedPlacement =
      profile.credentialPolicy === "local_ide_login" ? "node_agent" : profile.executionPlacement;
    const recommendedPlacement =
      profile.credentialPolicy === "local_ide_login" ? "node_agent" : profile.executionPlacement;

    const placementResolution = await placementResolver.resolve({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.seatId ? { seatId: input.seatId } : {}),
      workerId: worker.backendId,
      requested: requestedPlacement,
      fallback: "escalate",
    });

    if (!("placement" in placementResolution)) {
      let auth: SupervisorWorkerHealthRow["auth"] = {
        installed: false,
        authenticated: false,
        status: identity.status,
        source: "declared",
        reason: placementResolution.reason,
      };
      if (profile.credentialPolicy === "local_ide_login") {
        const gatewayAuth = await probeLocalIdeLoginOnGateway(worker.backendId, input.cfg);
        if (gatewayAuth) {
          auth = gatewayAuth;
        }
      }
      rows.push({
        backendId: worker.backendId,
        recommendedPolicy: profile.credentialPolicy,
        recommendedPlacement,
        identity: {
          policy: identity.policy,
          status: identity.status,
          ...(identity.credentialId ? { credentialId: identity.credentialId } : {}),
        },
        placement: {
          available: false,
          executor: null,
          fallback: placementResolution.fallback,
          reason: placementResolution.reason,
        },
        auth,
      });
      continue;
    }

    const auth = await authProbe.probe({
      workerId: worker.backendId,
      placement: placementResolution,
      identity,
    });

    rows.push({
      backendId: worker.backendId,
      recommendedPolicy: profile.credentialPolicy,
      recommendedPlacement,
      identity: {
        policy: identity.policy,
        status: identity.status,
        ...(identity.credentialId ? { credentialId: identity.credentialId } : {}),
      },
      placement: {
        available: true,
        executor: placementResolution.executor,
        placement: placementResolution.placement,
        fallback: placementResolution.fallback,
      },
      auth,
    });
  }

  return rows;
}
