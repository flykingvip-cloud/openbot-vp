// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listOperationalIdentityAccessForSeatAgent } from "./enterprise-operational-identity-access.js";
import {
  findEmployeeEnterpriseIdentityEnrollment,
  listEmployeeEnterpriseIdentityEnrollments,
  listEnterpriseIdentityEnrollmentsForAgent,
  listEmployeeIdentityBindingActivity,
  registerEnterpriseIdentity,
  removeEmployeeEnterpriseIdentityEnrollment,
  upsertIdentityUsagePolicy,
  upsertEmployeeEnterpriseIdentityEnrollment,
} from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

const NOW = "2026-06-06T12:00:00.000Z";

function seedPermittedIdentity(store: EnterpriseSeatAssetsStore): string {
  store.seats["seat-1"] = {
    seatId: "seat-1",
    tenantId: "acme",
    title: "Ops",
    status: "occupied",
    defaultSpaceIds: [],
    defaultAgentAssetIds: ["agent-1"],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const credential = registerConnectorCredentialBinding({
    store,
    tenantId: "acme",
    connectorId: "wechat-official",
    ownerType: "seat",
    ownerId: "seat-1",
    nowIso: NOW,
  });
  const identity = registerEnterpriseIdentity({
    store,
    tenantId: "acme",
    displayName: "Feishu Bot",
    credentialBindingId: credential.credentialBindingId,
    nowIso: NOW,
  });
  if (!identity.ok) {
    throw new Error("failed to register identity");
  }
  upsertIdentityUsagePolicy({
    store,
    tenantId: "acme",
    identityId: identity.identity.identityId,
    seatIds: ["seat-1"],
    allowedAgentIds: [],
    allowedActions: ["publish_article"],
    nowIso: NOW,
  });
  return identity.identity.identityId;
}

describe("employee-domain enterprise identity enrollment", () => {
  it("enrolls an enterprise identity permitted by policy and lists it for the agent", () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    const identityId = seedPermittedIdentity(store);

    // The identity is in the seat allowed set (policy boundary).
    const permitted = listOperationalIdentityAccessForSeatAgent({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      nowIso: NOW,
    });
    expect(permitted.some((entry) => entry.identityId === identityId)).toBe(true);

    const enrollment = upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article"],
      nowIso: NOW,
    });
    expect(enrollment.identityId).toBe(identityId);

    const listed = listEmployeeEnterpriseIdentityEnrollments(store, {
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
    });
    expect(listed.map((entry) => entry.identityId)).toEqual([identityId]);
    expect(
      listEnterpriseIdentityEnrollmentsForAgent(store, { agentId: "agent-1" }).map(
        (entry) => entry.identityId,
      ),
    ).toEqual([identityId]);
    expect(listEnterpriseIdentityEnrollmentsForAgent(store, { agentId: "other" })).toEqual([]);
    expect(
      Object.values(store.auditEvents).some((event) => event.eventType === "identity.bound"),
    ).toBe(true);
  });

  it("is idempotent on re-enroll and supports revoke", () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    const identityId = seedPermittedIdentity(store);

    const first = upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article"],
      nowIso: NOW,
    });
    const second = upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article"],
      nowIso: "2026-06-07T00:00:00.000Z",
    });
    // Same logical enrollment is reused, not duplicated.
    expect(second.enrollmentId).toBe(first.enrollmentId);
    expect(Object.keys(store.employeeIdentityEnrollments)).toHaveLength(1);

    const removed = removeEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      nowIso: NOW,
    });
    expect(removed).toBe(true);
    const revoked = findEmployeeEnterpriseIdentityEnrollment(store, {
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
    });
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.enrollmentId).toBe(first.enrollmentId);
    expect(
      Object.values(store.auditEvents).some(
        (event) => event.eventType === "identity.unbound" && event.metadata?.status === "revoked",
      ),
    ).toBe(true);
  });

  it("scopes enrollments by employee and agent", () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    const identityId = seedPermittedIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article"],
      nowIso: NOW,
    });
    // A different employee sees no enrollment.
    expect(
      listEmployeeEnterpriseIdentityEnrollments(store, {
        tenantId: "acme",
        employeeId: "emp-2",
        agentId: "agent-1",
      }),
    ).toHaveLength(0);
    // A different agent of the same employee sees no enrollment.
    expect(
      listEmployeeEnterpriseIdentityEnrollments(store, {
        tenantId: "acme",
        employeeId: "emp-1",
        agentId: "agent-2",
      }),
    ).toHaveLength(0);
  });

  it("records binding activity for enterprise admin feed", () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    const identityId = seedPermittedIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article"],
      nowIso: NOW,
    });
    const activity = listEmployeeIdentityBindingActivity(store, "acme");
    expect(activity.some((event) => event.eventType === "identity.bound")).toBe(true);
  });
});
