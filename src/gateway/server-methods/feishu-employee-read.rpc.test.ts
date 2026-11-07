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
import {
  loadUserOperationalIdentityStore,
  saveUserOperationalIdentityStore,
  type UserOperationalIdentityStore,
} from "../user-operational-identity-persistence.js";
import {
  saveUserOperationalIdentityCredentialSecretStore,
  type UserOperationalIdentityCredentialSecretStore,
} from "../user-operational-identity-secrets-persistence.js";

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

describe("feishu employee read RPC (slice 3)", () => {
  const previousState = process.env.OPENBOT_STATE_DIR;

  beforeEach(async () => {
    fixture.dir = mkdtempSync(path.join(tmpdir(), "feishu-read-rpc-"));
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
        scopeNames: ["offline_access", "docx:document:readonly"],
      },
    });
    store.grants["g-read"] = {
      grantId: "g-read",
      identityId: bound.identityId!,
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
      confirmMode: "draft_then_confirm",
      resourceScope: { groups: [], docs: ["docx_in"], calendars: [] },
    };
    const tenant: TenantConfigStore = {
      version: 1,
      tenants: {
        "001": {
          tenantId: "001",
          updatedAt: "2026-11-07T00:00:00.000Z",
          override: {
            enterpriseImEmployeeProxy: {
              policies: [
                {
                  policyId: "policy-project",
                  employeeId: "emp-a",
                  seatId: "seat-1",
                  agentId: "project",
                  actions: ["read", "draft", "send"],
                },
              ],
            },
            channels: {
              feishu: {
                enabled: true,
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
    await saveTenantConfigStore(tenant, fixture.tenantPath);
    await saveEnterpriseSeatAssetsStore(
      fixture.seatPath,
      normalizeEnterpriseSeatAssetsStore(
        {
          version: 4,
          bindings: {
            b1: {
              bindingId: "b1",
              seatId: "seat-1",
              tenantId: "001",
              employeeId: "emp-a",
              bindingStatus: "active",
              effectiveAt: "2026-11-01T00:00:00.000Z",
            },
          },
        } as never,
        4,
      ),
    );
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

  async function execute(action: string, payload: Record<string, unknown> = {}) {
    const handler = userOperationalIdentityHandlers["user-operational-identity.execute"];
    let captured: { ok: boolean; payload?: Record<string, unknown> } | null = null;
    await handler({
      req: { type: "req", id: "t", method: "user-operational-identity.execute", params: {} },
      params: { provider: "feishu-personal", action, agentId: "project", payload },
      client: { platformUserId: "emp-a" } as never,
      isWebchatConnect: () => false,
      respond: (ok, body) => {
        captured = { ok, payload: body as Record<string, unknown> };
      },
      context: {} as never,
    });
    if (!captured) {
      throw new Error("execute did not respond");
    }
    return captured;
  }

  it("gates the execute entry and keeps send closed", async () => {
    const send = await execute("send", { resourceKind: "doc", resourceId: "docx_in" });
    expect(send.payload).toMatchObject({
      executed: false,
      code: "ENTERPRISE_IM_ALLOW_NO_PRODUCT_ACTION",
    });
    const unmeasured = await execute("read", { resourceKind: "doc", resourceId: "docx_in" });
    expect(unmeasured.payload).toMatchObject({
      executed: false,
      code: "ENTERPRISE_IM_NOT_MEASURED",
    });
    const text = JSON.stringify(unmeasured.payload);
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(APP_SECRET);
    const stored = await loadUserOperationalIdentityStore(fixture.identityPath);
    expect(Object.keys(stored.grants)).toHaveLength(1);
    expect(stored.grants["g-read"]?.resourceScope?.docs).toEqual(["docx_in"]);
    const event = Object.values(stored.usageEvents).find((item) => item.action === "read");
    expect(event?.summary?.externalId).toBe("docx_in");
    expect(event?.summary?.excerpt).toContain("grantVersion=1");
    expect(JSON.stringify(event)).not.toContain(ACCESS);

    stored.grants["g-read"].resourceScope = { groups: [], docs: [], calendars: [] };
    await saveUserOperationalIdentityStore(stored, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    const empty = await execute("read", { resourceKind: "doc", resourceId: "docx_in" });
    expect(empty.payload).toMatchObject({ code: "RESOURCE_SCOPE_EMPTY" });

    await saveEnterpriseSeatAssetsStore(
      fixture.seatPath,
      normalizeEnterpriseSeatAssetsStore({ version: 4, bindings: {} } as never, 4),
    );
    const missingSeat = await execute("read", { resourceKind: "doc", resourceId: "docx_in" });
    expect(missingSeat.payload).toMatchObject({ code: "SEAT_MISSING" });

    const after = await loadUserOperationalIdentityStore(fixture.identityPath);
    expect(Object.keys(after.grants)).toHaveLength(1);
  });
});
