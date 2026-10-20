import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnterpriseDataStore } from "./enterprise-data/store.js";
import { validateIdentityUsagePolicyInput } from "./enterprise-operational-identity-policy.js";
import {
  isSupportedOperationalIdentityConnectorId,
  probeOperationalIdentityCredentialStatus,
  resolveUnsupportedOperationalIdentityConnectorMessage,
} from "./enterprise-operational-identity-providers.js";
import {
  resolveEnterpriseIdentityStewardLabel,
  registerEnterpriseIdentity,
  upsertIdentityUsagePolicy,
} from "./enterprise-operational-identity-store.js";
import { listEligibleOperationalIdentityDataSources } from "./enterprise-operational-identity.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

function createTestStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

describe("enterprise operational identity", () => {
  it("registers identity against existing credential binding without duplicating credentials", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T00:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops Lead",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });

    const result = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Acme Mail Bot",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.credentialBindingId).toBe(credential.credentialBindingId);
    expect(Object.keys(store.credentialBindings)).toHaveLength(1);
    expect(
      Object.values(store.auditEvents).some((event) => event.eventType === "identity.registered"),
    ).toBe(true);
  });

  it("rejects identity usage policy without seatIds", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T00:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops Lead",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "WeChat Official",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }

    const validation = validateIdentityUsagePolicyInput({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      provider: identity.identity.provider,
      seatIds: [],
      allowedAgentIds: ["agent-1"],
      allowedActions: ["publish_article"],
    });
    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.code).toBe("ENTERPRISE_IDENTITY_SEAT_REQUIRED");

    const policyResult = upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      seatIds: [],
      allowedAgentIds: ["agent-1"],
      allowedActions: ["publish_article"],
      nowIso,
    });
    expect(policyResult.ok).toBe(false);
  });

  it("rejects cross-tenant credential binding during identity registration", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T00:00:00.000Z";
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "other-tenant",
      connectorId: "weibo",
      ownerType: "seat",
      ownerId: "seat-x",
      nowIso,
    });
    const result = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Wrong Tenant",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("ENTERPRISE_IDENTITY_CREDENTIAL_NOT_FOUND");
  });

  it("maps provider credential status to identity status", () => {
    expect(isSupportedOperationalIdentityConnectorId("enterprise-email")).toBe(false);
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("enterprise-email")).toContain(
      "员工端",
    );
    expect(isSupportedOperationalIdentityConnectorId("feishu")).toBe(false);
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("feishu")).toContain("MCP");
    expect(isSupportedOperationalIdentityConnectorId("unknown-provider")).toBe(false);
    expect(
      probeOperationalIdentityCredentialStatus({
        credential: {
          credentialBindingId: randomUUID(),
          tenantId: "acme",
          connectorId: "enterprise-email",
          ownerType: "seat",
          ownerId: "seat-1",
          status: "reauthorization_required",
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
        nowIso: "2026-06-06T00:00:00.000Z",
      }),
    ).toBe("reauth_required");
  });

  it("seeds eligible data sources for a new tenant before listing identity bindings", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openbot-operational-identity-"));
    const storePath = path.join(tempDir, "enterprise-data.json");
    try {
      const sources = await listEligibleOperationalIdentityDataSources({
        tenantId: "acme",
        nowIso: "2026-06-06T00:00:00.000Z",
        storePath,
      });
      expect(sources.length).toBeGreaterThan(0);
      const store = await loadEnterpriseDataStore(storePath);
      expect(Object.keys(store.dataSources).length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves steward labels from platform user ids instead of raw uuids", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T00:00:00.000Z";
    const employeeId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "市场负责人",
      status: "occupied",
      currentEmployeeId: employeeId,
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const userLabelById = new Map([
      [employeeId, { displayName: "Daniel", email: "admin@example.com" }],
    ]);
    expect(
      resolveEnterpriseIdentityStewardLabel({
        store,
        tenantId: "acme",
        steward: { kind: "employee", ownerId: employeeId },
        userLabelById,
      }),
    ).toEqual({
      kind: "employee",
      label: "Daniel",
      detail: "保存凭证的企业成员（admin@example.com）",
    });
    expect(
      resolveEnterpriseIdentityStewardLabel({
        store,
        tenantId: "acme",
        steward: { kind: "seat", ownerId: "seat-1" },
        userLabelById,
      }).label,
    ).toBe("市场负责人 · Daniel");
  });
});
