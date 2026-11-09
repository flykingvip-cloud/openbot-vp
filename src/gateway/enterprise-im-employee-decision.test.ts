import { describe, expect, it } from "vitest";
import { resolveEnterpriseImSeatAndPolicy } from "./enterprise-im-employee-authorization.js";
import type { EnterpriseImRobotPolicy } from "./enterprise-im-employee-authorization.js";
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
  EnterpriseImConfirmMode,
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
const now = "2026-11-07T00:00:00.000Z";
const scope = { groups: [] as string[], docs: [] as string[], calendars: [] as string[] };

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

function seatStore(seatIds: string[]) {
  const bindings: Record<string, unknown> = {};
  seatIds.forEach((seatId, index) => {
    bindings[`b${index}`] = {
      bindingId: `b${index}`,
      seatId,
      tenantId: "001",
      employeeId: "emp-a",
      bindingStatus: "active",
      effectiveAt: now,
    };
  });
  return { bindings } as never;
}

function policy(
  agentId: string,
  actions: Array<"read" | "draft" | "send">,
): EnterpriseImRobotPolicy {
  return {
    policyId: `policy-${agentId}-${actions.join("-")}`,
    employeeId: "emp-a",
    seatId: "seat-1",
    agentId,
    actions,
  };
}

function authorization(
  agentId: string,
  action: string,
  policies: EnterpriseImRobotPolicy[],
  seats = ["seat-1"],
) {
  return resolveEnterpriseImSeatAndPolicy({
    tenantId: "001",
    ownerId: "emp-a",
    agentId,
    action,
    seatStore: seatStore(seats),
    policies,
  });
}

function modeFor(actions: string[]): EnterpriseImConfirmMode {
  if (actions.includes("send")) {
    return "limited_auto";
  }
  if (actions.includes("draft")) {
    return "draft_then_confirm";
  }
  return "read_only";
}

function confirm(
  bound: ReturnType<typeof boundIdentity>,
  agentId: string,
  actions: Array<"read" | "draft" | "send">,
  expiresAt?: string,
) {
  return confirmEnterpriseImRobotGrant({
    store: bound.store,
    secretStore: bound.secrets,
    ownerId: "emp-a",
    identityId: bound.identityId,
    agentId,
    agentScope: "owned",
    allowedActions: actions,
    gate: openGate,
    tenantId: "001",
    confirmExplicit: true,
    resourceScope: scope,
    confirmMode: modeFor(actions),
    nowIso: now,
    expiresAt,
  });
}

function resolve(
  bound: ReturnType<typeof boundIdentity>,
  agentId: string,
  action: string,
  policies: EnterpriseImRobotPolicy[],
) {
  return resolveUserOperationalIdentity({
    store: bound.store,
    provider: "feishu-personal",
    action,
    currentUserId: "emp-a",
    currentAgentId: agentId,
    nowIso: now,
    enterpriseIm: {
      tenantId: "001",
      gate: openGate,
      secretStore: bound.secrets,
      authorization: authorization(agentId, action, policies),
      identityId: bound.identityId,
    },
  });
}

