import { describe, expect, it, vi } from "vitest";
import {
  KnowledgeSdkClient,
  KnowledgeSdkError,
  KNOWLEDGE_SDK_V2_ROUTE_PURPOSES,
  purposeForV2Route,
  signRequest,
} from "./client.js";

const actor = {
  issuer: "https://idp.test",
  subjectId: "user-1",
  tenantId: "fixture-tenant",
  policyGeneration: 1,
  actorType: "human" as const,
  agentId: "agent-1",
  requestId: "request-1",
  roles: ["reader"],
  departmentIds: ["dept-1"],
  orgRoles: ["member"],
  clearanceLevel: "standard",
  sessionId: "session-1",
  profileGeneration: 2,
};

const config = {
  enabled: true,
  environment: "test" as const,
  allowedTenantIds: ["fixture-tenant"],
  baseUrl: "http://127.0.0.1:9999",
  timeoutMs: 1000,
  secret: "TEST_ONLY_DO_NOT_USE_IN_PROD_0123456789abcdef",
};

const SDK_ACTOR_CHARSET = /^[A-Za-z0-9\-_=]+$/;

const WAVE2_ROUTE_EXAMPLES: ReadonlyArray<{
  route: keyof typeof KNOWLEDGE_SDK_V2_ROUTE_PURPOSES;
  method: "GET" | "POST";
  path: string;
}> = [
  { route: "POST /v2/spaces", method: "POST", path: "/v2/spaces" },
  { route: "GET /v2/spaces", method: "GET", path: "/v2/spaces" },
  { route: "GET /v2/spaces/{kb_id}", method: "GET", path: "/v2/spaces/kb-primary" },
  { route: "POST /v2/assets", method: "POST", path: "/v2/assets" },
  { route: "GET /v2/assets/{doc_id}", method: "GET", path: "/v2/assets/doc-1" },
  {
    route: "POST /v2/assets/{doc_id}:rollback",
    method: "POST",
    path: "/v2/assets/doc-1:rollback",
  },
  { route: "POST /v2/retrieval:search", method: "POST", path: "/v2/retrieval:search" },
  { route: "POST /v2/citations:verify", method: "POST", path: "/v2/citations:verify" },
];

function headerMap(init: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(init);
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function decodeActor(header: string): { purpose: string } {
  expect(header).toMatch(SDK_ACTOR_CHARSET);
  expect(header).not.toMatch(/[+/]/);
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { purpose: string };
}

describe("v2 IdentityContext signing against SDK pin 9940818b", () => {
  it("encodes X-KB-Actor as base64url IdentityContext and omits legacy agent/purpose headers", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await new KnowledgeSdkClient(config, transport).request("/v2/assets", "POST", actor, {
      title: "doc",
    });
    const headers = headerMap(transport.mock.calls[0]?.[1]?.headers);
    expect(headers["x-kb-agent"]).toBeUndefined();
    expect(headers["x-kb-purpose"]).toBeUndefined();
    expect(headers["x-tenant-id"]).toBe(actor.tenantId);
    expect(headers["x-request-id"]).toBe(actor.requestId);
    const actorHeader = headers["x-kb-actor"] ?? "";
    const context = JSON.parse(Buffer.from(actorHeader, "base64url").toString("utf8")) as {
      request_id: string;
      tenant_id: string;
      purpose: string;
      actor: { actor_type: string; subject_id: string; session_id: string };
      agent: { agent_id: string; profile_generation: number; task_id: string };
    };
    expect(actorHeader).toMatch(SDK_ACTOR_CHARSET);
    expect(actorHeader).not.toMatch(/[+/]/);
    expect(context.request_id).toBe(actor.requestId);
    expect(context.tenant_id).toBe(actor.tenantId);
    expect(context.actor.actor_type).toBe("human");
    expect(context.actor.subject_id).toBe(actor.subjectId);
    expect(context.actor.session_id).toBe(actor.sessionId);
    expect(context.agent.agent_id).toBe(actor.agentId);
    expect(context.agent.profile_generation).toBe(2);
    expect(context.agent.task_id).toBe("");
    expect(context.purpose).toBe("read");
    const body = transport.mock.calls[0]?.[1]?.body;
    expect(headers["x-kb-signature"]).toBe(
      signRequest(
        {
          method: "POST",
          target: "/v2/assets",
          actorHeader,
          timestamp: headers["x-kb-timestamp"] ?? "",
          nonce: headers["x-kb-nonce"] ?? "",
          body: typeof body === "string" ? body : "",
        },
        config.secret,
      ),
    );
  });

  it("maps each exact Wave2 route to IdentityContext purpose read", async () => {
    expect(Object.keys(KNOWLEDGE_SDK_V2_ROUTE_PURPOSES)).toHaveLength(8);
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    const client = new KnowledgeSdkClient(config, transport);
    for (const example of WAVE2_ROUTE_EXAMPLES) {
      expect(KNOWLEDGE_SDK_V2_ROUTE_PURPOSES[example.route]).toBe("read");
      expect(purposeForV2Route(example.method, example.path)).toBe("read");
      transport.mockClear();
      await client.request(
        example.path,
        example.method,
        actor,
        example.method === "POST" ? {} : undefined,
      );
      const headers = headerMap(transport.mock.calls[0]?.[1]?.headers);
      expect(headers["x-kb-purpose"]).toBeUndefined();
      expect(decodeActor(headers["x-kb-actor"] ?? "").purpose).toBe("read");
    }
  });

  it.each([
    ["POST", "/v2/search"],
    ["GET", "/v2/assets"],
    ["POST", "/v2/spaces/kb-primary"],
    ["GET", "/v2/spaces/"],
    ["GET", "/v2/spaces/kb/extra"],
    ["POST", "/v2/assets/doc-1"],
    ["GET", "/v2/assets/doc-1:rollback"],
    ["POST", "/v2/assets?kb=1"],
  ] as const)("rejects unmapped %s %s fail-closed", async (method, path) => {
    expect(() => purposeForV2Route(method, path)).toThrowError(KnowledgeSdkError);
    const transport = vi.fn<typeof fetch>();
    await expect(
      new KnowledgeSdkClient(config, transport).request(path, method, actor, {}),
    ).rejects.toMatchObject({ code: "INVALID_SDK_CONFIGURATION" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates IDEMPOTENCY_CONFLICT from a 409 machine-code envelope", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "IDEMPOTENCY_CONFLICT" } }), { status: 409 }),
      );
    await expect(
      new KnowledgeSdkClient(config, transport).request("/v2/assets", "POST", actor, {}, "key-1"),
    ).rejects.toMatchObject({
      name: "KnowledgeSdkError",
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    } satisfies Partial<KnowledgeSdkError>);
  });

  it("maps a 409 without a machine code to SDK_REQUEST_DENIED", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 409 }));
    await expect(
      new KnowledgeSdkClient(config, transport).request("/v2/assets", "POST", actor, {}, "key-1"),
    ).rejects.toMatchObject({
      name: "KnowledgeSdkError",
      code: "SDK_REQUEST_DENIED",
      status: 409,
    } satisfies Partial<KnowledgeSdkError>);
  });
});
