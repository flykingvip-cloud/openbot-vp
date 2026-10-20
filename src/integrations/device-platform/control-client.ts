import { DEVICE_PLATFORM_CONTROL_CONTRACT } from "./types.js";

/**
 * In-process control seam used by the B1 management service and its unit tests.
 * The frozen device-platform HTTP contract lives in `http-control-client.ts`.
 * That client calls the admin-configured device-platform origin. It does not
 * call `/api/integrations/v1` and does not send pairing fields there.
 */

export type ControlAcl = {
  tenantId: string;
  userId: string;
};

export type DiscoveredCapabilities = {
  capabilities: string[];
  firmware?: string;
};

export type DeviceQueryRow = {
  platformId: string;
  externalDeviceId: string;
  displayName?: string;
  online: boolean;
};

export type ApplyBindingRequest = {
  platformId: string;
  externalDeviceId: string;
  digitalHumanId: string;
  authorizationRef: string;
  scopes: string[];
  expectedBindingVersion: number;
};

export type BindingApplicationStatus = {
  expectedBindingVersion: number;
  appliedBindingVersion: number;
  state: "pending" | "applied" | "error";
};

export type StatusSyncResult = {
  online: boolean;
  lastSeen?: string;
  capabilities: string[];
  firmware?: string;
  anomalySummary?: string;
  /** Present only on the control wire. The management service must drop this before persist. */
  rawDiagnostics?: string;
};

export interface DevicePlatformControlClient {
  readonly contract: typeof DEVICE_PLATFORM_CONTROL_CONTRACT;
  discoverCapabilities(input: {
    platformId: string;
    externalDeviceId: string;
  }): Promise<DiscoveredCapabilities>;
  verifyPairingChallenge(input: {
    platformId: string;
    externalDeviceId: string;
    challenge: string;
    proof: string;
  }): Promise<{ ok: boolean }>;
  /** The platform must filter by this ACL. Callers still filter local records. */
  queryDevices(acl: ControlAcl): Promise<DeviceQueryRow[]>;
  applyBinding(input: ApplyBindingRequest): Promise<{
    accepted: boolean;
    appliedBindingVersion?: number;
  }>;
  getBindingApplicationStatus(input: {
    platformId: string;
    externalDeviceId: string;
    expectedBindingVersion: number;
  }): Promise<BindingApplicationStatus>;
  stopOrRevoke(input: {
    platformId: string;
    externalDeviceId: string;
    authorizationRef?: string;
    expectedBindingVersion: number;
  }): Promise<{ ok: boolean }>;
  syncStatus(input: { platformId: string; externalDeviceId: string }): Promise<StatusSyncResult>;
  health(platformId: string): Promise<{ status: "ok" | "down"; checkedAt: string }>;
}

export class FakeDevicePlatformControl implements DevicePlatformControlClient {
  readonly contract = DEVICE_PLATFORM_CONTROL_CONTRACT;
  readonly calls: string[] = [];
  healthStatus: "ok" | "down" = "ok";
  /** When set, apply reports this version instead of the expected one. */
  appliedBindingVersion: number | undefined;
  rawDiagnostics = "raw-diagnostic-dump";
  private readonly visible: Array<DeviceQueryRow & ControlAcl> = [];
  private gate: Promise<void> | null = null;

  holdNext(gate: Promise<void>): void {
    this.gate = gate;
  }

  seedVisible(row: DeviceQueryRow & ControlAcl): void {
    this.visible.push(row);
  }

  async discoverCapabilities(): Promise<DiscoveredCapabilities> {
    await this.touch("discoverCapabilities");
    return { capabilities: ["chat"], firmware: "1.0.0" };
  }

  async verifyPairingChallenge(input: {
    challenge: string;
    proof: string;
  }): Promise<{ ok: boolean }> {
    await this.touch("verifyPairingChallenge");
    return { ok: input.proof === `ok:${input.challenge}` };
  }

  async queryDevices(acl: ControlAcl): Promise<DeviceQueryRow[]> {
    await this.touch(`queryDevices:${acl.tenantId}:${acl.userId}`);
    return this.visible
      .filter((row) => row.tenantId === acl.tenantId && row.userId === acl.userId)
      .map(({ platformId, externalDeviceId, displayName, online }) => ({
        platformId,
        externalDeviceId,
        ...(displayName ? { displayName } : {}),
        online,
      }));
  }

  async applyBinding(input: ApplyBindingRequest): Promise<{
    accepted: boolean;
    appliedBindingVersion?: number;
  }> {
    await this.touch("applyBinding");
    return {
      accepted: true,
      appliedBindingVersion: this.appliedBindingVersion ?? input.expectedBindingVersion,
    };
  }

  async getBindingApplicationStatus(input: {
    expectedBindingVersion: number;
  }): Promise<BindingApplicationStatus> {
    await this.touch("getBindingApplicationStatus");
    const applied = this.appliedBindingVersion ?? input.expectedBindingVersion;
    return {
      expectedBindingVersion: input.expectedBindingVersion,
      appliedBindingVersion: applied,
      state: applied === input.expectedBindingVersion ? "applied" : "pending",
    };
  }

  async stopOrRevoke(): Promise<{ ok: boolean }> {
    await this.touch("stopOrRevoke");
    return { ok: true };
  }

  async syncStatus(): Promise<StatusSyncResult> {
    await this.touch("syncStatus");
    return {
      online: true,
      lastSeen: "2026-10-20T00:00:00.000Z",
      capabilities: ["chat"],
      firmware: "1.0.0",
      anomalySummary: "none",
      rawDiagnostics: this.rawDiagnostics,
    };
  }

  async health(): Promise<{ status: "ok" | "down"; checkedAt: string }> {
    await this.touch("health");
    return { status: this.healthStatus, checkedAt: "2026-10-20T00:00:00.000Z" };
  }

  private async touch(name: string): Promise<void> {
    this.calls.push(name);
    const gate = this.gate;
    this.gate = null;
    if (gate) {
      await gate;
    }
  }
}
