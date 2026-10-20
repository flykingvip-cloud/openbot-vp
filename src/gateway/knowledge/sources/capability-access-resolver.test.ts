import { describe, expect, it } from "vitest";
import { listDataCapabilities } from "../../enterprise-data/data-capability-store.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import { loadDataCapabilityFeed } from "../feed/data-capability-feed-adapter.js";
import {
  resolveCapabilityAccessForKnowledge,
  resolveCapabilityAccessState,
} from "./capability-access-resolver.js";
import { loadExternalDataSourceSummaries } from "./external-data-sources.js";

const tenantId = "tenant-acme";

describe("capability access resolver", () => {
  it("grants capability access from department and role policies without seat grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso: new Date().toISOString() });
    const capability = listDataCapabilities({ store, tenantId }).find(
      (item) => item.capabilityKey === "customer.profile",
    );
    expect(capability).toBeTruthy();

    const seatOnly = resolveCapabilityAccessState({
      capability: capability!,
      grants: [],
    });
    expect(seatOnly).not.toBe("granted");

    const byRole = resolveCapabilityAccessForKnowledge({
      store,
      capability: capability!,
      context: {
        tenantId,
        seatId: "seat-without-grants",
        roleCode: "sales-mgr",
      },
      grants: [],
    });
    expect(byRole).toBe("granted");

    const byDepartment = resolveCapabilityAccessForKnowledge({
      store,
      capability: capability!,
      context: {
        tenantId,
        seatId: "seat-without-grants",
        departmentId: "sales-mgr:华东销售",
      },
      grants: [],
    });
    expect(byDepartment).toBe("granted");
  });

  it("surfaces department/role grants in knowledge data capability feed", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso: new Date().toISOString() });
    const feed = loadDataCapabilityFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-without-grants",
        userId: "employee-2",
        roleCode: "sales-mgr",
        departmentId: "sales-mgr:华东销售",
        hasEnterpriseScope: true,
      },
    });
    const customerProfile = feed.descriptors.find((item) => item.title === "客户画像能力");
    expect(customerProfile?.accessState).toBe("granted");
    expect(feed.feedItems).toEqual([]);
    expect(feed.objects).toEqual([]);
  });

  it("does not invent external access or source summaries from live DataSource status", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso: new Date().toISOString() });
    for (const source of Object.values(store.dataSources)) {
      source.category = "external";
      source.status = "disconnected";
    }
    const capability = listDataCapabilities({ store, tenantId }).find(
      (item) => item.capabilityKey === "customer.profile",
    );
    expect(capability).toBeTruthy();
    expect(
      resolveCapabilityAccessState({
        capability: capability!,
        grants: [],
      }),
    ).toBe("requestable");
    expect(
      resolveCapabilityAccessForKnowledge({
        store,
        capability: capability!,
        context: {
          tenantId,
          seatId: "seat-without-grants",
          roleCode: "sales-mgr",
        },
        grants: [],
      }),
    ).toBe("granted");
    expect(loadExternalDataSourceSummaries({ store, tenantId })).toEqual([]);
    const feed = loadDataCapabilityFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-without-grants",
        userId: "employee-2",
        hasEnterpriseScope: true,
      },
    });
    expect(feed.descriptors.every((item) => item.accessState !== "external")).toBe(true);
    expect(feed.summary.externalSourceCount).toBe(0);
    expect(feed.objects).toEqual([]);
    expect(feed.feedItems).toEqual([]);
    expect(feed.descriptors.every((item) => item.freshness === "unknown")).toBe(true);
  });
});
