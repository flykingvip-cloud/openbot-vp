import { normalizeDevicePublicKeyBase64Url } from "../../infra/device-identity.js";
import {
  approveDevicePairing,
  getPairedDevice,
  listDevicePairing,
  removePairedDevice,
  requestDevicePairing,
  type DeviceAuthToken,
  type PairedDevice,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
  summarizeDeviceTokens,
  updatePairedDeviceMetadata,
} from "../../infra/device-pairing.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDevicePairApproveParams,
  validateDevicePairListParams,
  validateDevicePairRemoveParams,
  validateDevicePairRejectParams,
  validateDeviceTokenRevokeParams,
  validateDeviceTokenRotateParams,
} from "../protocol/index.js";
import { resolveTrustedAttribution } from "../scope-attribution.js";
import type { GatewayClient, RespondFn, GatewayRequestHandlers } from "./types.js";

/**
 * Device attribution (ops-decommission task 2.7): devices are platform-governed
 * + employee-self-managed. Only the employee (self) scope is restricted; platform
 * (and enterprise) sessions retain full governance visibility.
 *
 * Returns the owner id to restrict to when the caller is an employee session, or
 * null when no restriction applies (platform governance).
 */
async function resolveDeviceSelfOwner(client: GatewayClient | null): Promise<string | null> {
  if (client?.sessionDomain !== "employee") {
    return null;
  }
  const attribution = await resolveTrustedAttribution(client);
  return attribution.ownerId ?? null;
}

function isBrowserPairedDevice(
  device: Pick<PairedDevice, "clientId" | "clientMode" | "deviceFamily">,
): boolean {
  const clientId = (device.clientId ?? "").toLowerCase();
  const clientMode = (device.clientMode ?? "").toLowerCase();
  const deviceFamily = (device.deviceFamily ?? "").toLowerCase();
  return (
    clientId.includes("control-ui") ||
    clientId.includes("webchat") ||
    deviceFamily === "browser" ||
    clientMode === "webchat"
  );
}

function browserDeviceFingerprint(
  device: Pick<
    PairedDevice,
    "clientId" | "clientMode" | "platform" | "displayName" | "deviceFamily"
  >,
): string {
  return [
    (device.clientId ?? "").trim().toLowerCase(),
    (device.clientMode ?? "").trim().toLowerCase(),
    (device.platform ?? "").trim().toLowerCase(),
    (device.displayName ?? "").trim().toLowerCase(),
    (device.deviceFamily ?? "").trim().toLowerCase(),
  ].join("|");
}

/**
 * Trusted-proxy Control UI can register twice within seconds (connect silent-approve
 * + list upsert, or two tabs with different local identities) while showing the same
 * Mac/Chrome row. Keep the current connection (or newest) and drop the rest.
 */
async function pruneDuplicateSelfBrowserDevices(params: {
  paired: PairedDevice[];
  keepDeviceId?: string;
}): Promise<PairedDevice[]> {
  const groups = new Map<string, PairedDevice[]>();
  for (const device of params.paired) {
    if (!isBrowserPairedDevice(device)) {
      continue;
    }
    const fingerprint = browserDeviceFingerprint(device);
    const group = groups.get(fingerprint) ?? [];
    group.push(device);
    groups.set(fingerprint, group);
  }

  const removeIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }
    const keep =
      (params.keepDeviceId
        ? group.find((device) => device.deviceId === params.keepDeviceId)
        : undefined) ??
      [...group].toSorted(
        (a, b) => (b.approvedAtMs ?? b.createdAtMs ?? 0) - (a.approvedAtMs ?? a.createdAtMs ?? 0),
      )[0];
    if (!keep) {
      continue;
    }
    for (const device of group) {
      if (device.deviceId !== keep.deviceId) {
        removeIds.add(device.deviceId);
      }
    }
  }

  if (removeIds.size === 0) {
    return params.paired;
  }

  // Hide duplicates in the employee device list only. Deleting the pairing
  // record drops the browser's device id, so steward tools can no longer
  // resolve that tab's mailbox owner.
  return params.paired.filter((device) => !removeIds.has(device.deviceId));
}

