import { describe, expect, it } from "vitest";
import type { ControlUiPlatformPendingAdminActivationSummary } from "../control-ui-contract.js";
import { buildPlatformPendingAdminActivationsView } from "./session-context.js";
import type {
  PlatformAuthActivationCode,
  PlatformAuthEnterprise,
  PlatformAuthEnterpriseAdminProvision,
  PlatformAuthStore,
} from "./store-types.js";

function emptyStore(): PlatformAuthStore {
  return {
    version: 5,
    secret: "test-secret",
    policy: {
      defaultTrialDays: 14,
      allowedTrialDays: [14],
      defaultTrialSeatCount: 5,
      trialSeatOptions: [5],
      allowCustomTrialSeatCount: true,
      trialExpiryPolicy: "choose",
      trialExpiryHandling: "auto_stop",
      trialGraceDays: 0,
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    enterprises: {},
    users: {},
    memberships: {},
    sessions: {},
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  } as PlatformAuthStore;
}

function enterprise(partial: Partial<PlatformAuthEnterprise> & Pick<PlatformAuthEnterprise, "id">) {
  return {
    name: partial.name ?? partial.id,
    slug: partial.slug ?? partial.id,
    status: partial.status ?? "trial",
    plan: partial.plan ?? "trial",
    createdSource: partial.createdSource ?? "self-service",
    creationMode: partial.creationMode ?? "quick-trial",
    lifecycleStage: partial.lifecycleStage ?? "trial_onboarding",
    billingStatus: partial.billingStatus ?? "trialing",
    createdAt: partial.createdAt ?? "2026-07-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-07-01T00:00:00.000Z",
    trialStartedAt: partial.trialStartedAt ?? "2026-07-01T00:00:00.000Z",
    trialEndsAt: partial.trialEndsAt ?? "2026-07-20T00:00:00.000Z",
    trialDaysSnapshot: partial.trialDaysSnapshot ?? 14,
    seatQuota: partial.seatQuota ?? 5,
    seatUsed: partial.seatUsed ?? 0,
    allowReadOnlyAfterExpiry: partial.allowReadOnlyAfterExpiry ?? true,
    ...partial,
  } satisfies PlatformAuthEnterprise;
}

function provision(
  partial: Partial<PlatformAuthEnterpriseAdminProvision> &
    Pick<PlatformAuthEnterpriseAdminProvision, "id" | "enterpriseId">,
) {
  const email = partial.adminEmail ?? `admin@${partial.enterpriseId}.example`;
  return {
    adminName: partial.adminName ?? "Admin",
    adminEmail: email,
    normalizedAdminEmail: partial.normalizedAdminEmail ?? email.toLowerCase(),
    status: partial.status ?? "pending_activation",
    createdAt: partial.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-07-10T00:00:00.000Z",
    ...partial,
  } satisfies PlatformAuthEnterpriseAdminProvision;
}

function activationCode(
  partial: Partial<PlatformAuthActivationCode> & Pick<PlatformAuthActivationCode, "id">,
) {
  const email = partial.email ?? "admin@example.com";
  return {
    email,
    normalizedEmail: partial.normalizedEmail ?? email.toLowerCase(),
    codeHash: partial.codeHash ?? "hash",
    displayCode: partial.displayCode ?? "ADMIN-SECRET",
    codeType: partial.codeType ?? "enterpriseAdminActivation",
    status: partial.status ?? "active",
    attemptCount: partial.attemptCount ?? 0,
    maxAttempts: partial.maxAttempts ?? 8,
    deliveryChannel: partial.deliveryChannel ?? "email",
    createdAt: partial.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-07-10T00:00:00.000Z",
    expiresAt: partial.expiresAt ?? "2026-07-20T00:00:00.000Z",
    ...partial,
  } satisfies PlatformAuthActivationCode;
}

describe("buildPlatformPendingAdminActivationsView", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");

  it("filters out activated provisions and missing enterprises", () => {
    const store = emptyStore();
    store.enterprises["acme"] = enterprise({ id: "acme", name: "Acme" });
    store.adminProvisions["prov-pending"] = provision({
      id: "prov-pending",
      enterpriseId: "acme",
      createdAt: "2026-07-12T00:00:00.000Z",
    });
    store.adminProvisions["prov-activated"] = provision({
      id: "prov-activated",
      enterpriseId: "acme",
      status: "activated",
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    store.adminProvisions["prov-orphan"] = provision({
      id: "prov-orphan",
      enterpriseId: "missing",
      createdAt: "2026-07-13T00:00:00.000Z",
    });

    const rows = buildPlatformPendingAdminActivationsView(store, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provisionId).toBe("prov-pending");
    expect(rows[0]?.enterpriseName).toBe("Acme");
    expect(rows[0]?.latestCodeStatus).toBeUndefined();
    expect(rows[0]?.needsResend).toBe(true);
    expect(rows[0]).not.toHaveProperty("latestDisplayCode");
  });

  it("selects the latest activation code and never exposes displayCode", () => {
    const store = emptyStore();
    store.enterprises["delta"] = enterprise({ id: "delta", name: "Delta" });
    store.adminProvisions["prov-delta"] = provision({
      id: "prov-delta",
      enterpriseId: "delta",
      adminEmail: "admin@delta.example",
      normalizedAdminEmail: "admin@delta.example",
    });
    store.activationCodes["old"] = activationCode({
      id: "old",
      provisionId: "prov-delta",
      enterpriseId: "delta",
      email: "admin@delta.example",
      normalizedEmail: "admin@delta.example",
      displayCode: "ADMIN-OLD",
      status: "expired",
      createdAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2026-07-11T00:00:00.000Z",
    });
    store.activationCodes["latest"] = activationCode({
      id: "latest",
      provisionId: "prov-delta",
      enterpriseId: "delta",
      email: "admin@delta.example",
      normalizedEmail: "admin@delta.example",
      displayCode: "ADMIN-SECRET",
      status: "active",
      createdAt: "2026-07-16T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
    });

    const rows = buildPlatformPendingAdminActivationsView(store, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.latestCodeStatus).toBe("active");
    expect(rows[0]?.latestCodeExpiresAt).toBe("2026-07-25T00:00:00.000Z");
    expect(rows[0]?.needsResend).toBe(false);
    expect(JSON.stringify(rows[0])).not.toContain("ADMIN-SECRET");
    expect(JSON.stringify(rows[0])).not.toContain("displayCode");
    expect(rows[0]).not.toHaveProperty("latestDisplayCode");
  });

  it("marks expired, revoked, missing, and near-expiry codes as needing resend", () => {
    const store = emptyStore();
    for (const id of ["exp", "rev", "none", "near", "ok"] as const) {
      store.enterprises[id] = enterprise({ id, name: id });
      store.adminProvisions[`prov-${id}`] = provision({
        id: `prov-${id}`,
        enterpriseId: id,
        adminEmail: `admin@${id}.example`,
        normalizedAdminEmail: `admin@${id}.example`,
        createdAt: `2026-07-1${id === "ok" ? "0" : "5"}T00:00:00.000Z`,
      });
    }

    store.activationCodes["c-exp"] = activationCode({
      id: "c-exp",
      provisionId: "prov-exp",
      enterpriseId: "exp",
      email: "admin@exp.example",
      normalizedEmail: "admin@exp.example",
      status: "active",
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-07-17T00:00:00.000Z",
    });
    store.activationCodes["c-rev"] = activationCode({
      id: "c-rev",
      provisionId: "prov-rev",
      enterpriseId: "rev",
      email: "admin@rev.example",
      normalizedEmail: "admin@rev.example",
      status: "revoked",
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
      revokedAt: "2026-07-16T00:00:00.000Z",
    });
    store.activationCodes["c-near"] = activationCode({
      id: "c-near",
      provisionId: "prov-near",
      enterpriseId: "near",
      email: "admin@near.example",
      normalizedEmail: "admin@near.example",
      status: "active",
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-07-18T20:00:00.000Z",
    });
    store.activationCodes["c-ok"] = activationCode({
      id: "c-ok",
      provisionId: "prov-ok",
      enterpriseId: "ok",
      email: "admin@ok.example",
      normalizedEmail: "admin@ok.example",
      status: "active",
      createdAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
    });

    const rows = buildPlatformPendingAdminActivationsView(store, now);
    const byEnterprise = Object.fromEntries(
      rows.map((row: ControlUiPlatformPendingAdminActivationSummary) => [row.enterpriseId, row]),
    );

    expect(byEnterprise.exp?.latestCodeStatus).toBe("expired");
    expect(byEnterprise.exp?.needsResend).toBe(true);

    expect(byEnterprise.rev?.latestCodeStatus).toBe("revoked");
    expect(byEnterprise.rev?.needsResend).toBe(true);

    expect(byEnterprise.none?.latestCodeStatus).toBeUndefined();
    expect(byEnterprise.none?.needsResend).toBe(true);

    expect(byEnterprise.near?.latestCodeStatus).toBe("active");
    expect(byEnterprise.near?.needsResend).toBe(true);

    expect(byEnterprise.ok?.latestCodeStatus).toBe("active");
    expect(byEnterprise.ok?.needsResend).toBe(false);

    // needsResend rows sort ahead of healthy pending rows.
    expect(
      rows
        .map((row: ControlUiPlatformPendingAdminActivationSummary) => row.enterpriseId)
        .slice(0, 4),
    ).toEqual(expect.arrayContaining(["exp", "rev", "none", "near"]));
    expect(rows.at(-1)?.enterpriseId).toBe("ok");
  });
});
