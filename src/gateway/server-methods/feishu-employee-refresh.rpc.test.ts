import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownershipProofFromTenantUser } from "../data-governance/ownership-proof.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import {
  bindFeishuEmployeeConnection,
  feishuEmployeeIdentityId,
  type FeishuEmployeeChannelGate,
} from "../enterprise-im-employee-connection.js";
import { saveTenantConfigStore, type TenantConfigStore } from "../tenant-config.js";
import {
  saveUserOperationalIdentityStore,
  type UserOperationalIdentityStore,
} from "../user-operational-identity-persistence.js";
import {
  loadUserOperationalIdentityCredentialSecretStore,
  saveUserOperationalIdentityCredentialSecretStore,
  type UserOperationalIdentityCredentialSecretStore,
} from "../user-operational-identity-secrets-persistence.js";
import type { GatewayRequestHandler } from "./types.js";

const fixture = vi.hoisted(() => ({
  tenantPath: "",
  identityPath: "",
  secretPath: "",
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

const { userOperationalIdentityHandlers } = await import("./user-operational-identity.js");

const ACCESS = "rpc-access-token-value";
const REFRESH = "rpc-refresh-token-value";
const APP_SECRET = "rpc-app-secret-value";
const NEXT_ACCESS = "rpc-rotated-access";
const NEXT_REFRESH = "rpc-rotated-refresh";

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

async function invoke(ownerId: string, identityId: string) {
  const handler =
    userOperationalIdentityHandlers["user-operational-identity.feishu-employee.refresh"];
  let captured: { ok: boolean; payload?: unknown; error?: unknown } | null = null;
  await handler({
    req: {
      type: "req",
      id: "t",
      method: "user-operational-identity.feishu-employee.refresh",
      params: {},
    },
    params: { identityId },
    client: { platformUserId: ownerId } as never,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      captured = { ok, payload, error };
    },
    context: {} as never,
  });
  if (!captured) {
    throw new Error("refresh handler did not respond");
  }
  return captured;
}

function assertRedacted(value: unknown) {
  const text = JSON.stringify(value ?? null);
  expect(text).not.toContain(ACCESS);
  expect(text).not.toContain(REFRESH);
  expect(text).not.toContain(APP_SECRET);
  expect(text).not.toContain(NEXT_ACCESS);
  expect(text).not.toContain(NEXT_REFRESH);
}

describe("feishu employee refresh RPC", () => {
  const previousState = process.env.OPENBOT_STATE_DIR;
  let fetchImpl: typeof fetch;

  beforeEach(async () => {
    fixture.dir = mkdtempSync(path.join(tmpdir(), "feishu-refresh-rpc-"));
    fixture.stateDir = path.join(fixture.dir, "state");
    fixture.tenantPath = path.join(fixture.dir, "tenant-config.json");
    fixture.identityPath = path.join(fixture.dir, "identity.json");
    fixture.secretPath = path.join(fixture.dir, "secrets.json");
    process.env.OPENBOT_STATE_DIR = fixture.stateDir;
    const store = emptyStore();
    const secrets: UserOperationalIdentityCredentialSecretStore = { version: 1, secrets: {} };
    bindFeishuEmployeeConnection({
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
    const tenantStore: TenantConfigStore = {
      version: 1,
      tenants: {
        "001": {
          tenantId: "001",
          updatedAt: "2026-11-07T00:00:00.000Z",
          override: {
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
    await saveTenantConfigStore(tenantStore, fixture.tenantPath);
    await saveUserOperationalIdentityStore(store, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    await saveUserOperationalIdentityCredentialSecretStore(secrets, fixture.secretPath);
    fetchImpl = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          code: 0,
          access_token: NEXT_ACCESS,
          refresh_token: NEXT_REFRESH,
          expires_in: 3600,
          tenant_key: "tenant-key-1",
          open_id: "ou_a",
          scope: "offline_access im:message",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchImpl;
    if (previousState === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousState;
    }
    resetSharedDataGovernanceCatalogForTests();
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  it("lets the owner refresh and omits tokens and the app secret", async () => {
    const identityId = feishuEmployeeIdentityId({
      tenantId: "001",
      ownerId: "emp-a",
      openId: "ou_a",
    });
    const result = await invoke("emp-a", identityId);
    expect(result.ok, JSON.stringify(result.error ?? result.payload)).toBe(true);
    assertRedacted(result.payload);
    assertRedacted(result.error);
    const reloaded = await loadUserOperationalIdentityCredentialSecretStore(fixture.secretPath);
    expect(Object.values(reloaded.secrets)[0]?.refreshToken).toBe(NEXT_REFRESH);
    expect(Object.values(reloaded.secrets)[0]?.accessToken).toBe(NEXT_ACCESS);
  });

  it("rejects another employee's identity without returning secrets", async () => {
    const identityId = feishuEmployeeIdentityId({
      tenantId: "001",
      ownerId: "emp-a",
      openId: "ou_a",
    });
    const result = await invoke("emp-b", identityId);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.error)).toContain("USER_IDENTITY_NOT_FOUND");
    assertRedacted(result.payload ?? {});
    assertRedacted(result.error ?? {});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
