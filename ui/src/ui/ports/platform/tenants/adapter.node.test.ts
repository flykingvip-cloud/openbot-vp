import { describe, expect, it } from "vitest";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import { buildPlatformTenantsVM } from "./adapter.ts";

function baseReadModel(
  enterprises: PlatformPortReadModel["enterpriseDirectory"],
): PlatformPortReadModel {
  return {
    currentTenantId: enterprises[0]?.tenantId ?? null,
    currentTenantLabel: enterprises[0]?.label ?? null,
    knownTenantIds: enterprises.map((e) => e.tenantId),
    tenantDirectory: enterprises.map((e) => ({ tenantId: e.tenantId, label: e.label })),
    enterpriseDirectory: enterprises,
    agentDirectory: [],
    agentCount: 0,
    featureMethodCount: 0,
    channelCount: 0,
    channelIds: [],
    accountCount: 0,
    connectedAccountCount: 0,
    presenceCount: 0,
    runtimeHosts: [],
    sessionsCount: 0,
    totalTokens: 0,
    totalCost: 0,
    missingCostEntries: 0,
    modelMode: "pool",
    configuredProviderCount: 0,
    providerIds: [],
    configuredModelCount: 0,
    configuredModelIds: [],
    installedCapabilityCount: 0,
    attentionItems: [],
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    hasUpdateAvailable: false,
    cronEnabled: false,
    cronNextAt: null,
    operatorUser: null,
    operatorRole: null,
  } as unknown as PlatformPortReadModel;
}

describe("buildPlatformTenantsVM admin-activation directory signals", () => {
  it("does not invent 管理员尚未激活 / 待激活 when seatUsed=0 but admin is activated", () => {
    const vm = buildPlatformTenantsVM(
      {
        readModel: baseReadModel([
          {
            tenantId: "jingshanzi",
            label: "京扇子",
            status: "paid",
            plan: "business",
            billingStatus: "active",
            createdSource: "self-service",
            seatQuota: 5,
            seatUsed: 0,
            seatsRemaining: 5,
            trialEndsAt: "2026-10-29T01:41:00.000Z",
            contact: {
              status: "activated",
              contactEmail: "23470484@qq.com",
              updatedAt: "2026-10-15T01:42:00.000Z",
            },
          },
        ]),
        basePath: "",
        pendingAdminActivations: [],
      },
      null,
    );
    const item = vm.directory.items[0];
    expect(item?.pendingTodoLabel).not.toBe("管理员尚未激活");
    expect(item?.stageLabel).not.toBe("待激活");
    expect(item?.hasPendingAction).toBe(false);
    expect(item?.updatedAtLabel).not.toMatch(/10\/29|10-29/);
    expect(item?.updatedAtLabel).toMatch(/10/);
  });

  it("marks pending admin from pendingAdminActivations (expired code)", () => {
    const vm = buildPlatformTenantsVM(
      {
        readModel: baseReadModel([
          {
            tenantId: "delta",
            label: "Delta",
            status: "trial",
            plan: "trial",
            billingStatus: "pending",
            createdSource: "platform-created",
            seatQuota: 5,
            seatUsed: 0,
            seatsRemaining: 5,
          },
        ]),
        basePath: "",
        pendingAdminActivations: [
          {
            provisionId: "prov-delta",
            enterpriseId: "delta",
            enterpriseName: "Delta",
            enterpriseStatus: "trial",
            adminEmail: "admin@delta.example",
            adminName: "Delta Admin",
            provisionCreatedAt: "2026-07-15T08:00:00.000Z",
            latestCodeStatus: "expired",
            latestCodeExpiresAt: "2026-07-16T08:00:00.000Z",
            needsResend: true,
          },
        ],
      },
      null,
    );
    const item = vm.directory.items[0];
    expect(item?.pendingTodoLabel).toBe("激活链接已过期");
    expect(item?.stageLabel).toBe("待激活");
    expect(item?.hasPendingAction).toBe(true);
  });

  it("marks pending admin from contact.status=pending_activation", () => {
    const vm = buildPlatformTenantsVM(
      {
        readModel: baseReadModel([
          {
            tenantId: "gamma",
            label: "Gamma",
            status: "paid",
            plan: "standard",
            billingStatus: "active",
            createdSource: "platform-created",
            seatQuota: 3,
            seatUsed: 1,
            seatsRemaining: 2,
            contact: { status: "pending_activation", contactEmail: "g@example.com" },
          },
        ]),
        basePath: "",
      },
      null,
    );
    const item = vm.directory.items[0];
    expect(item?.pendingTodoLabel).toBe("管理员尚未激活");
    expect(item?.stageLabel).toBe("待激活");
    expect(item?.hasPendingAction).toBe(true);
  });

  it("uses contact/usage updatedAt for formal tenants even when trialEndsAt remains", () => {
    const vm = buildPlatformTenantsVM(
      {
        readModel: baseReadModel([
          {
            tenantId: "formal",
            label: "Formal Co",
            status: "paid",
            plan: "business",
            billingStatus: "active",
            createdSource: "self-service",
            seatQuota: 5,
            seatUsed: 2,
            seatsRemaining: 3,
            trialEndsAt: "2026-04-21T00:00:00.000Z",
            contact: { updatedAt: "2026-09-18T10:00:00.000Z", status: "activated" },
          },
        ]),
        basePath: "",
      },
      null,
    );
    const item = vm.directory.items[0];
    expect(item?.updatedAtLabel).toMatch(/09/);
    expect(item?.updatedAtLabel).not.toMatch(/04\/21|04-21/);
  });
});
