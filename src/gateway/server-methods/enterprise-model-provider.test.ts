// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-enterprise-model-rpc-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const scopeState = {
  enterpriseId: "ent-a",
  isEnterpriseAdmin: true,
};

vi.mock("../billing/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../billing/scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: scopeState.enterpriseId,
      user: { id: "user-1" },
      membership: null,
      isEnterpriseAdmin: scopeState.isEnterpriseAdmin,
      permissions: new Set([actual.USAGE_BUDGET_PERMISSION]),
    })),
  };
});

const { enterpriseModelProviderHandlers } = await import("./enterprise-model-provider.js");
const { enterpriseModelCatalogHandlers } = await import("./enterprise-model-catalog.js");
const { listEnterpriseModelAuditEvents } = await import("../enterprise-model/audit.js");
const { __resetEnterpriseModelVaultKeyCacheForTest } =
  await import("../enterprise-model/credential-vault.js");

const allHandlers = {
  ...enterpriseModelProviderHandlers,
  ...enterpriseModelCatalogHandlers,
};

type HandlerError = { code?: string; message?: string; details?: { code?: string } };

async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = allHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  __resetEnterpriseModelVaultKeyCacheForTest();
  scopeState.enterpriseId = "ent-a";
  scopeState.isEnterpriseAdmin = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("enterprise-model-provider.*", () => {
  it("creates connection, saves credential, and never returns apiKey in list", async () => {
    const created = await invoke<{
      connection: {
        connectionId: string;
        hasCredential: boolean;
        secretHint?: string;
        status: string;
      };
    }>("enterprise-model-provider.create", {
      providerType: "openai-compatible",
      displayName: "Corp OpenAI",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "sk-secret-value-abcd",
    });
    expect(created.ok).toBe(true);
    expect(created.payload.connection.hasCredential).toBe(true);
    expect(created.payload.connection.secretHint).toBe("…abcd");
    expect(created.payload.connection.status).toBe("credential_saved");
    expect(JSON.stringify(created.payload)).not.toContain("sk-secret-value-abcd");

    const listed = await invoke<{ connections: Array<Record<string, unknown>> }>(
      "enterprise-model-provider.list",
    );
    expect(listed.ok).toBe(true);
    expect(listed.payload.connections).toHaveLength(1);
    expect(JSON.stringify(listed.payload)).not.toContain("sk-secret-value-abcd");
    expect(JSON.stringify(listed.payload)).not.toMatch(/"apiKey"/);
  });

  it("rejects non-admin writes", async () => {
    scopeState.isEnterpriseAdmin = false;
    const res = await invoke("enterprise-model-provider.create", {
      providerType: "openai",
      displayName: "Nope",
      apiKey: "sk-x",
    });
    expect(res.ok).toBe(false);
    expect(res.error.details?.code).toBe("ENTERPRISE_MODEL_FORBIDDEN");
  });

  it("isolates tenants: B cannot list A's connections", async () => {
    await invoke("enterprise-model-provider.create", {
      providerType: "openai",
      displayName: "A only",
      apiKey: "sk-a-1111",
    });
    scopeState.enterpriseId = "ent-b";
    const listed = await invoke<{ connections: unknown[] }>("enterprise-model-provider.list");
    expect(listed.payload.connections).toHaveLength(0);
  });

  it("tests connection via probe and records audit without secrets", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [{ id: "gpt-test" }, { id: "gpt-other" }] }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const created = await invoke<{ connection: { connectionId: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "Probe",
        baseUrl: "https://llm.example.com/v1",
        apiKey: "sk-probe-9999",
      },
    );
    const tested = await invoke<{
      ok: boolean;
      code: string;
      discoveredModels: Array<{ upstreamModelId: string }>;
      connection: { status: string };
    }>("enterprise-model-provider.test", {
      connectionId: created.payload.connection.connectionId,
    });
    expect(tested.ok).toBe(true);
    expect(tested.payload.ok).toBe(true);
    expect(tested.payload.code).toBe("OK");
    expect(tested.payload.discoveredModels.map((m) => m.upstreamModelId)).toEqual([
      "gpt-test",
      "gpt-other",
    ]);
    expect(tested.payload.connection.status).toBe("models_discovered");
    expect(JSON.stringify(tested.payload)).not.toContain("sk-probe-9999");

    const events = await listEnterpriseModelAuditEvents("ent-a");
    expect(events.some((e) => e.action === "connection.tested" && e.result === "success")).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toContain("sk-probe-9999");
    vi.unstubAllGlobals();
  });

  it("probes a private self-hosted base URL for a saved enterprise connection", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: [{ id: "qwen-local" }] }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const created = await invoke<{ connection: { connectionId: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "内网",
        baseUrl: "http://10.0.0.8:8000/v1",
        apiKey: "sk-private-1111",
      },
    );
    const tested = await invoke<{
      ok: boolean;
      code: string;
      discoveredModels: Array<{ upstreamModelId: string }>;
    }>("enterprise-model-provider.test", {
      connectionId: created.payload.connection.connectionId,
    });
    expect(tested.ok).toBe(true);
    expect(tested.payload.ok).toBe(true);
    expect(tested.payload.discoveredModels.map((model) => model.upstreamModelId)).toEqual([
      "qwen-local",
    ]);
    expect(fetchImpl).toHaveBeenCalled();
    const input = fetchImpl.mock.calls.at(0)?.[0];
    if (typeof input !== "string") {
      throw new Error("expected fetch to be called with a URL string");
    }
    expect(input).toContain("10.0.0.8");
    vi.unstubAllGlobals();
  });

  it("rotates credential with rollback on failed probe", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          // first rotate attempt fails
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json({ data: [{ id: "m1" }] });
      }),
    );

    const created = await invoke<{ connection: { connectionId: string; secretHint?: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "Rotate",
        baseUrl: "https://llm.example.com/v1",
        apiKey: "sk-old-key-1111",
      },
    );
    const connectionId = created.payload.connection.connectionId;

    const failed = await invoke("enterprise-model-provider.rotate-credential", {
      connectionId,
      apiKey: "sk-bad-key-2222",
    });
    expect(failed.ok).toBe(false);
    expect(failed.error.details?.code).toBe("ENTERPRISE_MODEL_INVALID_CREDENTIAL");

    // Old key still works for a subsequent successful rotate
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "m1" }] })),
    );
    const ok = await invoke<{ connection: { secretHint?: string; status: string } }>(
      "enterprise-model-provider.rotate-credential",
      {
        connectionId,
        apiKey: "sk-new-key-3333",
      },
    );
    expect(ok.ok).toBe(true);
    expect(ok.payload.connection.secretHint).toBe("…3333");
    expect(JSON.stringify(ok.payload)).not.toContain("sk-new-key-3333");
    vi.unstubAllGlobals();
  });

  it("blocks delete when enabled assets exist unless force", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "gpt-x" }] })),
    );
    const created = await invoke<{ connection: { connectionId: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "Del",
        baseUrl: "https://llm.example.com/v1",
        apiKey: "sk-del-4444",
      },
    );
    const connectionId = created.payload.connection.connectionId;
    const registered = await invoke("enterprise-model-catalog.register", {
      connectionId,
      upstreamModelId: "gpt-x",
    });
    expect(registered.ok).toBe(true);

    const blocked = await invoke("enterprise-model-provider.delete", { connectionId });
    expect(blocked.ok).toBe(false);
    expect(blocked.error.details?.code).toBe("ENTERPRISE_MODEL_DEPENDENCY_BLOCKED");

    const forced = await invoke("enterprise-model-provider.delete", {
      connectionId,
      force: true,
    });
    expect(forced.ok).toBe(true);
    const listed = await invoke<{ connections: unknown[] }>("enterprise-model-provider.list");
    expect(listed.payload.connections).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe("enterprise model asset health", () => {
  it("registers unknown until the connection is verified, then inherits healthy", async () => {
    const created = await invoke<{ connection: { connectionId: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "Private",
        baseUrl: "https://llm.example.com/v1",
        apiKey: "sk-private-1234",
      },
    );
    const connectionId = created.payload.connection.connectionId;
    const early = await invoke<{
      asset: { assetId: string; healthStatus: string; runtimeModelId: string };
    }>("enterprise-model-catalog.register", {
      connectionId,
      upstreamModelId: "private-model",
    });
    expect(early.ok).toBe(true);
    expect(early.payload.asset.healthStatus).toBe("unknown");

    const {
      getEnterpriseModelAsset,
      listActiveTenantOwnedModelIds,
      promoteEnabledEnterpriseModelAssets,
    } = await import("../enterprise-model/asset-store.js");
    const { updateEnterpriseModelConnection } =
      await import("../enterprise-model/connection-store.js");
    expect(await listActiveTenantOwnedModelIds("ent-a")).not.toContain(
      early.payload.asset.runtimeModelId,
    );

    await updateEnterpriseModelConnection({
      tenantId: "ent-a",
      connectionId,
      status: "verified",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });
    expect(await promoteEnabledEnterpriseModelAssets("ent-a", connectionId)).toBe(1);
    const healed = await getEnterpriseModelAsset("ent-a", early.payload.asset.assetId);
    expect(healed?.healthStatus).toBe("healthy");
    expect(await listActiveTenantOwnedModelIds("ent-a")).toContain(
      early.payload.asset.runtimeModelId,
    );

    const second = await invoke<{
      asset: { healthStatus: string; runtimeModelId: string };
    }>("enterprise-model-catalog.register", {
      connectionId,
      upstreamModelId: "private-model-2",
    });
    expect(second.ok).toBe(true);
    expect(second.payload.asset.healthStatus).toBe("healthy");
    expect(await listActiveTenantOwnedModelIds("ent-a")).toContain(
      second.payload.asset.runtimeModelId,
    );
  });
});

