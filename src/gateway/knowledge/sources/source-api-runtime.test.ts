import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApiSourceCatalog,
  invokeApiSource,
  syncApiSourceCatalog,
  validateApiSourceEndpoint,
} from "./source-api-runtime.js";
import { bindKnowledgeSource } from "./source-binding-store.js";
import type { KnowledgeSourceContext } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-source-api-runtime-${process.pid}`);
const bindingsStorePath = path.join(tmpDir, "bindings.json");
const catalogStorePath = path.join(tmpDir, "catalogs.json");
const context: KnowledgeSourceContext = {
  tenantId: "tenant-1",
  seatId: "seat-1",
  userId: "user-1",
  hasEnterpriseScope: true,
};

function bindApi(metadata: Record<string, string>) {
  return bindKnowledgeSource(
    {
      kind: "api",
      title: "Example API",
      knowledgeBaseId: "kb-1",
      ownerId: context.userId!,
      endpoint: "https://api.example.test",
      metadata,
    },
    bindingsStorePath,
  );
}

describe("source API runtime", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves an environment SecretRef without persisting or returning the secret", async () => {
    const source = bindApi({
      "auth.header": "Authorization",
      "auth.scheme": "Bearer",
      "auth.secretRef": JSON.stringify({
        source: "env",
        provider: "default",
        id: "SOURCE_TEST_TOKEN",
      }),
    });
    const fetchFn = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-value");
      expect(init?.redirect).toBe("manual");
      return new Response(JSON.stringify({ ok: true, rows: [{ id: 1 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await invokeApiSource(source.id, "/v1/query", context, {
      bindingsStorePath,
      env: { SOURCE_TEST_TOKEN: "secret-value" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.data).toEqual({ ok: true, rows: [{ id: 1 }] });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("synchronizes a capability catalog through the bound origin", async () => {
    const source = bindApi({ "catalog.path": "/v1/capabilities" });
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      expect(url instanceof URL ? url.href : typeof url === "string" ? url : url.url).toBe(
        "https://api.example.test/v1/capabilities",
      );
      return new Response(
        JSON.stringify({ summary: "Example catalog", capabilities: [{ name: "query" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const catalog = await syncApiSourceCatalog(source.id, context, {
      bindingsStorePath,
      catalogStorePath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(catalog.summary).toBe("Example catalog");
    expect(catalog.entries).toEqual([{ name: "query" }]);
    expect(getApiSourceCatalog(source.id, { catalogStorePath })).toEqual(catalog);
  });

  it("normalizes legacy catalogs whose entries are not an array", () => {
    fs.writeFileSync(
      catalogStorePath,
      JSON.stringify({
        catalogs: {
          legacy: { sourceId: "legacy", fetchedAtMs: 1, summary: "Legacy", entries: null },
        },
      }),
    );

    expect(getApiSourceCatalog("legacy", { catalogStorePath })).toEqual({
      sourceId: "legacy",
      fetchedAtMs: 1,
      summary: "Legacy",
      entries: [],
    });
  });

  it("allows a caller only when an upstream permission check authorizes the knowledge base", async () => {
    const source = bindKnowledgeSource(
      {
        kind: "api",
        title: "Enterprise API",
        knowledgeBaseId: "kb-enterprise",
        ownerId: "another-user",
        endpoint: "https://api.example.test",
        metadata: {},
      },
      bindingsStorePath,
    );
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await expect(
      invokeApiSource(source.id, "/query", context, { bindingsStorePath, fetchFn }),
    ).rejects.toThrow(/not authorized/);
    await expect(
      invokeApiSource(source.id, "/query", context, {
        bindingsStorePath,
        fetchFn,
        authorizedKnowledgeBaseIds: new Set(["kb-enterprise"]),
      }),
    ).resolves.toMatchObject({ data: { ok: true } });
  });

  it("rejects private targets and cross-origin request paths", async () => {
    expect(() => validateApiSourceEndpoint("http://127.0.0.1:8080", true)).toThrow(
      /network policy/,
    );
    const source = bindApi({});
    await expect(
      invokeApiSource(source.id, "https://other.example.test/query", context, {
        bindingsStorePath,
        fetchFn: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/bound origin/);
  });

  it("rejects a legacy inline-credential binding over plaintext HTTP", async () => {
    // A legacy inline auth.apiKey must NOT silently relax transport security. Without an
    // explicit request.allowHttp, an http endpoint is refused at the URL policy stage.
    const source = bindKnowledgeSource(
      {
        kind: "api",
        title: "Legacy HTTP API",
        knowledgeBaseId: "kb-1",
        ownerId: context.userId!,
        endpoint: "http://public.example.test",
        metadata: { "auth.header": "X-API-Key", "auth.apiKey": "legacy-secret" },
      },
      bindingsStorePath,
    );
    const fetchFn = vi.fn() as unknown as typeof fetch;

    await expect(
      invokeApiSource(source.id, "/status", context, { bindingsStorePath, fetchFn }),
    ).rejects.toThrow(/requires HTTPS/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses to transmit credentials over HTTP even when allowHttp is explicit", async () => {
    // Explicit request.allowHttp permits credential-less HTTP, but a credential header
    // must never traverse a plaintext transport.
    const source = bindKnowledgeSource(
      {
        kind: "api",
        title: "AllowHttp credential API",
        knowledgeBaseId: "kb-1",
        ownerId: context.userId!,
        endpoint: "http://public.example.test",
        metadata: {
          "request.allowHttp": "true",
          "auth.header": "X-API-Key",
          "auth.apiKey": "legacy-secret",
        },
      },
      bindingsStorePath,
    );
    const fetchFn = vi.fn() as unknown as typeof fetch;

    await expect(
      invokeApiSource(source.id, "/status", context, { bindingsStorePath, fetchFn }),
    ).rejects.toThrow(/non-HTTPS transport/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("allows credential-less public HTTP when allowHttp is explicit", async () => {
    const source = bindKnowledgeSource(
      {
        kind: "api",
        title: "Public HTTP API",
        knowledgeBaseId: "kb-1",
        ownerId: context.userId!,
        endpoint: "http://public.example.test",
        metadata: { "request.allowHttp": "true" },
      },
      bindingsStorePath,
    );
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      invokeApiSource(source.id, "/status", context, {
        bindingsStorePath,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ data: { ok: true } });
  });

  it("forwards abortSignal to fetch", async () => {
    const source = bindApi({ "request.allowHttp": "true" });
    const fetchFn = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const abort = new AbortController();
    await invokeApiSource(source.id, "/status", context, {
      bindingsStorePath,
      fetchFn: fetchFn as unknown as typeof fetch,
      abortSignal: abort.signal,
    });
    expect(fetchFn).toHaveBeenCalled();
  });

  it("refuses redirects and oversized responses", async () => {
    const source = bindApi({});
    await expect(
      invokeApiSource(source.id, "/redirect", context, {
        bindingsStorePath,
        fetchFn: vi.fn(async () => new Response(null, { status: 302 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/redirect refused/);
    await expect(
      invokeApiSource(source.id, "/large", context, {
        bindingsStorePath,
        fetchFn: vi.fn(
          async () =>
            new Response("{}", {
              status: 200,
              headers: { "content-length": String(2 * 1024 * 1024 + 1) },
            }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/exceeds 2 MiB/);
  });
});
