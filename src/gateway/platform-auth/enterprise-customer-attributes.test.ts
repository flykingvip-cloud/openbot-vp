import { describe, expect, it } from "vitest";
import {
  buildEnterpriseCustomerAttributes,
  classifyEmailKind,
  computeTrialDaysRemaining,
  deriveEnterpriseSegmentHints,
} from "./enterprise-customer-attributes.js";
import type { PlatformAuthStore } from "./store-types.js";

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

describe("enterprise-customer-attributes", () => {
  it("classifies free vs enterprise email domains", () => {
    expect(classifyEmailKind("a@gmail.com")).toBe("free");
    expect(classifyEmailKind("ops@acme.co")).toBe("enterprise");
    expect(classifyEmailKind("bad")).toBe("unknown");
  });

  it("computes trial days remaining", () => {
    const now = Date.parse("2026-07-13T00:00:00.000Z");
    expect(
      computeTrialDaysRemaining({ status: "trial", trialEndsAt: "2026-07-20T00:00:00.000Z" }, now),
    ).toBe(7);
    expect(computeTrialDaysRemaining({ status: "paid" }, now)).toBeNull();
  });

  it("builds a stable agent-readable summary with segment hints", () => {
    const store = emptyStore();
    store.enterprises["acme-1"] = {
      id: "acme-1",
      name: "Acme",
      slug: "acme",
      status: "trial",
      plan: "trial",
      createdSource: "self-service",
      creationMode: "quick-trial",
      lifecycleStage: "trial_onboarding",
      billingStatus: "trialing",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      trialStartedAt: "2026-07-01T00:00:00.000Z",
      trialEndsAt: "2026-07-20T00:00:00.000Z",
      trialDaysSnapshot: 14,
      seatQuota: 5,
      seatUsed: 1,
      allowReadOnlyAfterExpiry: true,
    };
    store.trialApplications["app-1"] = {
      id: "app-1",
      companyName: "Acme",
      contactName: "Ada",
      workEmail: "ada@acme.co",
      normalizedWorkEmail: "ada@acme.co",
      expectedUsers: 12,
      useCase: "ops automation",
      needsDemo: false,
      mode: "auto",
      highIntentLead: false,
      reviewReasons: [],
      status: "converted",
      enterpriseId: "acme-1",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    store.adminProvisions["prov-1"] = {
      id: "prov-1",
      enterpriseId: "acme-1",
      adminName: "Ada",
      adminEmail: "ada@acme.co",
      normalizedAdminEmail: "ada@acme.co",
      status: "pending_activation",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    const nowMs = Date.parse("2026-07-13T00:00:00.000Z");
    const attrs = buildEnterpriseCustomerAttributes({
      store,
      enterpriseId: "acme-1",
      nowMs,
    });
    expect(attrs).not.toBeNull();
    expect(attrs?.schemaVersion).toBe(1);
    expect(attrs?.enterprise.id).toBe("acme-1");
    expect(attrs?.enterprise.trial.daysRemaining).toBe(7);
    expect(attrs?.contact?.email).toBe("ada@acme.co");
    expect(attrs?.contact?.activated).toBe(false);
    expect(attrs?.contact?.emailKind).toBe("enterprise");
    expect(attrs?.application?.mode).toBe("auto");
    expect(attrs?.segmentHints).toEqual(
      expect.arrayContaining([
        "status:trial",
        "source:self-service",
        "email:enterprise",
        "team:small",
        "apply_mode:auto",
        "trial_window:mid",
      ]),
    );
  });

  it("marks high-intent and free-email hints from application fields", () => {
    const hints = deriveEnterpriseSegmentHints({
      enterprise: {
        id: "x",
        name: "Big Co",
        slug: "big",
        status: "trial",
        plan: "trial",
        createdSource: "self-service",
        billingStatus: "trialing",
        createdAt: "",
        updatedAt: "",
        seatQuota: 10,
        seatUsed: 0,
      },
      application: {
        id: "a",
        companyName: "Big Co",
        contactName: "Bob",
        workEmail: "bob@gmail.com",
        normalizedWorkEmail: "bob@gmail.com",
        expectedUsers: 80,
        useCase: "demo",
        needsDemo: true,
        mode: "manual",
        highIntentLead: true,
        reviewReasons: ["free_email", "large_team"],
        status: "pending",
        createdAt: "",
        updatedAt: "",
      },
      contactEmail: "bob@gmail.com",
      daysRemaining: 2,
    });
    expect(hints).toEqual(
      expect.arrayContaining([
        "email:free",
        "team:large",
        "intent:high",
        "needs_demo",
        "apply_mode:manual",
        "trial_window:late",
        "review:free_email",
        "review:large_team",
      ]),
    );
  });

  it("returns null for unknown enterprise", () => {
    expect(
      buildEnterpriseCustomerAttributes({ store: emptyStore(), enterpriseId: "missing" }),
    ).toBeNull();
  });
});
