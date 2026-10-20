/**
 * execution-chain-gate.ts — server-side hard gate before create/start (P0-1).
 *
 * Shares B1 readiness check ids so UI CTAs and API errors point at the same gap.
 * Gateway workers are never blocked by Node placement; node_agent / local_ide_login
 * workers hard-reject when Node is offline, unbound, unsupported, or auth is not
 * ready — never silently fall back to Gateway (D-RESOLVER / plan P0-1 red line).
 *
 * Engine still consumes resolved ExecutionContext only (D-EXECCTX); this gate runs
 * at the create/start boundary, not inside the tick loop.
 */

import type { OpenBotConfig } from "../../config/config.js";
import type {
  CredentialResolver,
  PlacementResolver,
  WorkerAuthProbe,
} from "../../fabric/worker/types.js";
import {
  EnterpriseSharedCredentialResolver,
  GatewayPlacementResolver,
} from "./execution-context.js";
import { createDefaultNodeAgentRegistry, type NodeAgentRegistry } from "./node-agent-registry.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import { createGatewayWorkerAuthProbe } from "./worker-auth-probe.js";
import { getWorkerExecutionProfile } from "./worker-policy-store.js";

/** Check ids aligned with `supervisor-setup-readiness` B1 rows. */
export type ExecutionChainCheckId =
  | "supervisor-enabled"
  | "node-bound"
  | "node-online"
  | `local-ide-${string}`
  | `api-key-${string}`;

export class ExecutionChainGateError extends Error {
  readonly code = "INVALID_REQUEST" as const;
  readonly checkId: ExecutionChainCheckId;

  constructor(checkId: ExecutionChainCheckId, message: string) {
    super(message);
    this.name = "ExecutionChainGateError";
    this.checkId = checkId;
  }
}

export type AssertExecutionChainReadyInput = {
  workerBackendId: string;
  tenantId?: string;
  seatId?: string;
  userId?: string;
  model?: string;
  cfg?: OpenBotConfig;
  credentialResolver?: CredentialResolver;
  placementResolver?: PlacementResolver;
  nodeAgentRegistry?: NodeAgentRegistry;
  nodeInvoke?: NodeInvokePort;
  authProbe?: WorkerAuthProbe;
  /** Test seam: skip live auth probe and use this result instead. */
  authAuthenticated?: boolean;
};

function localIdeCheckId(workerId: string): ExecutionChainCheckId {
  return `local-ide-${workerId.trim().toLowerCase()}`;
}

function apiKeyCheckId(workerId: string): ExecutionChainCheckId {
  return `api-key-${workerId.trim().toLowerCase()}`;
}

function mapPlacementFailureToCheckId(reason: string): ExecutionChainCheckId {
  const normalized = reason.toLowerCase();
  if (
    normalized.includes("not available") ||
    normalized.includes("no binding") ||
    normalized.includes("尚未绑定") ||
    normalized.includes("seatid required") ||
    normalized.includes("refusing gateway")
  ) {
    return "node-bound";
  }
  if (normalized.includes("does not support supervisor") || normalized.includes("unsupported")) {
    return "node-online";
  }
  return "node-online";
}

/**
 * Hard-validate placement + auth for the selected worker before create/start.
 * Throws ExecutionChainGateError with a B1 checkId when the chain is not ready.
 */
export async function assertExecutionChainReady(
  input: AssertExecutionChainReadyInput,
): Promise<void> {
  const workerId = input.workerBackendId.trim();
  if (!workerId) {
    throw new ExecutionChainGateError("supervisor-enabled", "missing workerBackendId");
  }

  const cfg = input.cfg ?? ({} as OpenBotConfig);
  const credentialResolver =
    input.credentialResolver ?? new EnterpriseSharedCredentialResolver(cfg);
  const placementResolver =
    input.placementResolver ??
    new GatewayPlacementResolver(input.nodeAgentRegistry ?? createDefaultNodeAgentRegistry());

  const profile = await getWorkerExecutionProfile({
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    workerId,
  });

  // local_ide_login must never run on Gateway; treat as node_agent requirement even if
  // a tenant policy override mistakenly sets executionPlacement=gateway.
  const requiresNodeAgent =
    profile.executionPlacement === "node_agent" || profile.credentialPolicy === "local_ide_login";

  // Placement binding is seat-scoped. Do NOT substitute userId as seatId — that
  // mis-attributes runs and misses the bound Node seat.
  const seatId = input.seatId?.trim() || undefined;

  if (requiresNodeAgent && !seatId) {
    throw new ExecutionChainGateError(
      "node-bound",
      `execution chain not ready [node-bound]: seatId required for worker "${workerId}" (node_agent / local_ide_login)`,
    );
  }

  const placement = await placementResolver.resolve({
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(seatId ? { seatId } : {}),
    workerId,
    // Always request node_agent for local_ide workers so resolver cannot return gateway.
    requested: requiresNodeAgent ? "node_agent" : profile.executionPlacement,
    fallback: "escalate",
  });

  if (requiresNodeAgent) {
    if (!("placement" in placement) || placement.placement !== "node_agent") {
      if (!("placement" in placement)) {
        const checkId = mapPlacementFailureToCheckId(placement.reason ?? "");
        throw new ExecutionChainGateError(
          checkId,
          `execution chain not ready [${checkId}]: ${placement.reason ?? "Node Agent placement unavailable"}`,
        );
      }
      // HARD RED LINE: never silently fall back to Gateway for local_ide / node_agent.
      throw new ExecutionChainGateError(
        "node-bound",
        `execution chain not ready [node-bound]: worker "${workerId}" requires node_agent placement; refusing gateway fallback`,
      );
    }

    const identity = await credentialResolver.resolve({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(seatId ? { seatId } : {}),
      workerId,
      ...(input.model ? { model: input.model } : {}),
      policy: profile.credentialPolicy,
    });

    if (typeof input.authAuthenticated === "boolean") {
      if (!input.authAuthenticated) {
        const checkId = localIdeCheckId(workerId);
        throw new ExecutionChainGateError(
          checkId,
          `execution chain not ready [${checkId}]: worker "${workerId}" is not authenticated on Node`,
        );
      }
      return;
    }

    const authProbe = input.authProbe ?? createGatewayWorkerAuthProbe(cfg, input.nodeInvoke);
    const auth = await authProbe
      .probe({
        workerId,
        placement,
        identity,
      })
      .catch(() => null);

    if (auth && !auth.authenticated) {
      const checkId = localIdeCheckId(workerId);
      throw new ExecutionChainGateError(
        checkId,
        `execution chain not ready [${checkId}]: ${auth.reason ?? `worker "${workerId}" requires local IDE login`}`,
      );
    }
    return;
  }

  // Gateway workers: only credential readiness — never block on Node.
  const identity = await credentialResolver.resolve({
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(seatId ? { seatId } : {}),
    workerId,
    ...(input.model ? { model: input.model } : {}),
    policy: profile.credentialPolicy,
  });

  if (
    identity.status === "missing" ||
    identity.status === "invalid" ||
    identity.status === "expired"
  ) {
    const checkId = apiKeyCheckId(workerId);
    throw new ExecutionChainGateError(
      checkId,
      `execution chain not ready [${checkId}]: no usable credential for worker "${workerId}"`,
    );
  }
}
