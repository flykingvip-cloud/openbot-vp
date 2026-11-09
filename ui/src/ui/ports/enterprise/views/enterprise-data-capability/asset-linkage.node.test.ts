import { describe, expect, it } from "vitest";
import {
  assetLinkedCapabilityLabel,
  connectionHealthLabel,
  freshnessLabel,
  isCountedConnectionHealthy,
  isCountedFreshnessHealthy,
  isCountedVerificationHealthy,
  normalizeAssetLinkage,
  verificationLabel,
} from "./asset-linkage.ts";

describe("E2 asset linkage display", () => {
  it("shows linked data products when there is no SAR bridge", () => {
    const item = normalizeAssetLinkage({
      sourceId: "src-yonyou",
      accessMethod: "credential",
      products: [{ capabilityId: "cap-purchase", displayName: "001-用友T+ · 采购入库" }],
      verification: {
        status: "unknown",
        healthy: false,
        productionVerificationCount: 0,
        capabilities: [],
      },
    });
    expect(item?.products).toEqual([
      { capabilityId: "cap-purchase", displayName: "001-用友T+ · 采购入库" },
    ]);
    expect(assetLinkedCapabilityLabel(item)).toBe("001-用友T+ · 采购入库");
    expect(assetLinkedCapabilityLabel(undefined)).toBe("无");
  });

  it("shows a healthy account and a failed capability together", () => {
    const item = normalizeAssetLinkage({
      sourceId: "src-site",
      accessMethod: "website_session",
      demo: false,
      connection: { status: "connected", health: "healthy" },
      verification: {
        status: "failed",
        healthy: false,
        productionVerificationCount: 0,
        capabilities: [],
      },
      freshness: {
        status: "unknown",
        healthy: false,
        materializationCount: 0,
        claimsSynced: false,
        claimsIngested: false,
      },
      scope: { supportedScopeTypes: ["SELF"], known: true },
      account: { bindingId: "bind-owner", selectable: true },
      links: { capabilityCenter: null },
    });
    expect(item?.connection.health).toBe("healthy");
    expect(connectionHealthLabel("healthy")).toBe("连接健康");
    expect(item?.verification.status).toBe("failed");
    expect(verificationLabel("failed")).toBe("验证失败");
    expect(isCountedConnectionHealthy("healthy")).toBe(true);
    expect(isCountedVerificationHealthy("failed")).toBe(false);
  });

  it("does not treat unknown as healthy and does not call a live query synced", () => {
    expect(isCountedConnectionHealthy("unknown")).toBe(false);
    expect(isCountedVerificationHealthy("unknown")).toBe(false);
    expect(isCountedFreshnessHealthy("unknown")).toBe(false);
    expect(isCountedFreshnessHealthy("live_query")).toBe(false);
    const label = freshnessLabel("live_query");
    expect(label).toBe("实时查询，未入库");
    expect(label.includes("已同步")).toBe(false);
    const item = normalizeAssetLinkage({
      sourceId: "src-live",
      freshness: {
        status: "live_query",
        healthy: true,
        claimsSynced: true,
        claimsIngested: true,
        materializationCount: 4,
      },
      connection: { health: "not-a-status" },
      verification: { status: "passed", healthy: true },
    });
    expect(item?.connection.health).toBe("unknown");
    expect(item?.freshness.status).toBe("live_query");
    expect(item?.freshness.healthy).toBe(false);
    expect(item?.freshness.claimsSynced).toBe(false);
    expect(item?.freshness.claimsIngested).toBe(false);
    expect(item?.verification.healthy).toBe(true);
  });
});