describe("enterprise IM robot delegation (slice 2)", () => {
  it("refuses an owned robot with no confirm and does not write a grant", () => {
    const bound = boundIdentity();
    const policies = [policy("bot-owned", ["read"])];
    const before = Object.keys(bound.store.grants).length;
    const resolved = resolve(bound, "bot-owned", "read", policies);
    const executed = executeEnterpriseImEmployeeProxy({
      store: bound.store,
      secretStore: bound.secrets,
      ownerId: "emp-a",
      agentId: "bot-owned",
      action: "read",
      tenantId: "001",
      identityId: bound.identityId,
      gate: openGate,
      authorization: authorization("bot-owned", "read", policies),
      nowIso: now,
    });
    expect(resolved.allowed).toBe(false);
    expect(executed.outcome).toBe("deny");
    expect(Object.keys(bound.store.grants)).toHaveLength(before);
    expect(JSON.stringify(resolved)).not.toContain("access-secret");
    expect(JSON.stringify(executed)).not.toContain("refresh-secret");
  });

  it("allows only the confirmed robot and action", () => {
    const bound = boundIdentity();
    const confirmed = confirm(bound, "bot-a", ["read"]);
    expect(confirmed).toMatchObject({ ok: true });
    const policies = [policy("bot-a", ["read", "send"]), policy("bot-b", ["read"])];
    const allowed = resolve(bound, "bot-a", "read", policies);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed && "grant" in confirmed) {
      expect(allowed.grant.grantId).toBe(confirmed.grant.grantId);
    }
    expect(resolve(bound, "bot-b", "read", policies).allowed).toBe(false);
    expect(resolve(bound, "bot-a", "send", policies).allowed).toBe(false);
    expect(bound.store.identities[bound.identityId]?.enterpriseIm?.userGrantedScopes).toEqual([
      "offline_access",
      "im:message",
    ]);
  });

  it("does not auto-create a grant after revoke", () => {
    const bound = boundIdentity();
    const confirmed = confirm(bound, "bot-a", ["read"]);
    if (!("grant" in confirmed)) {
      throw new Error("confirm failed");
    }
    revokeUserOperationalIdentityGrant({
      store: bound.store,
      ownerId: "emp-a",
      grantId: confirmed.grant.grantId,
      nowIso: now,
    });
    const before = Object.keys(bound.store.grants).length;
    const resolved = resolve(bound, "bot-a", "read", [policy("bot-a", ["read"])]);
    expect(resolved.allowed).toBe(false);
    if (!resolved.allowed) {
      expect(resolved.code).toBe("DELEGATION_MISSING");
    }
    expect(Object.keys(bound.store.grants)).toHaveLength(before);
    expect(Object.values(bound.store.grants).some((grant) => grant.grantMode === "auto")).toBe(
      false,
    );
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
    const bound = boundIdentity();
    confirm(bound, "bot-a", ["read"]);
    const missingSeat = authorization("bot-a", "read", [policy("bot-a", ["read"])], []);
    const missingPolicy = authorization("bot-a", "read", []);
    expect(missingSeat).toMatchObject({ ok: false, code: "SEAT_MISSING" });
    expect(missingPolicy).toMatchObject({ ok: false, code: "ENTERPRISE_POLICY_MISSING" });
    expect(
      decideEnterpriseImEmployeeProxy({
        store: bound.store,
        secretStore: bound.secrets,
        ownerId: "emp-a",
        agentId: "bot-a",
        action: "read",
        tenantId: "001",
        identityId: bound.identityId,
        gate: openGate,
        authorization: missingSeat,
        nowIso: now,
      }),
    ).toMatchObject({ outcome: "deny", code: "SEAT_MISSING" });
    expect(
      decideEnterpriseImEmployeeProxy({
        store: bound.store,
        secretStore: bound.secrets,
        ownerId: "emp-a",
        agentId: "bot-a",
        action: "send",
        tenantId: "001",
        identityId: bound.identityId,
        gate: openGate,
        authorization: authorization("bot-a", "send", [policy("bot-a", ["read"])]),
        nowIso: now,
      }),
    ).toMatchObject({ outcome: "deny", code: "ENTERPRISE_POLICY_DENIED" });
  });

  it("keeps robot grants independent and refuses ambiguous or expired matches", () => {
    const bound = boundIdentity();
    const project = confirm(bound, "project", ["read"]);
    const knowledge = confirm(bound, "knowledge", ["draft"]);
    if (!("grant" in project) || !("grant" in knowledge)) {
      throw new Error("confirm failed");
    }
    revokeUserOperationalIdentityGrant({
      store: bound.store,
      ownerId: "emp-a",
      grantId: project.grant.grantId,
      nowIso: now,
    });
    const policies = [policy("knowledge", ["read", "draft"]), policy("project", ["read"])];
    expect(resolve(bound, "knowledge", "draft", policies).allowed).toBe(true);
    expect(resolve(bound, "project", "read", policies).allowed).toBe(false);
    expect(resolve(bound, "knowledge", "read", policies).allowed).toBe(false);

    const expired = confirm(bound, "project", ["read"], "2026-11-01T00:00:00.000Z");
    expect(expired).toMatchObject({ ok: true });
    expect(
      decideEnterpriseImEmployeeProxy({
        store: bound.store,
        secretStore: bound.secrets,
        ownerId: "emp-a",
        agentId: "project",
        action: "read",
        tenantId: "001",
        identityId: bound.identityId,
        gate: openGate,
        authorization: authorization("project", "read", policies),
        nowIso: now,
      }).code,
    ).toBe("DELEGATION_EXPIRED");

    const first = Object.values(bound.store.grants).find((grant) => grant.agentId === "knowledge");
    if (!first) {
      throw new Error("missing knowledge grant");
    }
    bound.store.grants.second = { ...first, grantId: "second", grantVersion: 2 };
    expect(
      decideEnterpriseImEmployeeProxy({
        store: bound.store,
        secretStore: bound.secrets,
        ownerId: "emp-a",
        agentId: "knowledge",
        action: "draft",
        tenantId: "001",
        identityId: bound.identityId,
        gate: openGate,
        authorization: authorization("knowledge", "draft", policies),
        nowIso: now,
      }).code,
    ).toBe("DELEGATION_AMBIGUOUS");
  });
});
