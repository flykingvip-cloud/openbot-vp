import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-knowledge-source-tool-${process.pid}`);
const permissionContext = vi.hoisted(() => ({ userId: "user-1" }));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../../gateway/knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    seatId: "seat-1",
    userId: permissionContext.userId,
    hasEnterpriseScope: true,
  })),
}));

const { createKnowledgeSourceTool } = await import("./knowledge-source-tool.js");
const { createKnowledgeBase } = await import("../../gateway/knowledge/knowledge-base-store.js");
const { listKnowledgeSourceBindings } =
  await import("../../gateway/knowledge/sources/source-binding-store.js");
const { bindKnowledgeSource } =
  await import("../../gateway/knowledge/sources/source-binding-store.js");

describe("knowledge_source tool", () => {
  beforeEach(() => {
    permissionContext.userId = "user-1";
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    createKnowledgeBase({
      title: "External Sources",
      ownerId: "user-1",
      tenantId: "tenant-1",
      visibility: "enterprise",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("requires explicit confirmation before binding", async () => {
    const tool = createKnowledgeSourceTool({ gatewayClientUser: "user@example.com" });
    const knowledgeBaseId = createKnowledgeBase({
      title: "Second",
      ownerId: "user-1",
      visibility: "private",
    }).id;
    await expect(
      tool.execute("call-1", {
        action: "bind",
        knowledgeBaseId,
        title: "Provider API",
        endpoint: "https://api.example.test",
        authHeader: "X-API-Key",
        credentialRef: { source: "env", provider: "default", id: "PROVIDER_API_KEY" },
      }),
    ).rejects.toThrow(/confirmed=true/);
  });

  it("refuses plaintext credentials and persists only a SecretRef", async () => {
    const tool = createKnowledgeSourceTool({ gatewayClientUser: "user@example.com" });
    const listing = (await tool.execute("call-list", { action: "list" })).details as {
      knowledgeBases: Array<{ id: string; title: string }>;
    };
    const knowledgeBaseId = listing.knowledgeBases.find(
      (knowledgeBase) => knowledgeBase.title === "External Sources",
    )!.id;

    await expect(
      tool.execute("call-plain", {
        action: "bind",
        confirmed: true,
        knowledgeBaseId,
        title: "Provider API",
        endpoint: "https://api.example.test",
        authHeader: "X-API-Key",
        apiKey: "plaintext-must-not-be-accepted",
      }),
    ).rejects.toThrow(/credentialRef is required/);

    const result = await tool.execute("call-bind", {
      action: "bind",
      confirmed: true,
      knowledgeBaseId,
      title: "Provider API",
      endpoint: "https://api.example.test",
      authHeader: "X-API-Key",
      credentialRef: { source: "env", provider: "default", id: "PROVIDER_API_KEY" },
      method: "GET",
      path: "/v1/capabilities",
      catalogPath: "/v1/capabilities",
      routingSummary: "Market data queries",
      routingKeywords: "market,quote,price",
    });

    expect(JSON.stringify(result)).not.toContain("plaintext-must-not-be-accepted");
    const bindings = listKnowledgeSourceBindings({ ownerId: "user-1", knowledgeBaseId });
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.metadata?.["auth.apiKey"]).toBeUndefined();
    expect(JSON.parse(bindings[0].metadata!["auth.secretRef"])).toEqual({
      source: "env",
      provider: "default",
      id: "PROVIDER_API_KEY",
    });
    expect(bindings[0]?.metadata?.["routing.summary"]).toBe("Market data queries");
    expect(bindings[0]?.metadata?.["routing.keywords"]).toBe("market,quote,price");
  });

  it("lists an enterprise source for a different user with knowledge-base read access", async () => {
    const knowledgeBase = createKnowledgeBase({
      title: "Shared Sources",
      ownerId: "owner-user",
      tenantId: "tenant-1",
      visibility: "enterprise",
    });
    const source = bindKnowledgeSource({
      kind: "api",
      title: "Shared Provider",
      knowledgeBaseId: knowledgeBase.id,
      ownerId: "owner-user",
      visibility: "enterprise",
      endpoint: "https://api.example.test",
      metadata: { "auth.secretRef": "{}" },
    });
    permissionContext.userId = "member-user";

    const tool = createKnowledgeSourceTool({ gatewayClientUser: "member@example.com" });
    const listing = (await tool.execute("call-list-shared", { action: "list" })).details as {
      sources: Array<{ id: string }>;
    };

    expect(listing.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: source.id })]),
    );
  });

  it("lists knowledge bases when only a platform user id is present", async () => {
    const tool = createKnowledgeSourceTool({ gatewayClientPlatformUserId: "user-1" });
    const listing = (await tool.execute("call-list-platform", { action: "list" })).details as {
      ok: boolean;
      knowledgeBases: Array<{ id: string }>;
    };
    expect(listing.ok).toBe(true);
    expect(listing.knowledgeBases.length).toBeGreaterThan(0);
  });

  it("still rejects when no trusted identity is available", async () => {
    const tool = createKnowledgeSourceTool();
    await expect(tool.execute("call-none", { action: "list" })).rejects.toThrow(
      /Signed-in employee session is required/,
    );
  });
});
