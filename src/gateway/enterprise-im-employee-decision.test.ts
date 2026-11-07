import { describe, expect, it } from "vitest";
import {
  bindFeishuEmployeeConnection,
  type FeishuEmployeeChannelGate,
} from "./enterprise-im-employee-connection.js";
import {
  confirmEnterpriseImRobotGrant,
  decideEnterpriseImEmployeeProxy,
  executeEnterpriseImEmployeeProxy,
} from "./enterprise-im-employee-decision.js";
import { resolveUserOperationalIdentity } from "./user-operational-identity-access.js";
import { resolveEmployeeOperationalAuthorization } from "./user-operational-identity-enterprise-authorization.js";
import { revokeUserOperationalIdentityGrant } from "./user-operational-identity-store.js";
import type {
  UserOperationalIdentityCredentialSecretStore,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const openGate: FeishuEmployeeChannelGate = {
  accountId: "t_001_default",
  employeeUiHint: "app_can_attempt",
  loginEnabled: true,
  statusLabel: "可绑定",
  platformEnterpriseId: "tenant-key-1",
  childExecutionBlocked: false,
};
const seat = { kind: "present" as const, policyPresent: true };
const now = "2026-11-07T00:00:00.000Z";

function emptyStore(): UserOperationalIdentityStore {
  return {
    version: 5,
    identities: {},
    grants: {},
    bindingRequests: {},
    usageEvents: {},
    lifecycleEvents: {},
    continuations: {},
    credentialHandles: {},
    oauthSessions: {},
  };
}

function boundIdentity() {
  const store = emptyStore();
  const secrets: UserOperationalIdentityCredentialSecretStore = { version: 1, secrets: {} };
  const bound = bindFeishuEmployeeConnection({
    store,
    secretStore: secrets,
    ownerId: "emp-a",
    tenantId: "001",
    gate: openGate,
    nowIso: now,
    observation: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      openId: "ou_a",
      tenantKey: "tenant-key-1",
      scopeNames: ["offline_access", "im:message"],
    },
  });
  return { store, secrets, identityId: bound.identityId! };
}

function resolve(
  store: UserOperationalIdentityStore,
  agentId: string,
  action: string,
  identityId?: string,
) {
  return resolveUserOperationalIdentity({
    store,
    provider: "feishu-personal",
    action,
    currentUserId: "emp-a",
    currentAgentId: agentId,
    nowIso: now,
    enterpriseImIdentityId: identityId,
    enterpriseImGate: openGate,
    enterpriseImSeat: seat,
  });
}

