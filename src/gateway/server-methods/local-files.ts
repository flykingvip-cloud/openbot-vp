/**
 * `localFiles.redeem` — the gateway end of capability redemption.
 *
 * Kept thin on purpose. Every authorization check lives in
 * `redeemInvocationCapability` so the four-step transaction and its ordering exist
 * in exactly one place. What this handler adds is the part only the connection
 * knows: which node is really calling, and which device key authenticated it.
 *
 * The node id and device key are taken from the authenticated connection, never
 * from the request body. A node that submits someone else's capability is refused
 * because the capability's binding will not match this connection
 * (design 9.3, docs/design/openbot-local-disk-read-grant-2026-09-29.md).
 */

import { LOCAL_FILES_READONLY_PROFILE } from "../../local-files/types.js";
import type { LocalFilesOperation, SignedCapability } from "../../local-files/types.js";
import { LocalFileApprovalService, summarizePendingApproval } from "../local-files/approval.js";
import {
  createLocalDeviceBinding,
  revokeLocalDeviceBinding,
  summarizeBinding,
} from "../local-files/binding-admin.js";
import { getLocalFilesRuntime } from "../local-files/runtime.js";
import { ErrorCodes, errorShape, validateLocalFilesRedeemParams } from "../protocol/index.js";
import { parseGatewayRole } from "../role-policy.js";
import { respondInvalidParams } from "./nodes.helpers.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

export const handleLocalFilesRedeem: GatewayRequestHandler = ({
  params,
  respond,
  context,
  client,
}) => {
  if (!validateLocalFilesRedeemParams(params)) {
    respondInvalidParams({
      respond,
      method: "localFiles.redeem",
      validator: validateLocalFilesRedeemParams,
    });
    return;
  }
  const p = params as { capability: SignedCapability; operation: LocalFilesOperation };

  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    // Never configured: refuse rather than fall back to trusting the request.
    respond(
      false,
      { ok: false, reason: "runtime-not-configured" },
      errorShape(ErrorCodes.UNAVAILABLE, "local files runtime not configured"),
    );
    return;
  }

  // Role membership already restricts this method to nodes, but re-deriving it
  // keeps the binding explicit rather than implied by a table elsewhere.
  if (!client || parseGatewayRole(client.connect?.role) !== "node") {
    respond(
      false,
      { ok: false, reason: "not-a-node-connection" },
      errorShape(ErrorCodes.INVALID_REQUEST, "localFiles.redeem requires a node connection"),
    );
    return;
  }

  const nodeId = client.connect?.device?.id ?? client.connect?.client?.id;
  if (!nodeId) {
    respond(false, { ok: false, reason: "no-node-identity" }, undefined);
    return;
  }

  // The session must be live AND be this very socket. A stale registry entry for
  // the same node id must not authorize a different connection.
  const session = context.nodeRegistry.get(nodeId);
  const sessionIsThisConnection = Boolean(
    session && client.connId && session.connId === client.connId,
  );

  // Only a key that was verified during this handshake counts. A token-authenticated
  // connection never proved key possession and so cannot redeem.
  const devicePublicKey = client.devicePublicKey;

  const authenticated = Boolean(devicePublicKey) && sessionIsThisConnection;

  const result = runtime.service.redeem({
    capability: p.capability,
    operation: p.operation,
    connection: {
      nodeId,
      devicePublicKey: devicePublicKey ?? "",
      authenticated,
      // Taken from the live registry session, never from the request body, so a
      // node cannot describe itself more favourably than it registered.
      capabilityProfile: session?.capabilityProfile,
      declaredCommands: session?.commands ?? [],
    },
  });

  if (!result.ok) {
    // Report refusal as a successful RPC carrying a negative decision: the node
    // needs the reason to decide not to read, and this is not a transport fault.
    context.logGateway.debug(
      `localFiles.redeem refused node=${nodeId} reason=${result.reason}` +
        (result.detail ? ` detail=${result.detail}` : ""),
    );
    respond(true, { ok: false, reason: result.reason }, undefined);
    return;
  }

  respond(true, { ok: true }, undefined);
};

/**
 * `localFiles.approval.resolve` — a person answering the card.
 *
 * Allow Once covers this request. Allow Always remembers the exact resolved
 * path on the device binding. Anything else is rejected rather than widened
 * into a standing disk grant.
 */
