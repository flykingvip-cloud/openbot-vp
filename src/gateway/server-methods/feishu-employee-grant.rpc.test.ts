import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownershipProofFromTenantUser } from "../data-governance/ownership-proof.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import {
  bindFeishuEmployeeConnection,
  type FeishuEmployeeChannelGate,
} from "../enterprise-im-employee-connection.js";
import { normalizeEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-backend.js";
import { saveEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { saveTenantConfigStore, type TenantConfigStore } from "../tenant-config.js";
import { resolveEmployeeOperationalAuthorization } from "../user-operational-identity-enterprise-authorization.js";
import {
  loadUserOperationalIdentityStore,
  saveUserOperationalIdentityStore,
} from "../user-operational-identity-persistence.js";
import { saveUserOperationalIdentityCredentialSecretStore } from "../user-operational-identity-secrets-persistence.js";
import type {
  UserOperationalIdentityStore,
  UserOperationalIdentityCredentialSecretStore,
} from "../user-operational-identity-types.js";
const fixture = vi.hoisted(() => ({
  tenantPath: "",
  identityPath: "",
  secretPath: "",
  seatPath: "",
  stateDir: "",
  dir: "",
}));

vi.mock("../scope-attribution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scope-attribution.js")>();
  return {
    ...actual,
    resolveQueryScope: async () => ({ kind: "tenant" as const, tenantId: "001" }),
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...actual,
    resolveUserOperationalIdentityStorePathForClient: async () => fixture.identityPath,
    resolveUserOperationalIdentitySecretsStorePathForClient: async () => fixture.secretPath,
    resolveControlPlaneStorePathForClient: async () => fixture.seatPath,
  };
});

vi.mock("../tenant-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-config.js")>();
  return {
    ...actual,
    loadTenantConfigStore: async (storePath?: string) =>
      actual.loadTenantConfigStore(storePath ?? fixture.tenantPath),
  };
});

vi.mock("../user-operational-identity-trusted-agent-scope.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../user-operational-identity-trusted-agent-scope.js")>();
  return {
    ...actual,
    resolveTrustedUserOperationalIdentityAgentScope: () => "owned" as const,
  };
});

const { userOperationalIdentityHandlers } = await import("./user-operational-identity.js");

const ACCESS = "rpc-access-token-value";
const REFRESH = "rpc-refresh-token-value";
const APP_SECRET = "rpc-app-secret-value";

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

function gate(): FeishuEmployeeChannelGate {
  return {
    accountId: "t_001_default",
    employeeUiHint: "app_can_attempt",
    loginEnabled: true,
    statusLabel: "可绑定",
    platformEnterpriseId: "tenant-key-1",
    childExecutionBlocked: false,
  };
}

