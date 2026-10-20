import { t } from "../../i18n/index.ts";
import { clearDeviceAuthToken, storeDeviceAuthToken } from "../device-auth.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type DeviceTokenSummary = {
  role: string;
  scopes?: string[];
  createdAtMs?: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  lastUsedAtMs?: number;
};

export type PendingDevice = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  remoteIp?: string;
  isRepair?: boolean;
  ts?: number;
};

export type PairedDevice = {
  deviceId: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  tokens?: DeviceTokenSummary[];
  createdAtMs?: number;
  approvedAtMs?: number;
};

export type DevicePairingList = {
  pending: PendingDevice[];
  paired: PairedDevice[];
};

export type DevicesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  /** deviceId of this browser's own identity (drives the "current device" badge). */
  devicesCurrentDeviceId?: string | null;
};

export type DevicesLoadState = DevicesState;

export type DevicesManageState = DevicesState;

export async function loadDevices(state: DevicesLoadState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    if (!opts?.quiet) {
      state.devicesError = "网关未连接，无法加载设备列表。";
    }
    return;
  }
  if (state.devicesLoading) {
    return;
  }
  state.devicesLoading = true;
  if (!opts?.quiet) {
    state.devicesError = null;
  }
  try {
    const res = await state.client.request<{
      pending?: Array<PendingDevice>;
      paired?: Array<PairedDevice>;
    }>("device.pair.list", {});
    state.devicesList = {
      pending: Array.isArray(res?.pending) ? res.pending : [],
      paired: Array.isArray(res?.paired) ? res.paired : [],
    };
    try {
      // Identity creation requires a secure context; tolerate failure (no badge).
      const identity = await loadOrCreateDeviceIdentity();
      state.devicesCurrentDeviceId = identity.deviceId;
    } catch {
      state.devicesCurrentDeviceId = null;
    }
  } catch (err) {
    if (!opts?.quiet) {
      state.devicesError = String(err);
    }
  } finally {
    state.devicesLoading = false;
  }
}

export async function approveDevicePairing(state: DevicesManageState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("device.pair.approve", { requestId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function rejectDevicePairing(state: DevicesManageState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(t("nodesPage.confirm.rejectPairing"));
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.pair.reject", { requestId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function removeDevice(state: DevicesManageState, deviceId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(t("nodesPage.confirm.removeDevice"));
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.pair.remove", { deviceId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

/** Bulk-remove paired devices (single confirm), used by the inactive-devices cleanup. */
export async function removeDevices(state: DevicesManageState, deviceIds: string[]) {
  if (!state.client || !state.connected || deviceIds.length === 0) {
    return;
  }
  const confirmed = window.confirm(
    t("nodesPage.confirm.removeDevices", { count: String(deviceIds.length) }),
  );
  if (!confirmed) {
    return;
  }
  try {
    for (const deviceId of deviceIds) {
      await state.client.request("device.pair.remove", { deviceId });
    }
  } catch (err) {
    state.devicesError = String(err);
  } finally {
    await loadDevices(state);
  }
}

export async function rotateDeviceToken(
  state: DevicesManageState,
  params: { deviceId: string; role: string; scopes?: string[] },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{
      token: string;
      role?: string;
      deviceId?: string;
      scopes?: Array<string>;
    }>("device.token.rotate", params);
    if (res?.token) {
      const identity = await loadOrCreateDeviceIdentity();
      const role = res.role ?? params.role;
      if (res.deviceId === identity.deviceId || params.deviceId === identity.deviceId) {
        storeDeviceAuthToken({
          deviceId: identity.deviceId,
          role,
          token: res.token,
          scopes: res.scopes ?? params.scopes ?? [],
        });
      }
      window.prompt(t("nodesPage.confirm.newTokenPrompt"), res.token);
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function revokeDeviceToken(
  state: DevicesManageState,
  params: { deviceId: string; role: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(
    t("nodesPage.confirm.revokeToken", { deviceId: params.deviceId, role: params.role }),
  );
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.token.revoke", params);
    const identity = await loadOrCreateDeviceIdentity();
    if (params.deviceId === identity.deviceId) {
      clearDeviceAuthToken({ deviceId: identity.deviceId, role: params.role });
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}