export const handleLocalFilesApprovalResolve: GatewayRequestHandler = ({
  params,
  respond,
  client,
}) => {
  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "local files runtime not configured"),
    );
    return;
  }
  const approvals = runtime.approvals;
  if (!(approvals instanceof LocalFileApprovalService)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "local files approvals are not resolvable here"),
    );
    return;
  }

  const p = params as { id?: unknown; decision?: unknown };
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
    return;
  }
  if (p.decision !== "allow-once" && p.decision !== "allow-always" && p.decision !== "deny") {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        'decision must be "allow-once", "allow-always", or "deny"',
      ),
    );
    return;
  }

  const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
  const result = approvals.resolve({ id, decision: p.decision, resolvedBy: resolvedBy ?? null });
  if (!result.ok) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `approval not resolvable: ${result.reason}`),
    );
    return;
  }
  respond(true, { ok: true }, undefined);
};

/** `localFiles.binding.list` — operator view of who may read which device. */
export const handleLocalFilesBindingList: GatewayRequestHandler = ({ respond }) => {
  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "local files runtime not configured"),
    );
    return;
  }
  respond(true, { bindings: runtime.bindings.list().map(summarizeBinding) }, undefined);
};

/**
 * `localFiles.binding.create` — grant one device's disk to one user's digital humans.
 *
 * Note what is absent from the params: `devicePublicKey`. It is taken from the live
 * authenticated node connection, never from the request, so a grant cannot be aimed
 * at a device the operator did not actually see connect (see `binding-admin.ts`).
 */
export const handleLocalFilesBindingCreate: GatewayRequestHandler = async ({
  params,
  respond,
  context,
}) => {
  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "local files runtime not configured"),
    );
    return;
  }
  const p = params as {
    nodeId?: unknown;
    tenantId?: unknown;
    userId?: unknown;
    allowedAgentIds?: unknown;
  };
  const allowedAgentIds = Array.isArray(p.allowedAgentIds)
    ? p.allowedAgentIds.filter((entry): entry is string => typeof entry === "string")
    : [];

  const result = await createLocalDeviceBinding({
    nodeId: typeof p.nodeId === "string" ? p.nodeId : "",
    tenantId: typeof p.tenantId === "string" ? p.tenantId : "",
    userId: typeof p.userId === "string" ? p.userId : "",
    allowedAgentIds,
    bindings: runtime.bindings,
    nodes: {
      get: (nodeId) => {
        const session = context.nodeRegistry.get(nodeId);
        if (!session) {
          return undefined;
        }
        return {
          nodeId: session.nodeId,
          caps: session.caps,
          commands: session.commands,
          displayName: session.displayName,
          devicePublicKey: session.client.devicePublicKey,
        };
      },
    },
  });

  if (!result.ok) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `binding refused: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`,
      ),
    );
    return;
  }
  context.logGateway.info(
    `local files binding created node=${result.binding.nodeId} ` +
      `tenant=${result.binding.tenantId} user=${result.binding.userId} ` +
      `agents=[${result.binding.allowedAgentIds.join(",")}]`,
  );
  respond(true, { binding: summarizeBinding(result.binding) }, undefined);
};

/** `localFiles.binding.revoke` — withdraw a device's grant immediately. */
export const handleLocalFilesBindingRevoke: GatewayRequestHandler = async ({
  params,
  respond,
  context,
}) => {
  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "local files runtime not configured"),
    );
    return;
  }
  const nodeId =
    typeof (params as { nodeId?: unknown }).nodeId === "string"
      ? (params as { nodeId: string }).nodeId
      : "";
  if (!nodeId.trim()) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId is required"));
    return;
  }
  const result = await revokeLocalDeviceBinding({ nodeId, bindings: runtime.bindings });
  if (!result.ok) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `revoke refused: ${result.reason}`),
    );
    return;
  }
  context.logGateway.info(`local files binding revoked node=${nodeId}`);
  respond(true, { ok: true }, undefined);
};

/** `localFiles.approval.list` — cards currently awaiting an answer. */
export const handleLocalFilesApprovalList: GatewayRequestHandler = ({ respond }) => {
  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "local files runtime not configured"),
    );
    return;
  }
  const approvals = runtime.approvals;
  if (!(approvals instanceof LocalFileApprovalService)) {
    respond(true, { pending: [] }, undefined);
    return;
  }
  respond(true, { pending: approvals.listPending().map(summarizePendingApproval) }, undefined);
};

export const localFilesHandlers: GatewayRequestHandlers = {
  "localFiles.redeem": handleLocalFilesRedeem,
  "localFiles.approval.list": handleLocalFilesApprovalList,
  "localFiles.approval.resolve": handleLocalFilesApprovalResolve,
  "localFiles.binding.list": handleLocalFilesBindingList,
  "localFiles.binding.create": handleLocalFilesBindingCreate,
  "localFiles.binding.revoke": handleLocalFilesBindingRevoke,
};

export { LOCAL_FILES_READONLY_PROFILE };
