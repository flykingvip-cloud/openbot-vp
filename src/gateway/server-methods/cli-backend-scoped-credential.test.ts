import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mutable mock state (hoisted so vi.mock factories can read it).
const h = vi.hoisted(() => ({
  credStore: new Map<string, Record<string, unknown>>(),
  billing: {
    enterpriseId: null as string | null,
    isEnterpriseAdmin: false,
    user: null,
    membership: null,
    permissions: new Set<string>(),
  },
  adminTenant: { value: null as string | null },
  employeeId: { value: "emp-1" },
  masterKey: { value: "master-key-xyz" as string | null },
  put: vi.fn(async (_args: { id: string; value: string; masterKey: string }) => undefined),
  del: vi.fn(async (_id: string) => true),
}));

vi.mock("../../agents/cli-backend-credential-store.js", () => ({
  listCliBackendCredentials: vi.fn(async (tenantId: string) =>
    [...h.credStore.values()].filter((c) => c.tenantId === tenantId),
  ),
  upsertCliBackendCredential: vi.fn(async (input: Record<string, unknown>) => {
    const record = { ...input, updatedAt: "2026-01-01T00:00:00.000Z" };
    h.credStore.set(input.credentialId as string, record);
    return record;
  }),
  removeCliBackendCredential: vi.fn(async (id: string) => h.credStore.delete(id)),
  getCliBackendCredentialBindings: vi.fn(async () => ({})),
  setCliBackendCredentialBinding: vi.fn(),
}));

vi.mock("../../secrets/encrypted-local-store.js", () => ({
  ENCRYPTED_LOCAL_SOURCE: "encrypted-local",
  buildEncryptedLocalSecretRef: (id: string) => ({
    source: "encrypted-local",
    provider: "default",
    id,
  }),
  putEncryptedLocalSecret: (args: { id: string; value: string; masterKey: string }) => h.put(args),
  deleteEncryptedLocalSecret: (id: string) => h.del(id),
  resolveEncryptedLocalMasterKeyRef: () => ({
    source: "env",
    provider: "default",
    id: "OPENBOT_SECRET_MASTER_KEY",
  }),
}));

vi.mock("../../secrets/resolve.js", () => ({
  resolveSecretRefString: vi.fn(async () => {
    if (!h.masterKey.value) {
      throw new Error("master key missing");
    }
    return h.masterKey.value;
  }),
}));

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: vi.fn(async () => h.billing),
}));

vi.mock("../enterprise-data/enterprise-data-seat-context.js", () => ({
  requireResolvedEnterpriseAdminTenantId: vi.fn(
    async (args: { respond: (ok: boolean, p?: unknown, e?: unknown) => void }) => {
      if (!h.adminTenant.value) {
        args.respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "not enterprise admin",
        });
        return null;
      }
      return h.adminTenant.value;
    },
  ),
  resolveTrustedSessionEmployeeId: vi.fn(async () => h.employeeId.value),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
  writeConfigFile: vi.fn(),
}));

vi.mock("../../agents/cli-backend-credential-resolve.js", () => ({
  verifyCliBackendCredential: vi.fn(async () => ({
    valid: true,
    resolvedKeys: ["OPENAI_API_KEY"],
    failedKeys: [],
  })),
}));

import { upsertCliBackendCredential } from "../../agents/cli-backend-credential-store.js";
import { cliBackendHandlers } from "./cli-backend.js";

type RespondArgs = { ok: boolean; payload?: unknown; error?: unknown };
function capture() {
  const calls: RespondArgs[] = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) =>
    calls.push({ ok, payload, error });
  return { calls, respond };
}

function ctx(
  params: Record<string, unknown>,
  respond: ReturnType<typeof capture>["respond"],
  sessionDomain?: "platform" | "enterprise" | "employee",
) {
  return {
    params,
    respond,
    client: { user: "u@example.com", connId: "c1", ...(sessionDomain ? { sessionDomain } : {}) },
    req: {},
    isWebchatConnect: () => false,
    context: { logGateway: { info: () => {} } },
  } as never;
}

