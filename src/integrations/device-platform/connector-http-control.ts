import type {
  ApplyBindingRequest,
  BindingApplicationStatus,
  ControlAcl,
  DevicePlatformControlClient,
  DeviceQueryRow,
  DiscoveredCapabilities,
  StatusSyncResult,
} from "./control-client.js";
import {
  DeviceControlHttpError,
  HttpDevicePlatformControl,
  type DeviceControlDevice,
  type DeviceControlFetch,
} from "./http-control-client.js";
import type { StoredServiceCredential } from "./store.js";
import { DEVICE_PLATFORM_CONTROL_CONTRACT, DevicePlatformError } from "./types.js";
import type { DevicePlatformConnection } from "./types.js";
import { assertResolvedServiceHost, assertSafeServiceBaseUrl } from "./url-safety.js";

const PAIR_CHALLENGE_ID = /^pch_[A-Za-z0-9_-]{8,80}$/;
const PAIRING_CODE = /^[0-9]{6}$/;

export type ConnectorControlSource = {
  loadConnection(platformId: string): DevicePlatformConnection | null;
  loadCredential(platformId: string): StoredServiceCredential | null;
};

/**
 * Speaks the frozen device-control API on the admin-configured connector origin.
 * OpenBot user routes never receive the service URL or the Basic secret.
 * Pairing fields stay on the device platform. Bind uses the OpenBot grant header.
 */
export class ConnectorHttpControl implements DevicePlatformControlClient {
  readonly contract = DEVICE_PLATFORM_CONTROL_CONTRACT;

  constructor(
    private readonly source: ConnectorControlSource,
    private readonly fetchImpl?: DeviceControlFetch,
  ) {}

  async discoverCapabilities(input: {
    platformId: string;
    externalDeviceId: string;
  }): Promise<DiscoveredCapabilities> {
    const client = await this.client(input.platformId);
    await client.getCapabilities();
    return { capabilities: [] };
  }

  async verifyPairingChallenge(input: {
    platformId: string;
    externalDeviceId: string;
    challenge: string;
    proof: string;
  }): Promise<{ ok: boolean; pendingConfirm?: boolean }> {
    if (!PAIR_CHALLENGE_ID.test(input.challenge)) {
      throw new DevicePlatformError("VALIDATION", "Pairing challenge is invalid");
    }
    if (!PAIRING_CODE.test(input.proof)) {
      throw new DevicePlatformError("PAIRING_WRONG", "Pairing code was rejected");
    }
    try {
      const client = await this.client(input.platformId);
      const ownership = await client.redeemPairChallenge({
        pairChallenge: input.challenge,
        deviceId: input.externalDeviceId,
        pairingCode: input.proof,
      });
      if (ownership.deviceId !== input.externalDeviceId) {
        throw new DevicePlatformError(
          "PAIRING_MISMATCH",
          "Pairing code does not match this device",
        );
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof DevicePlatformError) {
        throw error;
      }
      if (error instanceof DeviceControlHttpError && error.code === "confirmation_required") {
        return { ok: false, pendingConfirm: true };
      }
      throw mapControlError(error);
    }
  }

  async queryDevices(_acl: ControlAcl): Promise<DeviceQueryRow[]> {
    // User visibility is the local claim index. The platform list is not a user roster.
    return [];
  }

  async applyBinding(input: ApplyBindingRequest): Promise<{
    accepted: boolean;
    appliedBindingVersion?: number;
  }> {
    const grantCredential = input.grantCredential?.trim() ?? "";
    if (!grantCredential) {
      throw new DevicePlatformError("PLATFORM_UNAVAILABLE", "OpenBot grant is not available");
    }
    try {
      const client = await this.client(input.platformId);
      const device = await client.applyBind({
        deviceId: input.externalDeviceId,
        authorizationRef: input.authorizationRef,
        grantCredential,
        bindingVersion: input.expectedBindingVersion,
        digitalHumanId: input.digitalHumanId,
      });
      return {
        accepted: device.bindStatus === "bound",
        ...(typeof device.bindingVersion === "number"
          ? { appliedBindingVersion: device.bindingVersion }
          : {}),
      };
    } catch (error) {
      throw mapControlError(error);
    }
  }

  async getBindingApplicationStatus(input: {
    platformId: string;
    externalDeviceId: string;
    expectedBindingVersion: number;
  }): Promise<BindingApplicationStatus> {
    try {
      const client = await this.client(input.platformId);
      const device = await client.getBind(input.externalDeviceId);
      const applied = typeof device.bindingVersion === "number" ? device.bindingVersion : 0;
      const appliedNow = device.bindStatus === "bound" && applied === input.expectedBindingVersion;
      return {
        expectedBindingVersion: input.expectedBindingVersion,
        appliedBindingVersion: applied,
        state: appliedNow ? "applied" : device.bindStatus === "revoked" ? "error" : "pending",
      };
    } catch (error) {
      throw mapControlError(error);
    }
  }

