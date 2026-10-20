import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAuthStore } from "./store-types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-ent-provision-entitle-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { createEnterpriseWithPendingAdminActivation } = await import("./enterprise-provisioning.js");
const { getTenantPackEntitlement } =
  await import("../capability-packs/tenant-pack-entitlements.js");

function emptyStore(): PlatformAuthStore {
  const now = new Date().toISOString();
  return {
    version: 5,
    secret: "test-secret",
    policy: {
      defaultTrialDays: 14,
      allowedTrialDays: [14],
      defaultTrialSeatCount: 5,
      trialSeatOptions: [5],
      allowCustomTrialSeatCount: false,
      trialExpiryPolicy: "choose",
      trialExpiryHandling: "auto_stop",
      trialGraceDays: 0,
      updatedAt: now,
    },
    enterprises: {},
    users: {},
    sessions: {},
    memberships: {},
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    invitations: {},
    auditEvents: [],
    trialApplications: {},
    leadNotifications: {},
  } as PlatformAuthStore;
}

describe("enterprise provisioning pack entitlement", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const gov = path.join(tmpDir, "governance");
    if (fs.existsSync(gov)) {
      fs.rmSync(gov, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("auto-entitles starter + cn-office when creating a trial enterprise", () => {
    const store = emptyStore();
    const { enterprise } = createEnterpriseWithPendingAdminActivation({
      config: { enabled: true, activationTtlHours: 72 } as never,
      store,
      enterpriseName: "Smoke Co",
      adminName: "Admin",
      adminEmail: "admin@smoke.example",
      createdSource: "self-service",
      creationMode: "quick-trial",
    });

    const entitlement = getTenantPackEntitlement(enterprise.id);
    expect(entitlement?.packIds).toEqual(["starter", "cn-office"]);
    expect(entitlement?.source).toBe("auto-provision");
  });
});