describe("cliBackend.credential.scoped* — delegated self-service authorization", () => {
  beforeEach(() => {
    h.credStore.clear();
    h.billing.enterpriseId = null;
    h.adminTenant.value = null;
    h.employeeId.value = "emp-1";
    h.masterKey.value = "master-key-xyz";
    h.put.mockClear();
    h.del.mockClear();
    vi.mocked(upsertCliBackendCredential).mockClear();
  });

  it("rejects scopedSet without an enterprise/employee session", async () => {
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedSet"](
      ctx({ backendId: "codex-cli", envVars: { OPENAI_API_KEY: "sk-x" } }, respond),
    );
    expect(calls[0]?.ok).toBe(false);
    expect(upsertCliBackendCredential).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it("employee scopedSet stores a personal credential with server-derived identity (ignores client tenantId/subjectId/scope)", async () => {
    h.billing.enterpriseId = "tenant-1";
    h.employeeId.value = "emp-1";
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedSet"](
      ctx(
        {
          backendId: "codex-cli",
          envVars: { OPENAI_API_KEY: "sk-personal-raw" },
          // Attacker-supplied identity — must be ignored.
          tenantId: "tenant-EVIL",
          subjectId: "someone-else",
          scope: "enterprise",
        },
        respond,
        "employee",
      ),
    );
    expect(calls[0]?.ok).toBe(true);
    // Raw value encrypted at rest (never passed to the credential store).
    expect(h.put).toHaveBeenCalledTimes(1);
    expect(h.put.mock.calls[0]?.[0]).toMatchObject({ value: "sk-personal-raw" });
    const upsertArg = vi.mocked(upsertCliBackendCredential).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(upsertArg.scope).toBe("personal");
    expect(upsertArg.tenantId).toBe("tenant-1"); // derived, not tenant-EVIL
    expect(upsertArg.subjectId).toBe("emp-1"); // derived, not someone-else
    expect(upsertArg.backendId).toBe("codex-cli");
    const envVars = upsertArg.envVars as Record<string, { source: string }>;
    expect(envVars.OPENAI_API_KEY.source).toBe("encrypted-local");
  });

  it("enterprise scopedSet stores an enterprise (shared) credential for the admin's own tenant", async () => {
    h.adminTenant.value = "tenant-9";
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedSet"](
      ctx(
        { backendId: "codex-cli", envVars: { OPENAI_API_KEY: "sk-shared" } },
        respond,
        "enterprise",
      ),
    );
    expect(calls[0]?.ok).toBe(true);
    const upsertArg = vi.mocked(upsertCliBackendCredential).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(upsertArg.scope).toBe("enterprise");
    expect(upsertArg.tenantId).toBe("tenant-9");
    expect(upsertArg.subjectId).toBeUndefined();
  });

  it("enterprise scopedSet is rejected when the caller is not an enterprise admin", async () => {
    h.adminTenant.value = null; // requireResolvedEnterpriseAdminTenantId responds + returns null
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedSet"](
      ctx({ backendId: "codex-cli", envVars: { OPENAI_API_KEY: "sk" } }, respond, "enterprise"),
    );
    expect(calls[0]?.ok).toBe(false);
    expect(upsertCliBackendCredential).not.toHaveBeenCalled();
  });

  it("scopedSet fails clearly when the gateway master key is unavailable", async () => {
    h.billing.enterpriseId = "tenant-1";
    h.masterKey.value = null;
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedSet"](
      ctx({ backendId: "codex-cli", envVars: { OPENAI_API_KEY: "sk" } }, respond, "employee"),
    );
    expect(calls[0]?.ok).toBe(false);
    expect((calls[0]?.error as { message?: string })?.message).toMatch(/master key/i);
    expect(upsertCliBackendCredential).not.toHaveBeenCalled();
  });

  it("employee scopedList returns only the caller's own personal credentials", async () => {
    h.billing.enterpriseId = "tenant-1";
    h.employeeId.value = "emp-1";
    h.credStore.set("usr:tenant-1:emp-1:codex-cli", {
      credentialId: "usr:tenant-1:emp-1:codex-cli",
      tenantId: "tenant-1",
      scope: "personal",
      subjectId: "emp-1",
      backendId: "codex-cli",
      envVars: { OPENAI_API_KEY: { source: "encrypted-local", provider: "default", id: "x" } },
      updatedAt: "t",
    });
    h.credStore.set("usr:tenant-1:emp-2:codex-cli", {
      credentialId: "usr:tenant-1:emp-2:codex-cli",
      tenantId: "tenant-1",
      scope: "personal",
      subjectId: "emp-2",
      backendId: "codex-cli",
      envVars: {},
      updatedAt: "t",
    });
    h.credStore.set("ent:tenant-1:codex-cli", {
      credentialId: "ent:tenant-1:codex-cli",
      tenantId: "tenant-1",
      scope: "enterprise",
      backendId: "codex-cli",
      envVars: {},
      updatedAt: "t",
    });
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedList"](ctx({}, respond, "employee"));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      scope: string;
      credentials: Array<{ credentialId: string }>;
    };
    expect(payload.scope).toBe("personal");
    expect(payload.credentials.map((c) => c.credentialId)).toEqual([
      "usr:tenant-1:emp-1:codex-cli",
    ]);
  });

  it("employee scopedRemove will not remove an enterprise credential (scope mismatch)", async () => {
    h.billing.enterpriseId = "tenant-1";
    h.employeeId.value = "emp-1";
    // Only an enterprise cred exists; employee remove derives a personal id and finds nothing.
    h.credStore.set("ent:tenant-1:codex-cli", {
      credentialId: "ent:tenant-1:codex-cli",
      tenantId: "tenant-1",
      scope: "enterprise",
      backendId: "codex-cli",
      envVars: {},
      updatedAt: "t",
    });
    const { calls, respond } = capture();
    await cliBackendHandlers["cliBackend.credential.scopedRemove"](
      ctx({ backendId: "codex-cli" }, respond, "employee"),
    );
    expect(calls[0]?.ok).toBe(true);
    expect((calls[0]?.payload as { removed?: boolean } | undefined)?.removed).toBe(false);
    expect(h.credStore.has("ent:tenant-1:codex-cli")).toBe(true);
  });
});
