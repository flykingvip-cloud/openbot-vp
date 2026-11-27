import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient } from "./client.js";
const target = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;
it.skipIf(!target)("reads the nominated Wave2 space with real signed v2 HTTP", async () => {
  const keyFile = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
  if (!keyFile) {
    throw new Error("Explicit isolated fixture key file required");
  }
  const url = new URL(target!);
  if (
    url.hostname !== "127.0.0.1" ||
    [3000, 3001, 8000, 8002, 8090, 8091].includes(Number(url.port))
  ) {
    throw new Error("Isolated allowed loopback target required");
  }
  const client = new KnowledgeSdkClient({
    enabled: true,
    environment: "test",
    allowedTenantIds: ["fixture-tenant-a"],
    baseUrl: target!,
    timeoutMs: 5000,
    secret: fs.readFileSync(keyFile, "utf8").trim(),
  });
  const result = await client.request("/v2/spaces", "GET", {
    issuer: "https://sandbox.example.invalid",
    subjectId: "sandbox-owner",
    tenantId: "fixture-tenant-a",
    policyGeneration: 1,
    actorType: "human",
    agentId: "fixture-agent-private",
    requestId: "m2b-live",
    roles: ["member"],
    departmentIds: ["fixture-department"],
    orgRoles: ["admin", "metrics_admin"],
    clearanceLevel: "internal",
    sessionId: "sandbox-session-sandbox-owner",
  });
  expect(Array.isArray(result)).toBe(true);
  expect((result as { tenant_id: string }[]).every((x) => x.tenant_id === "fixture-tenant-a")).toBe(
    true,
  );
});

it.skipIf(!target)(
  "rejects unbound, nonmember and cross-tenant access; writes are idempotent",
  async () => {
    const keyFile = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
    if (!keyFile) {
      throw new Error("Explicit fixture key file required");
    }
    const actor = {
      issuer: "https://sandbox.example.invalid",
      subjectId: "sandbox-owner",
      tenantId: "fixture-tenant-a",
      policyGeneration: 1,
      actorType: "human" as const,
      agentId: "fixture-agent-private",
      requestId: "m2b-negative",
      roles: ["member"],
      departmentIds: ["fixture-department"],
      orgRoles: ["admin", "metrics_admin"],
      clearanceLevel: "internal",
      sessionId: "sandbox-session-sandbox-owner",
    };
    const client = new KnowledgeSdkClient({
      enabled: true,
      environment: "test",
      allowedTenantIds: ["fixture-tenant-a", "fixture-tenant-b"],
      baseUrl: target!,
      timeoutMs: 5000,
      secret: fs.readFileSync(keyFile, "utf8").trim(),
    });
    const path = "/v2/assets/fixture-tenant-a-private-doc";
    await expect(client.request(path, "GET", { ...actor, agentId: "unbound" })).rejects.toThrow();
    await expect(
      client.request(path, "GET", {
        ...actor,
        subjectId: "sandbox-reader",
        orgRoles: [],
        sessionId: "sandbox-session-sandbox-reader",
      }),
    ).rejects.toThrow();
    await expect(
      client.request(path, "GET", { ...actor, tenantId: "fixture-tenant-b" }),
    ).rejects.toThrow();
    await expect(client.request(path, "GET", { ...actor, subjectId: "" })).rejects.toThrow();
    await expect(client.request(path, "GET", { ...actor, tenantId: "" })).rejects.toThrow();
    await expect(
      client.request(path, "GET", {
        ...actor,
        subjectId: "sandbox-inactive",
        orgRoles: [],
        sessionId: "sandbox-session-sandbox-inactive",
      }),
    ).rejects.toThrow();
    const payload = {
      kb_id: "fixture-tenant-a-private",
      content: "m2b stable retry document",
      filename: "m2b.txt",
      asset_type: "document",
      idempotency_key: "m2b-retry",
    };
    const first = await client.request("/v2/assets", "POST", actor, payload, "m2b-retry");
    expect(await client.request("/v2/assets", "POST", actor, payload, "m2b-retry")).toEqual(first);
    await expect(
      client.request(
        "/v2/assets",
        "POST",
        actor,
        { ...payload, content: "different" },
        "m2b-retry",
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  },
);

it.skipIf(!target)("A09 live controlled write remains an unpublished draft", async () => {
  const keyFile = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
  if (!keyFile) {
    throw new Error("Explicit fixture key required");
  }
  const client = new KnowledgeSdkClient({
    enabled: true,
    environment: "test",
    allowedTenantIds: ["fixture-tenant-a"],
    baseUrl: target!,
    timeoutMs: 5000,
    secret: fs.readFileSync(keyFile, "utf8").trim(),
  });
  const actor = {
    issuer: "https://sandbox.example.invalid",
    subjectId: "sandbox-owner",
    tenantId: "fixture-tenant-a",
    policyGeneration: 1,
    actorType: "human" as const,
    agentId: "m2b-controlled-agent",
    requestId: "m2b-controlled",
    roles: ["member"],
    departmentIds: ["fixture-department"],
    orgRoles: ["admin", "metrics_admin"],
    clearanceLevel: "internal",
    sessionId: "sandbox-session-sandbox-owner",
  };
  const response = (await client.request(
    "/v2/assets",
    "POST",
    actor,
    {
      kb_id: "m2b-controlled",
      content: "controlled draft fixture",
      filename: "draft.txt",
      asset_type: "document",
      idempotency_key: "m2b-draft",
    },
    "m2b-draft",
  )) as { activated: boolean; lifecycle_state: string };
  expect(response.lifecycle_state).toBe("draft");
  expect(response.activated).toBe(false);
});