describe("enterprise IM robot delegation (slice 2)", () => {
  it("refuses an owned robot with no confirm and does not write a grant", () => {
    const { store, identityId } = boundIdentity();
    const before = Object.keys(store.grants).length;
    const resolved = resolve(store, "bot-owned", "read", identityId);
    const executed = executeEnterpriseImEmployeeProxy({
      store,
      ownerId: "emp-a",
      agentId: "bot-owned",
      action: "read",
      identityId,
      gate: openGate,
      seat,
      nowIso: now,
    });
    expect(resolved.allowed).toBe(false);
    expect(executed.outcome).toBe("deny");
    expect(Object.keys(store.grants)).toHaveLength(before);
    expect(JSON.stringify(resolved)).not.toContain("access-secret");
    expect(JSON.stringify(executed)).not.toContain("refresh-secret");
  });

  it("allows only the confirmed robot and action", () => {
    const { store, identityId } = boundIdentity();
    const confirmed = confirmEnterpriseImRobotGrant({
      store,
      ownerId: "emp-a",
      identityId,
      agentId: "bot-a",
      agentScope: "owned",
      allowedActions: ["read"],
      gate: openGate,
      nowIso: now,
    });
    expect(confirmed).toMatchObject({ ok: true });
    expect(resolve(store, "bot-a", "read", identityId).allowed).toBe(true);
    expect(resolve(store, "bot-b", "read", identityId).allowed).toBe(false);
    expect(resolve(store, "bot-a", "send", identityId).allowed).toBe(false);
    expect(store.identities[identityId]?.enterpriseIm?.userGrantedScopes).toEqual([
      "offline_access",
      "im:message",
    ]);
  });

  it("does not auto-create a grant after revoke", () => {
    const { store, identityId } = boundIdentity();
    const confirmed = confirmEnterpriseImRobotGrant({
      store,
      ownerId: "emp-a",
      identityId,
      agentId: "bot-a",
      agentScope: "owned",
      allowedActions: ["read"],
      gate: openGate,
      nowIso: now,
    });
    if (!("grant" in confirmed)) {
      throw new Error("confirm failed");
    }
    revokeUserOperationalIdentityGrant({
      store,
      ownerId: "emp-a",
      grantId: confirmed.grant.grantId,
      nowIso: now,
    });
    const before = Object.keys(store.grants).length;
    const resolved = resolve(store, "bot-a", "read", identityId);
    expect(resolved.allowed).toBe(false);
    if (!resolved.allowed) {
      expect(resolved.code).toBe("DELEGATION_MISSING");
    }
    expect(Object.keys(store.grants)).toHaveLength(before);
    expect(Object.values(store.grants).some((grant) => grant.grantMode === "auto")).toBe(false);
  });

  it("does not reuse the no-seat compatibility allow", () => {
    const compat = resolveEmployeeOperationalAuthorization({
      ownerId: "emp-a",
      platformStore: {
        enterprises: { "001": { enterpriseId: "001", status: "active" } },
        memberships: { m1: { membershipId: "m1", userId: "emp-a", enterpriseId: "001" } },
      } as never,
      seatStore: { bindings: {} } as never,
    });
    expect(compat.decision).toBe("allow");
    const { store, identityId } = boundIdentity();
    confirmEnterpriseImRobotGrant({
      store,
      ownerId: "emp-a",
      identityId,
      agentId: "bot-a",
      agentScope: "owned",
      allowedActions: ["read"],
      gate: openGate,
      nowIso: now,
    });
    const missingSeat = decideEnterpriseImEmployeeProxy({
      store,
      ownerId: "emp-a",
      agentId: "bot-a",
      action: "read",
      identityId,
      gate: openGate,
      seat: { kind: "missing", policyPresent: true },
      nowIso: now,
    });
    const missingPolicy = decideEnterpriseImEmployeeProxy({
      store,
      ownerId: "emp-a",
      agentId: "bot-a",
      action: "read",
      identityId,
      gate: openGate,
      seat: { kind: "present", policyPresent: false },
      nowIso: now,
    });
    expect(missingSeat).toMatchObject({ outcome: "deny", code: "SEAT_MISSING" });
    expect(missingPolicy).toMatchObject({ outcome: "deny", code: "ENTERPRISE_POLICY_MISSING" });
  });

  it("keeps robot grants independent and refuses ambiguous or expired matches", () => {
    const { store, identityId } = boundIdentity();
    const project = confirmEnterpriseImRobotGrant({
      store,
      ownerId: "emp-a",
      identityId,
      agentId: "project",
      agentScope: "owned",
      allowedActions: ["read"],
      gate: openGate,
      nowIso: now,
    });
    const knowledge = confirmEnterpriseImRobotGrant({
      store,
      ownerId: "emp-a",
      identityId,
      agentId: "knowledge",
      agentScope: "owned",
      allowedActions: ["draft"],
      gate: openGate,
      nowIso: now,
    });
    if (!("grant" in project) || !("grant" in knowledge)) {
      throw new Error("confirm failed");
    }
    revokeUserOperationalIdentityGrant({
      store,
      ownerId: "emp-a",
      grantId: project.grant.grantId,
      nowIso: now,
    });
    expect(resolve(store, "knowledge", "draft", identityId).allowed).toBe(true);
    expect(resolve(store, "project", "read", identityId).allowed).toBe(false);
    expect(resolve(store, "knowledge", "read", identityId).allowed).toBe(false);

    const expired = confirmEnterpriseImRobotGrant({
      store,
      ownerId: "emp-a",
      identityId,
      agentId: "project",
      agentScope: "owned",
      allowedActions: ["read"],
      gate: openGate,
      nowIso: now,
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    expect(expired).toMatchObject({ ok: true });
    expect(
      decideEnterpriseImEmployeeProxy({
        store,
        ownerId: "emp-a",
        agentId: "project",
        action: "read",
        identityId,
        gate: openGate,
        seat,
        nowIso: now,
      }).code,
    ).toBe("DELEGATION_EXPIRED");

    const first = Object.values(store.grants).find((grant) => grant.agentId === "knowledge");
    if (!first) {
      throw new Error("missing knowledge grant");
    }
    store.grants["second"] = {
      ...first,
      grantId: "second",
      grantVersion: 2,
      allowedActions: ["draft"],
    };
    expect(
      decideEnterpriseImEmployeeProxy({
        store,
        ownerId: "emp-a",
        agentId: "knowledge",
        action: "draft",
        identityId,
        gate: openGate,
        seat,
        nowIso: now,
      }).code,
    ).toBe("DELEGATION_AMBIGUOUS");
  });
});