function tenantStore(enabled = true, policies?: unknown): TenantConfigStore {
  return {
    version: 1,
    tenants: {
      "001": {
        tenantId: "001",
        updatedAt: "2026-11-07T00:00:00.000Z",
        override: {
          enterpriseImEmployeeProxy: {
            policies: (policies as never) ?? [
              {
                policyId: "policy-project",
                employeeId: "emp-a",
                seatId: "seat-1",
                agentId: "project",
                actions: ["read", "draft", "send"],
              },
              {
                policyId: "policy-knowledge",
                employeeId: "emp-a",
                seatId: "seat-1",
                agentId: "knowledge",
                actions: ["read", "draft"],
              },
            ],
          },
          channels: {
            feishu: {
              enabled,
              accounts: {
                t_001_default: {
                  appId: "cli_public",
                  appSecret: APP_SECRET,
                  platformEnterpriseId: "tenant-key-1",
                  capabilityStatus: {
                    checkedAt: "2026-11-07T00:00:00.000Z",
                    projectGroupRead: "granted",
                    projectDocs: "granted",
                    sendAsUser: "granted",
                    newMessageTrigger: "granted",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function saveSeat(seatIds: string[]) {
  const bindings: Record<string, unknown> = {};
  seatIds.forEach((seatId, index) => {
    bindings[`b${index}`] = {
      bindingId: `b${index}`,
      seatId,
      tenantId: "001",
      employeeId: "emp-a",
      bindingStatus: "active",
      effectiveAt: "2026-11-01T00:00:00.000Z",
    };
  });
  await saveEnterpriseSeatAssetsStore(
    fixture.seatPath,
    normalizeEnterpriseSeatAssetsStore({ version: 4, bindings } as never, 4),
  );
}

async function invoke(
  method:
    | "user-operational-identity.grants.upsert"
    | "user-operational-identity.execute"
    | "user-operational-identity.access.resolve",
  params: Record<string, unknown>,
) {
  const handler = userOperationalIdentityHandlers[method];
  const responses: Array<{
    ok: boolean;
    payload?: unknown;
    error?: { message?: string; details?: { code?: string } };
  }> = [];
  await handler({
    req: { type: "req", id: "t", method, params },
    params,
    client: { platformUserId: "emp-a" } as never,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      responses.push({ ok, payload, error: error as never });
    },
    context: {} as never,
  });
  const captured = responses[0];
  if (!captured) {
    throw new Error(`${method} did not respond`);
  }
  return captured;
}

function assertRedacted(value: unknown) {
  const text = JSON.stringify(value ?? null);
  expect(text).not.toContain(ACCESS);
  expect(text).not.toContain(REFRESH);
  expect(text).not.toContain(APP_SECRET);
}

const scope = { groups: ["oc_group"], docs: ["docx_1"], calendars: [] as string[] };

function grantParams(agentId: string, actions: string[], extra: Record<string, unknown> = {}) {
  return {
    identityId: "feishu-employee.001.emp-a.ou_a",
    agentId,
    agentScope: "owned",
    grantMode: "explicit",
    confirmExplicit: true,
    allowedActions: actions,
    resourceScope: scope,
    confirmMode: actions.includes("send") ? "limited_auto" : "draft_then_confirm",
    expiresAt: "2026-12-01T00:00:00.000Z",
    ...extra,
  };
}

describe("feishu employee grant RPC", () => {
  const previousState = process.env.OPENBOT_STATE_DIR;
  let identityId = "";

  beforeEach(async () => {
    fixture.dir = mkdtempSync(path.join(tmpdir(), "feishu-grant-rpc-"));
    fixture.stateDir = path.join(fixture.dir, "state");
    fixture.tenantPath = path.join(fixture.dir, "tenant-config.json");
    fixture.identityPath = path.join(fixture.dir, "identity.json");
    fixture.secretPath = path.join(fixture.dir, "secrets.json");
    fixture.seatPath = path.join(fixture.dir, "seats.json");
    process.env.OPENBOT_STATE_DIR = fixture.stateDir;
    resetSharedDataGovernanceCatalogForTests();
    const store = emptyStore();
    const secrets: UserOperationalIdentityCredentialSecretStore = { version: 1, secrets: {} };
    const bound = bindFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-a",
      tenantId: "001",
      gate: gate(),
      nowIso: "2026-11-07T00:00:00.000Z",
      observation: {
        accessToken: ACCESS,
        refreshToken: REFRESH,
        openId: "ou_a",
        tenantKey: "tenant-key-1",
        scopeNames: ["offline_access", "im:message"],
      },
    });
    identityId = bound.identityId ?? "";
    await saveTenantConfigStore(tenantStore(true), fixture.tenantPath);
    await saveSeat(["seat-1"]);
    await saveUserOperationalIdentityStore(store, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    await saveUserOperationalIdentityCredentialSecretStore(secrets, fixture.secretPath);
  });

  afterEach(() => {
    process.env.OPENBOT_STATE_DIR = previousState;
    resetSharedDataGovernanceCatalogForTests();
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  async function grantCount() {
    const store = await loadUserOperationalIdentityStore(fixture.identityPath);
    return Object.keys(store.grants).length;
  }

  it("refuses confirm when the enterprise connection is off, the identity is disabled, or confirm is missing", async () => {
    await saveTenantConfigStore(tenantStore(false), fixture.tenantPath);
    const closed = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("project", ["read"]),
    );
    expect(closed.ok).toBe(false);
    expect(closed.error?.details?.code).toBe("ENTERPRISE_CONNECTION_DISABLED");
    expect(await grantCount()).toBe(0);
    assertRedacted(closed);

    await saveTenantConfigStore(tenantStore(true), fixture.tenantPath);
    const unconfirmed = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("project", ["read"], { confirmExplicit: false }),
    );
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.error?.details?.code).toBe("CONFIRM_REQUIRED");
    const auto = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("project", ["read"], { grantMode: "auto" }),
    );
    expect(auto.ok).toBe(false);
    expect(auto.error?.details?.code).toBe("CONFIRM_REQUIRED");
    expect(await grantCount()).toBe(0);

    const store = await loadUserOperationalIdentityStore(fixture.identityPath);
    const identity = store.identities[identityId];
    if (!identity) {
      throw new Error("missing identity");
    }
    identity.status = "reauth_required";
    await saveUserOperationalIdentityStore(store, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    const disabled = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("project", ["read"]),
    );
    expect(disabled.ok).toBe(false);
    expect(disabled.error?.details?.code).toBe("IDENTITY_NOT_USABLE");
    expect(await grantCount()).toBe(0);
    assertRedacted(disabled);
  });

  it("confirms through the RPC, then resolve and execute use the stored seat and policy", async () => {
    const project = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("project", ["send"], {
        resourceScope: { groups: ["oc_project"], docs: [], calendars: [] },
        confirmMode: "limited_auto",
      }),
    );
    const knowledge = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("knowledge", ["read", "draft"], {
        resourceScope: { groups: [], docs: ["docx_knowledge"], calendars: [] },
        confirmMode: "draft_then_confirm",
        expiresAt: undefined,
      }),
    );
    expect(project.ok).toBe(true);
    expect(knowledge.ok).toBe(true);
    const projectGrant = (
      project.payload as {
        grant?: {
          grantId?: string;
          allowedActions?: string[];
          grantMode?: string;
          grantVersion?: number;
          resourceScope?: { groups?: string[] };
          confirmMode?: string;
        };
      }
    ).grant;
    const knowledgeGrant = (
      knowledge.payload as {
        grant?: {
          allowedActions?: string[];
          resourceScope?: { docs?: string[] };
          confirmMode?: string;
        };
      }
    ).grant;
    expect(projectGrant?.grantMode).toBe("explicit");
    expect(projectGrant?.grantVersion).toBe(1);
    expect(projectGrant?.allowedActions).toEqual(["send"]);
    expect(projectGrant?.confirmMode).toBe("limited_auto");
    expect(projectGrant?.resourceScope?.groups).toEqual(["oc_project"]);
    expect(knowledgeGrant?.allowedActions).toEqual(["read", "draft"]);
    expect(knowledgeGrant?.resourceScope?.docs).toEqual(["docx_knowledge"]);
    expect(knowledgeGrant?.confirmMode).toBe("draft_then_confirm");
    assertRedacted(project);
    assertRedacted(knowledge);
    const before = await grantCount();
    expect(before).toBe(2);

    const allowed = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "project",
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.payload).toMatchObject({
      executed: false,
      code: "ENTERPRISE_IM_ALLOW_NO_PRODUCT_ACTION",
      grantId: projectGrant?.grantId,
    });
    const resolved = await invoke("user-operational-identity.access.resolve", {
      provider: "feishu-personal",
      action: "read",
      agentId: "knowledge",
    });
    expect(resolved.payload).toMatchObject({ allowed: true });
    expect((resolved.payload as { grant?: { grantId?: string } }).grant?.grantId).toBeTruthy();
    const sibling = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "knowledge",
    });
    expect(sibling.payload).toMatchObject({ code: "ENTERPRISE_POLICY_DENIED" });
    const actionMissing = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "read",
      agentId: "project",
    });
    expect(actionMissing.payload).toMatchObject({ code: "DELEGATION_ACTION_MISSING" });
    expect(await grantCount()).toBe(before);
    assertRedacted(allowed);
    assertRedacted(resolved);

    await saveSeat([]);
    const compat = resolveEmployeeOperationalAuthorization({
      ownerId: "emp-a",
      platformStore: {
        enterprises: { "001": { enterpriseId: "001", status: "active" } },
        memberships: { m1: { membershipId: "m1", userId: "emp-a", enterpriseId: "001" } },
      } as never,
      seatStore: { bindings: {} } as never,
    });
    expect(compat.decision).toBe("allow");
    const missingSeat = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "project",
    });
    expect(missingSeat.payload).toMatchObject({ code: "SEAT_MISSING" });

    await saveSeat(["seat-1", "seat-2"]);
    const ambiguous = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "project",
    });
    expect(ambiguous.payload).toMatchObject({ code: "SEAT_BINDING_AMBIGUOUS" });
    await saveSeat(["seat-1"]);
    await saveTenantConfigStore(tenantStore(true, []), fixture.tenantPath);
    const missingPolicy = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "project",
    });
    expect(missingPolicy.payload).toMatchObject({ code: "ENTERPRISE_POLICY_MISSING" });
    expect(await grantCount()).toBe(before);
  });

  it("does not treat another provider grant, a disabled identity, or a connection mismatch as allow", async () => {
    const store = await loadUserOperationalIdentityStore(fixture.identityPath);
    store.identities["github-1"] = {
      identityId: "github-1",
      ownerType: "user",
      ownerId: "emp-a",
      tenantId: "001",
      provider: "github-personal",
      displayName: "gh",
      credentialHandleId: "handle-gh",
      status: "active",
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    };
    store.grants["g-github"] = {
      grantId: "g-github",
      identityId: "github-1",
      ownerId: "emp-a",
      agentId: "project",
      agentScope: "owned",
      allowedActions: ["read", "draft", "send"],
      grantMode: "explicit",
      status: "active",
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
      confirmedAt: "2026-11-07T00:00:00.000Z",
      grantVersion: 1,
    };
    await saveUserOperationalIdentityStore(store, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    const other = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "project",
    });
    expect(other.payload).toMatchObject({ executed: false });
    expect((other.payload as { code?: string }).code).not.toBe(
      "ENTERPRISE_IM_ALLOW_NO_PRODUCT_ACTION",
    );
    expect((other.payload as { grantId?: string }).grantId ?? null).not.toBe("g-github");

    const current = await loadUserOperationalIdentityStore(fixture.identityPath);
    const identity = current.identities[identityId];
    if (!identity?.enterpriseIm) {
      throw new Error("missing feishu identity");
    }
    identity.enterpriseIm.platformEnterpriseId = "other-tenant";
    await saveUserOperationalIdentityStore(current, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    const mismatch = await invoke("user-operational-identity.execute", {
      provider: "feishu-personal",
      action: "send",
      agentId: "project",
    });
    expect(mismatch.payload).toMatchObject({ code: "ENTERPRISE_CONNECTION_MISMATCH" });
    expect(await grantCount()).toBe(1);
  });

  it("saves send with draft_then_confirm and refuses read_only plus send", async () => {
    const saved = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("project", ["read", "draft", "send"], { confirmMode: "draft_then_confirm" }),
    );
    expect(saved.ok).toBe(true);
    const grant = (
      saved.payload as {
        grant?: { allowedActions?: string[]; confirmMode?: string };
      }
    ).grant;
    expect(grant?.allowedActions).toEqual(["read", "draft", "send"]);
    expect(grant?.confirmMode).toBe("draft_then_confirm");
    expect(await grantCount()).toBe(1);

    const before = await grantCount();
    const refused = await invoke(
      "user-operational-identity.grants.upsert",
      grantParams("knowledge", ["send"], { confirmMode: "read_only" }),
    );
    expect(refused.ok).toBe(false);
    expect(refused.error?.details?.code).toBe("GRANT_FIELDS_INVALID");
    expect(await grantCount()).toBe(before);
    assertRedacted(saved);
    assertRedacted(refused);
  });
});
