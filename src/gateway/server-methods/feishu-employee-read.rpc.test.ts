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
import { FEISHU_USER_DOCX_RAW_CONTENT_API } from "../enterprise-im-feishu-doc-reader.js";
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

function tenantStore(projectDocs?: unknown): TenantConfigStore {
  return {
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
            ...(projectDocs === undefined ? {} : { measured: { projectDocs } }),
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
    await saveTenantConfigStore(tenantStore(), fixture.tenantPath);
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
    vi.unstubAllGlobals();
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

  it("uses the wired user-token reader only after a measurement record", async () => {
    const docId = "doxcnInScopeDocument0000001";
    const fetchImpl = vi.fn(async () => {
      throw new Error("feishu must not be called");
    });
    vi.stubGlobal("fetch", fetchImpl);
    await saveTenantConfigStore(tenantStore(true), fixture.tenantPath);
    const booleanTrue = await execute("read", { resourceKind: "doc", resourceId: "docx_in" });
    expect(booleanTrue.payload).toMatchObject({ code: "ENTERPRISE_IM_NOT_MEASURED" });
    expect(fetchImpl).not.toHaveBeenCalled();

    const stored = await loadUserOperationalIdentityStore(fixture.identityPath);
    stored.grants["g-read"].resourceScope = { groups: [], docs: [docId], calendars: [] };
    await saveUserOperationalIdentityStore(stored, fixture.identityPath, {
      governanceStateDir: fixture.stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    await saveTenantConfigStore(
      tenantStore({
        status: "measured",
        api: FEISHU_USER_DOCX_RAW_CONTENT_API,
        tokenType: "user_access_token",
        scopes: ["docx:document:readonly"],
        observedAt: "2026-11-07T03:00:00.000Z",
      }),
      fixture.tenantPath,
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        calls.push(href);
        const authorization = new Headers(init?.headers).get("Authorization");
        expect(authorization).toBe(`Bearer ${ACCESS}`);
        expect(authorization).not.toContain(APP_SECRET);
        if (href.endsWith("/raw_content")) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: {
                content:
                  "本周三完成接口联调，剩余风险是权限审批。详见 https://example.feishu.cn/docx/doxcnOutOfScopeLink00000001",
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            code: 0,
            data: { document: { document_id: docId, revision_id: 4, title: "项目进度" } },
          }),
          { status: 200 },
        );
      }),
    );
    const read = await execute("draft", { resourceKind: "doc", resourceId: docId });
    expect(read.payload).toMatchObject({ code: "ENTERPRISE_IM_DRAFT_READY" });
    const draft = read.payload?.draft as { text?: string; inventory?: { unreadable?: string[] } };
    expect(draft.text).toContain("本周三完成接口联调，剩余风险是权限审批。");
    expect(draft.inventory?.unreadable).toEqual(["doxcnOutOfScopeLink00000001"]);
    expect(calls.some((url) => url.includes("/raw_content"))).toBe(true);
    expect(JSON.stringify(read.payload)).not.toContain(ACCESS);
    expect(JSON.stringify(read.payload)).not.toContain(APP_SECRET);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 99991663, msg: "invalid" }), { status: 401 }),
      ),
    );
    const invalid = await execute("read", { resourceKind: "doc", resourceId: docId });
    expect(invalid.payload).toMatchObject({ code: "USER_TOKEN_INVALID_NO_APP_FALLBACK" });
    const afterInvalid = await loadUserOperationalIdentityStore(fixture.identityPath);
    expect(Object.values(afterInvalid.identities)[0]?.status).toBe("reauth_required");
    const denied = Object.values(afterInvalid.usageEvents).find(
      (event) => event.denialCode === "USER_TOKEN_INVALID_NO_APP_FALLBACK",
    );
    expect(denied?.agentId).toBe("project");
    expect(JSON.stringify(denied)).not.toContain(ACCESS);
    const again = await execute("read", { resourceKind: "doc", resourceId: docId });
    expect(again.payload?.code).not.toBe("ENTERPRISE_IM_DRAFT_READY");
  });
});
