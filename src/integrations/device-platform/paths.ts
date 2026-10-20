import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export type DevicePlatformPaths = {
  tenantsRoot: string;
  connectionFile: string;
  claimFile: string;
  tenantFile: (tenantId: string) => string;
};

export function assertSafeTenantId(tenantId: string): void {
  if (!SAFE_TENANT_ID.test(tenantId)) {
    throw new Error(`invalid tenant id: ${tenantId}`);
  }
}

/** Same root as tenant control-plane stores: OPENBOT_TENANTS_ROOT or CONFIG_DIR/tenants. */
export function resolveDevicePlatformTenantsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENBOT_TENANTS_ROOT?.trim() || path.join(CONFIG_DIR, "tenants");
}

/**
 * Platform connector config is platform-scoped.
 * Device usage records are sharded by tenant under control-plane/.
 */
export function resolveDevicePlatformPaths(
  env: NodeJS.ProcessEnv = process.env,
): DevicePlatformPaths {
  return devicePlatformPathsUnder(resolveDevicePlatformTenantsRoot(env));
}

export function devicePlatformPathsUnder(tenantsRoot: string): DevicePlatformPaths {
  const platformDir = path.join(tenantsRoot, "_platform", "control-plane");
  return {
    tenantsRoot,
    connectionFile: path.join(platformDir, "device-platform-connections.json"),
    claimFile: path.join(platformDir, "device-claims.json"),
    tenantFile(tenantId: string) {
      assertSafeTenantId(tenantId);
      return path.join(tenantsRoot, tenantId, "control-plane", "device-platform.json");
    },
  };
}

export function claimKey(platformId: string, externalDeviceId: string): string {
  return `${platformId}\u0000${externalDeviceId}`;
}
