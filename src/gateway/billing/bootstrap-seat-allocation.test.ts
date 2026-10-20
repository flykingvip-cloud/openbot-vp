// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { saveEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { upsertEnterpriseModelEntitlement } from "../model-entitlement/enterprise-model-entitlement-store.js";
import { setModelGrant } from "../model-entitlement/seat-model-grant-store.js";
import { bootstrapBillingSeatsFromOrganization } from "./bootstrap-seat-allocation.js";
import { extractRoleCodePrefix, resolveSeatRoleFromRoleCode } from "./seat-role-prefix-rules.js";
import { __resetSeatsForTest, assignSeat } from "./seats-store.js";

describe("seat-role-prefix-rules", () => {
  it("maps FIN role codes to viewer", () => {
    expect(extractRoleCodePrefix("FIN-L1-001")).toBe("FIN");
    expect(resolveSeatRoleFromRoleCode("FIN-L1-001")).toBe("viewer");
  });

  it("maps SALES role codes to creator", () => {
    expect(resolveSeatRoleFromRoleCode("SALES-001")).toBe("creator");
  });
});

describe("bootstrapBillingSeatsFromOrganization", () => {
  let tempDir = "";
  let seatsPath = "";
  let entitlementPath = "";
  let grantPath = "";
  let authPath = "";
  let seatAssetsPath = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seat-bootstrap-"));
    seatsPath = path.join(tempDir, "seats.json");
    entitlementPath = path.join(tempDir, "ent.json");
    grantPath = path.join(tempDir, "grant.json");
    authPath = path.join(tempDir, "auth.json");
    seatAssetsPath = path.join(tempDir, "seat-assets.json");
    await writeJsonAtomic(seatsPath, { version: 1, seats: {}, history: [] });
    void __resetSeatsForTest(seatsPath);
  });

  afterEach(async () => {
    void __resetSeatsForTest();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedAuthAndOrg() {
    await writeJsonAtomic(authPath, {
      version: 5,
      secret: "test-secret",
      enterprises: {
        "001": {
          id: "001",
          name: "upbeyond",
          slug: "upbeyond",
          status: "paid",
          plan: "legacy",
          billingStatus: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          seatQuota: 10,
          seatUsed: 0,
        },
      },
      users: {
        "admin-user": {
          id: "admin-user",
          email: "admin@example.com",
          normalizedEmail: "admin@example.com",
          displayName: "Admin",
          passwordHash: "x",
          status: "active",
          source: "legacy",
          role: "operator",
          scopes: ["operator.admin"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        "sales-user": {
          id: "sales-user",
          email: "sales@example.com",
          normalizedEmail: "sales@example.com",
          displayName: "Sales",
          passwordHash: "x",
          status: "active",
          source: "legacy",
          role: "operator",
          scopes: ["operator.admin"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      memberships: {
        m1: {
          id: "m1",
          userId: "admin-user",
          enterpriseId: "001",
          membershipRole: "enterprise-admin",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        m2: {
          id: "m2",
          userId: "sales-user",
          enterpriseId: "001",
          membershipRole: "member",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      employeeProvisions: {},
      adminProvisions: {},
      activationCodes: {},
      trialApplications: {},
      leadNotifications: {},
      sessions: {},
    });

    const seatStore: EnterpriseSeatAssetsStore = {
      version: 1,
      seats: {
        "org-seat-1": {
          seatId: "org-seat-1",
          tenantId: "001",
          title: "销售经理",
          roleCode: "SALES-001",
          status: "occupied",
          currentEmployeeId: "sales-user",
          defaultAgentAssetIds: [],
          defaultSpaceIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      bindings: {},
      offers: {},
      handovers: {},
      assetBindings: {},
      accessPolicies: {},
      credentialBindings: {},
      auditEvents: {},
      enterpriseIdentities: {},
      identityUsagePolicies: {},
      dataSourceIdentityBindings: {},
      employeeIdentityEnrollments: {},
    };
    await saveEnterpriseSeatAssetsStore(seatAssetsPath, seatStore);

    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "001",
        allowedModelIds: ["ollama/llama3.2"],
        planVersionId: "pv-test",
      },
      entitlementPath,
    );
    await setModelGrant(
      {
        tenantId: "001",
        subjectType: "seat",
        subjectId: "placeholder",
        seatId: "placeholder",
        grantedModelIds: ["ollama/llama3.2"],
      },
      grantPath,
    );
  }

  it("auto-assigns billing seats for org members without existing seats", async () => {
    await seedAuthAndOrg();
    process.env.OPENBOT_CONFIG_PATH = path.join(tempDir, "openclaw.json");
    await writeJsonAtomic(process.env.OPENBOT_CONFIG_PATH, {
      gateway: {
        auth: {
          trustedProxy: {
            userHeader: "x-forwarded-user",
            platformAuth: { enabled: true, store: authPath },
          },
        },
      },
    });

    const result = await bootstrapBillingSeatsFromOrganization({
      enterpriseId: "001",
      planVersionId: "pv-test",
      seatsStorePath: seatsPath,
      seatAssetsStorePath: seatAssetsPath,
      entitlementStorePath: entitlementPath,
      seatGrantStorePath: grantPath,
      platformAuthStorePath: authPath,
    });

    expect(result.orgReady).toBe(true);
    expect(result.assigned).toBe(2);
    expect(result.results.map((row) => row.userEmail).toSorted()).toEqual([
      "admin@example.com",
      "sales@example.com",
    ]);
    const sales = result.results.find((row) => row.userEmail === "sales@example.com");
    expect(sales?.role).toBe("creator");
    const admin = result.results.find((row) => row.userEmail === "admin@example.com");
    expect(admin?.role).toBe("admin");
  });

  it("skips members who already have billing seats", async () => {
    await seedAuthAndOrg();
    process.env.OPENBOT_CONFIG_PATH = path.join(tempDir, "openclaw.json");
    await writeJsonAtomic(process.env.OPENBOT_CONFIG_PATH, {
      gateway: {
        auth: {
          trustedProxy: {
            userHeader: "x-forwarded-user",
            platformAuth: { enabled: true, store: authPath },
          },
        },
      },
    });
    await assignSeat(
      { enterpriseId: "001", userId: "admin@example.com", role: "admin", botQuota: 0 },
      seatsPath,
    );

    const result = await bootstrapBillingSeatsFromOrganization({
      enterpriseId: "001",
      planVersionId: "pv-test",
      seatsStorePath: seatsPath,
      seatAssetsStorePath: seatAssetsPath,
      entitlementStorePath: entitlementPath,
      seatGrantStorePath: grantPath,
      platformAuthStorePath: authPath,
    });

    expect(result.assigned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedDetails[0]?.userEmail).toBe("admin@example.com");
  });
});
