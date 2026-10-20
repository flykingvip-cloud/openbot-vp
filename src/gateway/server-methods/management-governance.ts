import { getPairedDevice } from "../../infra/device-pairing.js";
import { getPairedNode } from "../../infra/node-pairing.js";
import {
  listManagementAuditEvents,
  type ManagementAuditQuery,
} from "../management-governance-audit.js";
import { auditManagementDecision } from "../management-governance-audit.js";
import { setManagementNodeOwnership } from "../management-governance-ownership.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveQueryScope } from "../scope-attribution.js";
import type { GatewayRequestHandlers } from "./types.js";

const ACTIONS = new Set(["observe", "read", "write", "invoke", "pair", "revoke", "approve"]);
const EFFECTS = new Set(["allowed", "denied"]);

function parseQuery(value: unknown): ManagementAuditQuery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const params = value as Record<string, unknown>;
  const allowed = new Set(["action", "effect", "actorId", "resourceId", "from", "to", "limit"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) {
    return null;
  }
  if (
    params.action !== undefined &&
    (typeof params.action !== "string" || !ACTIONS.has(params.action))
  ) {
    return null;
  }
  if (
    params.effect !== undefined &&
    (typeof params.effect !== "string" || !EFFECTS.has(params.effect))
  ) {
    return null;
  }
  for (const key of ["actorId", "resourceId", "from", "to"] as const) {
    if (params[key] !== undefined && typeof params[key] !== "string") {
      return null;
    }
  }
  if (
    params.limit !== undefined &&
    (!Number.isInteger(params.limit) || Number(params.limit) < 1 || Number(params.limit) > 500)
  ) {
    return null;
  }
  return params as ManagementAuditQuery;
}

export const managementGovernanceHandlers: GatewayRequestHandlers = {
  "management-governance.audit.list": async ({ params, respond, client }) => {
    const query = parseQuery(params);
    if (!query) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid management-governance.audit.list params"),
      );
      return;
    }
    const scope = await resolveQueryScope(client);
    const events = await listManagementAuditEvents({ scope, query });
    respond(true, { scope, events }, undefined);
  },
  "management-governance.node.assign": async ({ params, respond, client }) => {
    const nodeId = typeof params.nodeId === "string" ? params.nodeId.trim() : "";
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const ownerUserId = typeof params.ownerUserId === "string" ? params.ownerUserId.trim() : "";
    if (
      !nodeId ||
      !tenantId ||
      Object.keys(params).some((key) => !["nodeId", "tenantId", "ownerUserId"].includes(key))
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid node assignment"));
      return;
    }
    const scope = await resolveQueryScope(client);
    if (scope.kind !== "platform") {
      await auditManagementDecision({
        client,
        scope,
        action: "write",
        target: { kind: "device", resourceId: nodeId, tenantId },
        effect: "denied",
        reason: "platform scope required",
      });
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "platform scope required"));
      return;
    }
    const [device, node] = await Promise.all([getPairedDevice(nodeId), getPairedNode(nodeId)]);
    if (!device && !node) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"));
      return;
    }
    await setManagementNodeOwnership(nodeId, {
      tenantId,
      ...(ownerUserId ? { ownerId: ownerUserId } : {}),
    });
    await auditManagementDecision({
      client,
      scope,
      action: "write",
      target: {
        kind: "device",
        resourceId: nodeId,
        tenantId,
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      effect: "allowed",
      reason: "node ownership assigned",
    });
    respond(true, { nodeId, tenantId, ownerUserId: ownerUserId || null }, undefined);
  },
};