  async stopOrRevoke(input: {
    platformId: string;
    externalDeviceId: string;
  }): Promise<{ ok: boolean }> {
    try {
      const client = await this.client(input.platformId);
      await client.revokeLocal(input.externalDeviceId);
      return { ok: true };
    } catch (error) {
      throw mapControlError(error);
    }
  }

  async syncStatus(input: {
    platformId: string;
    externalDeviceId: string;
  }): Promise<StatusSyncResult> {
    try {
      const client = await this.client(input.platformId);
      const device = await client.getBind(input.externalDeviceId);
      return projectStatus(device);
    } catch (error) {
      throw mapControlError(error);
    }
  }

  async health(platformId: string): Promise<{ status: "ok" | "down"; checkedAt: string }> {
    const checkedAt = new Date().toISOString();
    try {
      const client = await this.client(platformId);
      await client.getHealth();
      await client.getCapabilities();
      return { status: "ok", checkedAt };
    } catch {
      return { status: "down", checkedAt };
    }
  }

  private async client(platformId: string): Promise<HttpDevicePlatformControl> {
    const connection = this.source.loadConnection(platformId);
    if (!connection?.enabled) {
      throw new DevicePlatformError("PLATFORM_DISABLED", "Device platform connection is disabled");
    }
    const credential = this.source.loadCredential(platformId);
    if (!credential?.secret || !connection.clientIdentity.trim()) {
      throw new DevicePlatformError(
        "PLATFORM_UNAVAILABLE",
        "Device platform credential is missing",
      );
    }
    assertSafeServiceBaseUrl(connection.serviceBaseUrl, connection.environment);
    await assertResolvedServiceHost(connection.serviceBaseUrl, connection.environment);
    return new HttpDevicePlatformControl({
      serviceBaseUrl: connection.serviceBaseUrl,
      serviceUser: connection.clientIdentity,
      servicePassword: credential.secret,
      fetchImpl: this.fetchImpl,
    });
  }
}

function mapControlError(error: unknown): DevicePlatformError {
  if (error instanceof DevicePlatformError) {
    return error;
  }
  if (!(error instanceof DeviceControlHttpError)) {
    return new DevicePlatformError("PLATFORM_UNAVAILABLE", "Device platform request failed");
  }
  const code = error.code.toLowerCase();
  if (code === "bind_missing" || code === "not_found") {
    return new DevicePlatformError("NOT_FOUND", "Device is not bound on the platform");
  }
  if (
    code === "unauthorized" ||
    code === "timeout" ||
    code === "http_failed" ||
    code === "contract" ||
    code === "redirect"
  ) {
    return new DevicePlatformError("PLATFORM_UNAVAILABLE", "Device platform request failed");
  }
  if (code.includes("expir")) {
    return new DevicePlatformError("PAIRING_EXPIRED", "Pairing code expired");
  }
  if (code.includes("replay") || code.includes("consumed") || code.includes("already_used")) {
    return new DevicePlatformError("PAIRING_REPLAY", "Pairing code was already used");
  }
  if (code.includes("mismatch")) {
    return new DevicePlatformError("PAIRING_MISMATCH", "Pairing code does not match this device");
  }
  if (code.includes("wrong") || code === "validation" || code.includes("invalid")) {
    return new DevicePlatformError("PAIRING_WRONG", "Pairing code was rejected");
  }
  return new DevicePlatformError("PLATFORM_UNAVAILABLE", "Device platform request failed");
}

function projectStatus(device: DeviceControlDevice): StatusSyncResult {
  const raw = device as unknown as Record<string, unknown>;
  const presence = readPresence(raw);
  const lastSeen =
    typeof raw.lastSeen === "string" && isIso(raw.lastSeen) ? raw.lastSeen : undefined;
  const model = readLabel(raw.model);
  const firmware = readLabel(raw.firmware);
  const anomaly = readLabel(raw.anomalySummary);
  return {
    online: presence === "online",
    presence,
    ...(lastSeen ? { lastSeen } : {}),
    capabilities: [],
    ...(firmware ? { firmware } : {}),
    ...(model ? { model } : {}),
    ...(anomaly ? { anomalySummary: anomaly } : {}),
  };
}

function readPresence(raw: Record<string, unknown>): "online" | "offline" | "unknown" {
  if (raw.online === true) {
    return "online";
  }
  if (raw.online === false) {
    return "offline";
  }
  if (raw.presence === "online" || raw.presence === "offline" || raw.presence === "unknown") {
    return raw.presence;
  }
  return "unknown";
}

function readLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || /[\r\n]/.test(trimmed) || /:\/\//.test(trimmed)) {
    return undefined;
  }
  if (/secret|private|password|credential/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function isIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}
