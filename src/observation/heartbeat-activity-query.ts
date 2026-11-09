/** Host-only platform read adapter. No RPC registration and no collector construction. */
import type { startHeartbeatActivity } from "./heartbeat-activity.js";
export type PlatformActivityReaderIdentity = {
  principalRef: string;
  sessionDomain: "platform" | "enterprise" | "employee";
  tenantId: string | null;
  scopes: readonly string[];
};
export function createPlatformHeartbeatActivityQuery(options: {
  collector: Pick<ReturnType<typeof startHeartbeatActivity>, "query">;
  authorize: () => Promise<PlatformActivityReaderIdentity | null>;
}) {
  const identity = (auth: PlatformActivityReaderIdentity | null) =>
    auth &&
    auth.principalRef.trim() &&
    auth.sessionDomain === "platform" &&
    auth.tenantId === null &&
    auth.scopes.includes("operator.platform")
      ? auth.principalRef
      : null;
  return async () => {
    try {
      const principal = identity(await options.authorize());
      if (!principal) {
        return { ok: false as const, code: "unauthorized" as const };
      }
      const snapshot = options.collector.query();
      if (identity(await options.authorize()) !== principal) {
        return { ok: false as const, code: "unauthorized" as const };
      }
      return { ok: true as const, activity: snapshot, readOnly: true as const };
    } catch {
      return { ok: false as const, code: "activity_read_failed" as const };
    }
  };
}