describe("enterprise-model-catalog.*", () => {
  it("registers tenant-isolated runtimeModelIds for same upstream across tenants", async () => {
    const createdA = await invoke<{ connection: { connectionId: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "A",
        baseUrl: "https://a.example/v1",
        apiKey: "sk-a",
      },
    );
    const regA = await invoke<{ asset: { runtimeModelId: string } }>(
      "enterprise-model-catalog.register",
      {
        connectionId: createdA.payload.connection.connectionId,
        upstreamModelId: "gpt-4o",
      },
    );
    expect(regA.ok).toBe(true);
    expect(regA.payload.asset.runtimeModelId.startsWith("ent/")).toBe(true);

    scopeState.enterpriseId = "ent-b";
    const createdB = await invoke<{ connection: { connectionId: string } }>(
      "enterprise-model-provider.create",
      {
        providerType: "openai-compatible",
        displayName: "B",
        baseUrl: "https://b.example/v1",
        apiKey: "sk-b",
      },
    );
    const regB = await invoke<{ asset: { runtimeModelId: string } }>(
      "enterprise-model-catalog.register",
      {
        connectionId: createdB.payload.connection.connectionId,
        upstreamModelId: "gpt-4o",
      },
    );
    expect(regB.payload.asset.runtimeModelId).not.toBe(regA.payload.asset.runtimeModelId);
    expect(regB.payload.asset.runtimeModelId).not.toContain("ent-a");
    expect(regB.payload.asset.runtimeModelId).not.toContain("ent-b");
  });
});
