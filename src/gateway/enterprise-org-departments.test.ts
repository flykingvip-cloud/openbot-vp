import { describe, expect, it } from "vitest";
import {
  applyOrganizationDepartmentMutation,
  listTenantOrganizationDepartmentPaths,
} from "./enterprise-org-departments.ts";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.ts";
import { ensureSeatForProvision } from "./enterprise-seat-assets-store.ts";

function createStore(tenantId = "acme"): EnterpriseSeatAssetsStore {
  const nowIso = "2026-06-12T08:00:00.000Z";
  const store: EnterpriseSeatAssetsStore = {
    version: 4,
    seats: {},
    bindings: {},
    accessPolicies: {},
    assetBindings: {},
    credentialBindings: {},
    handovers: {},
    offers: {},
    auditEvents: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
    organizationDepartments: {},
    organizationChildOrders: {},
  };
  ensureSeatForProvision({
    store,
    tenantId,
    seatTitle: "销售总监",
    teamLabel: "销售部/华东区",
    nowIso,
  });
  ensureSeatForProvision({
    store,
    tenantId,
    seatTitle: "运营经理",
    teamLabel: "运营部",
    nowIso,
  });
  return store;
}

describe("enterprise organization departments", () => {
  it("rejects creating a seat whose title is an email", () => {
    const store = createStore();
    expect(() =>
      ensureSeatForProvision({
        store,
        tenantId: "acme",
        seatTitle: "368809901@qq.com",
        nowIso: "2026-06-12T08:12:00.000Z",
      }),
    ).toThrow(/email address/);
  });

  it("creates empty nested departments", () => {
    const store = createStore();
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: { action: "create", parentPath: "销售部", label: "华南区" },
      nowIso: "2026-06-12T08:10:00.000Z",
    });
    expect(result.fullPath).toBe("销售部/华南区");
    expect(listTenantOrganizationDepartmentPaths(store, "acme")).toContain("销售部/华南区");
  });

  it("renames a department prefix for seats and empty departments", () => {
    const store = createStore();
    applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: { action: "create", parentPath: "销售部", label: "华南区" },
      nowIso: "2026-06-12T08:10:00.000Z",
    });
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: { action: "rename", path: "销售部/华东区", label: "华东大区" },
      nowIso: "2026-06-12T08:11:00.000Z",
    });
    expect(result.fullPath).toBe("销售部/华东大区");
    const seat = Object.values(store.seats).find((entry) => entry.title === "销售总监");
    expect(seat?.teamLabel).toBe("销售部/华东大区");
  });

  it("allows renaming 未分组 into a formal department name", () => {
    const store = createStore();
    ensureSeatForProvision({
      store,
      tenantId: "acme",
      seatTitle: "未分配顾问",
      nowIso: "2026-06-12T08:11:10.000Z",
    });
    const ungroupedSeat = Object.values(store.seats).find((entry) => entry.title === "未分配顾问");
    expect(ungroupedSeat).toBeTruthy();
    expect(ungroupedSeat?.teamLabel?.trim() || "未分组").toBe("未分组");

    // Explicit empty department record for 未分组 (no seats with that literal label).
    store.organizationDepartments!["ungrouped-dept"] = {
      departmentId: "ungrouped-dept",
      tenantId: "acme",
      fullPath: "未分组",
      createdAt: "2026-06-12T08:11:10.000Z",
      updatedAt: "2026-06-12T08:11:10.000Z",
    };

    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: { action: "rename", path: "未分组", label: "测试组" },
      nowIso: "2026-06-12T08:11:20.000Z",
    });
    expect(result.fullPath).toBe("测试组");
    expect(store.seats[ungroupedSeat!.seatId]?.teamLabel).toBe("测试组");
    expect(result.affectedSeatIds).toContain(ungroupedSeat!.seatId);
    expect(store.organizationDepartments?.["ungrouped-dept"]?.fullPath).toBe("测试组");
  });

  it("still rejects deleting 未分组 as a structural change", () => {
    const store = createStore();
    ensureSeatForProvision({
      store,
      tenantId: "acme",
      seatTitle: "未分配顾问",
      nowIso: "2026-06-12T08:11:30.000Z",
    });
    expect(() =>
      applyOrganizationDepartmentMutation({
        store,
        tenantId: "acme",
        mutation: { action: "delete", path: "未分组" },
        nowIso: "2026-06-12T08:11:40.000Z",
      }),
    ).toThrow(/未分组部门不支持结构变更/);
  });

  it("moves a seat into another department", () => {
    const store = createStore();
    const seat = Object.values(store.seats).find((entry) => entry.title === "销售总监");
    expect(seat).toBeTruthy();
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: {
        action: "move-seat",
        seatId: seat!.seatId,
        targetPath: "运营部",
      },
      nowIso: "2026-06-12T08:12:00.000Z",
    });
    expect(result.fullPath).toBe("运营部");
    expect(store.seats[seat!.seatId]?.teamLabel).toBe("运营部");
  });

  it("rejects deleting departments that still contain seats", () => {
    const store = createStore();
    expect(() =>
      applyOrganizationDepartmentMutation({
        store,
        tenantId: "acme",
        mutation: { action: "delete", path: "销售部/华东区" },
        nowIso: "2026-06-12T08:13:00.000Z",
      }),
    ).toThrow(/仍有岗位/);
  });

  it("merges one department into another", () => {
    const store = createStore();
    ensureSeatForProvision({
      store,
      tenantId: "acme",
      seatTitle: "华南经理",
      teamLabel: "销售部/华南区",
      nowIso: "2026-06-12T08:14:00.000Z",
    });
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: {
        action: "merge",
        path: "销售部/华东区",
        targetPath: "销售部/华南区",
      },
      nowIso: "2026-06-12T08:15:00.000Z",
    });
    expect(result.fullPath).toBe("销售部/华南区");
    const eastSeat = Object.values(store.seats).find((entry) => entry.title === "销售总监");
    expect(eastSeat?.teamLabel).toBe("销售部/华南区");
  });

  it("syncs missing department structure paths", () => {
    const store = createStore();
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: {
        action: "sync-structure",
        paths: ["市场部/华东区/一组", "市场部"],
      },
      nowIso: "2026-06-12T08:16:00.000Z",
    });
    expect(result.createdPaths).toEqual(["市场部", "市场部/华东区", "市场部/华东区/一组"]);
    expect(listTenantOrganizationDepartmentPaths(store, "acme")).toContain("市场部/华东区/一组");
  });

  it("persists mixed child ordering under a parent department", () => {
    const store = createStore();
    applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: {
        action: "create",
        label: "一部",
        parentPath: "销售部",
      },
      nowIso: "2026-06-12T08:17:00.000Z",
    });
    ensureSeatForProvision({
      store,
      tenantId: "acme",
      seatTitle: "销售经理",
      teamLabel: "销售部",
      nowIso: "2026-06-12T08:17:00.000Z",
    });
    const managerSeatId = Object.values(store.seats).find(
      (entry) => entry.title === "销售经理",
    )?.seatId;
    expect(managerSeatId).toBeTruthy();
    applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: {
        action: "reorder-children",
        parentPath: "销售部",
        orderedKeys: [
          `seat:${managerSeatId}`,
          "department:销售部/一部",
          "department:销售部/华东区",
        ],
      },
      nowIso: "2026-06-12T08:18:00.000Z",
    });
    expect(store.organizationChildOrders?.["acme::销售部"]).toEqual([
      `seat:${managerSeatId}`,
      "department:销售部/一部",
      "department:销售部/华东区",
    ]);
  });

  it("keeps child order in sync when moving a seat between departments", () => {
    const store = createStore();
    const seatId = Object.values(store.seats).find((entry) => entry.title === "销售总监")?.seatId;
    expect(seatId).toBeTruthy();
    store.organizationChildOrders!["acme::销售部/华东区"] = [`seat:${seatId}`];
    applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: {
        action: "move-seat",
        seatId,
        targetPath: "运营部",
      },
      nowIso: "2026-06-12T08:18:00.000Z",
    });
    expect(store.organizationChildOrders?.["acme::销售部/华东区"]).toBeUndefined();
    expect(store.organizationChildOrders?.["acme::运营部"]).toEqual([`seat:${seatId}`]);
    expect(store.seats[seatId!].teamLabel).toBe("运营部");
  });

  it("deletes a vacant seat and removes it from child order", () => {
    const store = createStore();
    const seatId = Object.values(store.seats).find((entry) => entry.title === "运营经理")?.seatId;
    expect(seatId).toBeTruthy();
    store.organizationChildOrders!["acme::运营部"] = [`seat:${seatId}`];
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: { action: "delete-seat", seatId },
      nowIso: "2026-06-12T08:19:00.000Z",
    });
    expect(result.affectedSeatIds).toEqual([seatId]);
    expect(store.seats[seatId!]).toBeUndefined();
    expect(store.organizationChildOrders?.["acme::运营部"]).toBeUndefined();
    const deletedEvent = Object.values(store.auditEvents).find(
      (event) => event.eventType === "organization.seat_deleted",
    );
    expect(deletedEvent?.seatId).toBe(seatId);
  });

  it("rejects deleting an occupied seat", () => {
    const store = createStore();
    const seatId = Object.values(store.seats).find((entry) => entry.title === "运营经理")?.seatId;
    expect(seatId).toBeTruthy();
    store.seats[seatId!] = {
      ...store.seats[seatId!],
      status: "occupied",
      currentEmployeeId: "employee-1",
    };
    expect(() =>
      applyOrganizationDepartmentMutation({
        store,
        tenantId: "acme",
        mutation: { action: "delete-seat", seatId },
        nowIso: "2026-06-12T08:19:00.000Z",
      }),
    ).toThrow(/绑定成员|空岗|待激活/);
  });

  it("deletes an assigned pending-activation seat without a bound employee", () => {
    const store = createStore();
    const seatId = Object.values(store.seats).find((entry) => entry.title === "运营经理")?.seatId;
    expect(seatId).toBeTruthy();
    store.seats[seatId!] = {
      ...store.seats[seatId!],
      status: "assigned",
      currentEmployeeId: undefined,
    };
    store.organizationChildOrders!["acme::运营部"] = [`seat:${seatId}`];
    const result = applyOrganizationDepartmentMutation({
      store,
      tenantId: "acme",
      mutation: { action: "delete-seat", seatId },
      nowIso: "2026-06-12T08:20:00.000Z",
    });
    expect(result.affectedSeatIds).toEqual([seatId]);
    expect(store.seats[seatId!]).toBeUndefined();
  });
});