/** Authorize a device mutation (remove/rotate/revoke) for self-scoped callers. */
async function authorizeDeviceSelfMutation(params: {
  deviceId: string;
  client: GatewayClient | null;
  respond: RespondFn;
}): Promise<boolean> {
  const selfOwner = await resolveDeviceSelfOwner(params.client);
  if (!selfOwner) {
    return true;
  }
  const device = await getPairedDevice(params.deviceId);
  if (device && device.ownerId !== selfOwner) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "not authorized for this device"),
    );
    return false;
  }
  return true;
}

function redactPairedDevice(
  device: { tokens?: Record<string, DeviceAuthToken> } & Record<string, unknown>,
) {
  const { tokens, approvedScopes: _approvedScopes, ...rest } = device;
  return {
    ...rest,
    tokens: summarizeDeviceTokens(tokens),
  };
}

export const deviceHandlers: GatewayRequestHandlers = {
  "device.pair.list": async ({ params, respond, client }) => {
    if (!validateDevicePairListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.list params: ${formatValidationErrors(
            validateDevicePairListParams.errors,
          )}`,
        ),
      );
      return;
    }
    let list = await listDevicePairing();
    const selfOwner = await resolveDeviceSelfOwner(client);
    // Lazy-claim / register the caller's currently connected device.
    // Trusted-proxy Control UI historically skipped pairing entirely, so the
    // browser never appeared in paired.json and employee self-scope returned [].
    if (selfOwner) {
      const currentDeviceId =
        typeof client?.connect?.device?.id === "string" ? client.connect.device.id.trim() : "";
      if (currentDeviceId) {
        const current = list.paired.find((device) => device.deviceId === currentDeviceId);
        if (current && !current.ownerId?.trim()) {
          await updatePairedDeviceMetadata(currentDeviceId, { ownerId: selfOwner });
          current.ownerId = selfOwner;
        } else if (!current) {
          const publicKey = normalizeDevicePublicKeyBase64Url(
            typeof client?.connect?.device?.publicKey === "string"
              ? client.connect.device.publicKey
              : "",
          );
          if (publicKey) {
            const connectClient = client?.connect?.client;
            const role =
              typeof client?.connect?.role === "string" && client.connect.role.trim()
                ? client.connect.role.trim()
                : "operator";
            const scopes = Array.isArray(client?.connect?.scopes)
              ? client.connect.scopes.filter(
                  (scope): scope is string => typeof scope === "string" && Boolean(scope.trim()),
                )
              : undefined;
            const pairing = await requestDevicePairing({
              deviceId: currentDeviceId,
              publicKey,
              displayName:
                typeof connectClient?.displayName === "string"
                  ? connectClient.displayName
                  : undefined,
              platform:
                typeof connectClient?.platform === "string" ? connectClient.platform : undefined,
              deviceFamily:
                typeof connectClient?.deviceFamily === "string"
                  ? connectClient.deviceFamily
                  : undefined,
              clientId: typeof connectClient?.id === "string" ? connectClient.id : undefined,
              clientMode: typeof connectClient?.mode === "string" ? connectClient.mode : undefined,
              role,
              scopes,
              silent: true,
            });
            await approveDevicePairing(pairing.request.requestId, undefined, {
              ownerId: selfOwner,
            });
            list = await listDevicePairing();
          }
        }
      }
    }
    // Self scope (employee): only own paired devices; pending requests are
    // unattributed (no owner until approved) so they stay platform-only.
    let paired = selfOwner
      ? list.paired.filter((device) => device.ownerId === selfOwner)
      : list.paired;
    if (selfOwner) {
      const keepDeviceId =
        typeof client?.connect?.device?.id === "string" ? client.connect.device.id.trim() : "";
      paired = await pruneDuplicateSelfBrowserDevices({
        paired,
        keepDeviceId: keepDeviceId || undefined,
      });
    }
    const pending = selfOwner ? [] : list.pending;
    respond(
      true,
      {
        pending,
        paired: paired.map((device) => redactPairedDevice(device)),
      },
      undefined,
    );
  },
  "device.pair.approve": async ({ params, respond, context, client }) => {
    if (!validateDevicePairApproveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.approve params: ${formatValidationErrors(
            validateDevicePairApproveParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { requestId } = params as { requestId: string };
    // Stamp owner attribution from the approving session (task 2.7).
    const attribution = await resolveTrustedAttribution(client);
    const approved = await approveDevicePairing(
      requestId,
      undefined,
      attribution.ownerId ? { ownerId: attribution.ownerId } : undefined,
    );
    if (!approved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    context.logGateway.info(
      `device pairing approved device=${approved.device.deviceId} role=${approved.device.role ?? "unknown"}`,
    );
    context.broadcast(
      "device.pair.resolved",
      {
        requestId,
        deviceId: approved.device.deviceId,
        decision: "approved",
        ts: Date.now(),
      },
      { dropIfSlow: true, dedupeKey: `device.pair.resolved:${requestId}` },
    );
    respond(true, { requestId, device: redactPairedDevice(approved.device) }, undefined);
  },
  "device.pair.reject": async ({ params, respond, context }) => {
    if (!validateDevicePairRejectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.reject params: ${formatValidationErrors(
            validateDevicePairRejectParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { requestId } = params as { requestId: string };
    const rejected = await rejectDevicePairing(requestId);
    if (!rejected) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    context.broadcast(
      "device.pair.resolved",
      {
        requestId,
        deviceId: rejected.deviceId,
        decision: "rejected",
        ts: Date.now(),
      },
      { dropIfSlow: true, dedupeKey: `device.pair.resolved:${requestId}` },
    );
    respond(true, rejected, undefined);
  },
  "device.pair.remove": async ({ params, respond, context, client }) => {
    if (!validateDevicePairRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.remove params: ${formatValidationErrors(
            validateDevicePairRemoveParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId } = params as { deviceId: string };
    if (!(await authorizeDeviceSelfMutation({ deviceId, client, respond }))) {
      return;
    }
    const removed = await removePairedDevice(deviceId);
    if (!removed) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId"));
      return;
    }
    context.logGateway.info(`device pairing removed device=${removed.deviceId}`);
    respond(true, removed, undefined);
  },
  "device.token.rotate": async ({ params, respond, context, client }) => {
    if (!validateDeviceTokenRotateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.token.rotate params: ${formatValidationErrors(
            validateDeviceTokenRotateParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId, role, scopes } = params as {
      deviceId: string;
      role: string;
      scopes?: string[];
    };
    if (!(await authorizeDeviceSelfMutation({ deviceId, client, respond }))) {
      return;
    }
    const entry = await rotateDeviceToken({ deviceId, role, scopes });
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId/role"));
      return;
    }
    context.logGateway.info(
      `device token rotated device=${deviceId} role=${entry.role} scopes=${entry.scopes.join(",")}`,
    );
    respond(
      true,
      {
        deviceId,
        role: entry.role,
        token: entry.token,
        scopes: entry.scopes,
        rotatedAtMs: entry.rotatedAtMs ?? entry.createdAtMs,
      },
      undefined,
    );
  },
  "device.token.revoke": async ({ params, respond, context, client }) => {
    if (!validateDeviceTokenRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.token.revoke params: ${formatValidationErrors(
            validateDeviceTokenRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId, role } = params as { deviceId: string; role: string };
    if (!(await authorizeDeviceSelfMutation({ deviceId, client, respond }))) {
      return;
    }
    const entry = await revokeDeviceToken({ deviceId, role });
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId/role"));
      return;
    }
    context.logGateway.info(`device token revoked device=${deviceId} role=${entry.role}`);
    respond(
      true,
      { deviceId, role: entry.role, revokedAtMs: entry.revokedAtMs ?? Date.now() },
      undefined,
    );
  },
};
