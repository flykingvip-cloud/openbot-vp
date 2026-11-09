import { describe, expect, it, vi } from "vitest";
import {
  createPlatformHeartbeatActivityQuery,
  type PlatformActivityReaderIdentity,
} from "./heartbeat-activity-query.js";
import { startHeartbeatActivity } from "./heartbeat-activity.js";
const platform: PlatformActivityReaderIdentity = {
  principalRef: "platform-user",
  sessionDomain: "platform",
  tenantId: null,
  scopes: ["operator.platform"],
};
describe("platform heartbeat activity authorization", () => {
  it("reads only with both trusted platform identity and explicit platform permission", async () => {
    const collector = startHeartbeatActivity({ enabled: () => false });
    const query = createPlatformHeartbeatActivityQuery({
      collector,
      authorize: async () => platform,
    });
    const result = await query();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("failed");
    }
    expect(result.activity.scope).toBe("platform_only");
    expect(result.activity.uptime).toBeNull();
    collector.stop();
  });
  it("denies enterprise read/admin and forged platform scope without platform identity", async () => {
    const handle = startHeartbeatActivity({ enabled: () => false });
    const collector = { query: vi.fn(() => handle.query()) };
    for (const auth of [
      null,
      { ...platform, sessionDomain: "enterprise" as const, tenantId: "tenant" },
      { ...platform, scopes: ["operator.read", "operator.admin"] },
      { ...platform, tenantId: "tenant" },
    ]) {
      expect(
        await createPlatformHeartbeatActivityQuery({ collector, authorize: async () => auth })(),
      ).toEqual({ ok: false, code: "unauthorized" });
    }
    expect(collector.query).not.toHaveBeenCalled();
  });
  it("discards the read after revocation or principal change", async () => {
    const collector = startHeartbeatActivity({ enabled: () => false });
    for (const next of [
      null,
      { ...platform, principalRef: "other" },
      { ...platform, scopes: ["operator.admin"] },
    ]) {
      let count = 0;
      expect(
        await createPlatformHeartbeatActivityQuery({
          collector,
          authorize: async () => (++count === 1 ? platform : next),
        })(),
      ).toEqual({ ok: false, code: "unauthorized" });
    }
    collector.stop();
  });
});
