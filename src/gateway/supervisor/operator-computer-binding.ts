/**
 * Resolve the computer bound to the seat the operator is actually using.
 * A node stored on a vacant or same-operator seat is copied onto that active seat.
 * Always Allow (始终授权) also stamps alwaysAllowDesktop so later Desktop-class
 * ops can skip the permission card until revoked.
 */
import { decideOperatorComputerBinding } from "../../infra/operator-local-computer.js";
import {
  createNodeSeatBindingRequest,
  listNodeSeatBindingRequests,
  resolveNodeSeatBindingRequest,
} from "./node-seat-binding-request-store.js";
import {
  getNodeSeatBinding,
  listNodeSeatBindings,
  upsertNodeSeatBinding,
} from "./node-seat-binding-store.js";

export type OperatorComputerResolveResult = {
  nodeId: string;
  /** True when the user previously chose Always Allow for this seat↔node. */
  alwaysAllowDesktop?: boolean;
};

export async function resolveOperatorComputerNode(params: {
  tenantId: string;
  activeSeatId: string;
  operatorUserId: string;
  operatorUserIdAliases?: readonly string[];
  preferredNodeIds?: readonly string[];
  agentId: string;
  operatorAgentIds: readonly string[];
  occupiedSeatIds: readonly string[];
  bindingStorePath?: string;
  requestStorePath?: string;
}): Promise<OperatorComputerResolveResult | null> {
  const tenantId = params.tenantId.trim();
  const activeSeatId = params.activeSeatId.trim();
  if (!tenantId || !activeSeatId) {
    return null;
  }
  const [bindings, approvedRequests] = await Promise.all([
    listNodeSeatBindings(tenantId, params.bindingStorePath),
    listNodeSeatBindingRequests({
      tenantId,
      status: "approved",
      storePath: params.requestStorePath,
    }),
  ]);
  const decision = decideOperatorComputerBinding({
    activeSeatId,
    operatorUserId: params.operatorUserId,
    operatorUserIdAliases: params.operatorUserIdAliases,
    preferredNodeIds: params.preferredNodeIds,
    agentId: params.agentId,
    operatorAgentIds: params.operatorAgentIds,
    occupiedSeatIds: params.occupiedSeatIds,
    bindings,
    approvedRequests,
  });
  if (!decision.permitted) {
    return null;
  }
  if (decision.alignFromSeatId) {
    const current = await getNodeSeatBinding(tenantId, activeSeatId, params.bindingStorePath);
    if (!current) {
      await upsertNodeSeatBinding(
        { tenantId, seatId: activeSeatId, nodeId: decision.nodeId },
        params.bindingStorePath,
      );
    }
  }
  const active = await getNodeSeatBinding(tenantId, activeSeatId, params.bindingStorePath);
  const alwaysAllowDesktop =
    active?.nodeId.trim() === decision.nodeId && Boolean(active?.alwaysAllowDesktop);
  return {
    nodeId: decision.nodeId,
    ...(alwaysAllowDesktop ? { alwaysAllowDesktop: true } : {}),
  };
}

/**
 * Persist Always Allow for the computer the user is actually on (the nodeId
 * from the approval card), not a stale historical device id.
 */
export async function persistOperatorComputerAlwaysAllow(params: {
  tenantId: string;
  seatId: string;
  nodeId: string;
  operatorUserId: string;
  bindingStorePath?: string;
  requestStorePath?: string;
}): Promise<OperatorComputerResolveResult> {
  const tenantId = params.tenantId.trim();
  const seatId = params.seatId.trim();
  const nodeId = params.nodeId.trim();
  const operatorUserId = params.operatorUserId.trim();
  if (!tenantId || !seatId || !nodeId || !operatorUserId) {
    throw new Error("tenantId, seatId, nodeId, and operatorUserId are required");
  }
  const binding = await upsertNodeSeatBinding(
    { tenantId, seatId, nodeId, alwaysAllowDesktop: true },
    params.bindingStorePath,
  );
  const request = await createNodeSeatBindingRequest(
    { tenantId, seatId, nodeId, userId: operatorUserId },
    params.requestStorePath,
  );
  await resolveNodeSeatBindingRequest(
    {
      requestId: request.requestId,
      decision: "approved",
      decidedBy: operatorUserId,
      reason: "allow-always-desktop",
    },
    params.requestStorePath,
  );
  return {
    nodeId: binding.nodeId,
    alwaysAllowDesktop: true,
  };
}
