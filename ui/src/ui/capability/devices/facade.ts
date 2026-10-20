import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
  type DevicesLoadState,
  type DevicesManageState,
} from "../../controllers/devices.ts";

export type DevicesCapabilityLoadState = DevicesLoadState;
export type DevicesCapabilityManageState = DevicesManageState;

export const devicesCapability = {
  approvePairing: approveDevicePairing,
  load: loadDevices,
  rejectPairing: rejectDevicePairing,
  revokeToken: revokeDeviceToken,
  rotateToken: rotateDeviceToken,
} as const;
