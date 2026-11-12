import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { decodeBase64Bytes } from "../exec-protocol/checksum.js";
import {
  TEST_TENANT,
  baseSubmitBody,
  inlineJsonInput,
  startIsolatedPair,
  uniqueIdempotencyKey,
  waitFor,
  type IsolatedPair,
} from "../exec-protocol/test-helpers.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { explicitIsolationFacadeFields } from "./exec-protocol-config.js";
import {
  EXEC_PROTOCOL_ARTIFACT_ID_HEADER,
  EXEC_PROTOCOL_BYTE_COUNT_HEADER,
  EXEC_PROTOCOL_SHA256_HEADER,
  EXEC_PROTOCOL_TASK_ID_HEADER,
  handleExecProtocolHttpRequest,
} from "./exec-protocol-http.js";

const OTHER_TENANT = "tenant-isolation-2";
const USER = "iso-user@example.com";

const trustedProxyAuth: ResolvedGatewayAuth = {
  mode: "trusted-proxy",
  allowTailscale: false,
  trustedProxy: {
    userHeader: "x-forwarded-user",
    tenantHeader: "x-tenant-id",
  },
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sessionHeaders(
  tenantId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "x-forwarded-user": USER,
    "x-tenant-id": tenantId,
    ...extra,
  };
}

describe("gateway exec-protocol HTTP facade", () => {
  const servers: Server[] = [];
  const pairs: IsolatedPair[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    await Promise.all(pairs.splice(0).map((pair) => pair.stop()));
  });

  afterAll(async () => {
    await Promise.all(pairs.splice(0).map((pair) => pair.stop()));
  });

  async function startFacade(params: {
    pair: IsolatedPair;
    auth?: ResolvedGatewayAuth;
    env?: NodeJS.ProcessEnv;
    enabled?: boolean;
    extraExecProtocol?: Record<string, unknown>;
  }): Promise<{ port: number; url: string }> {
    const enabled = params.enabled ?? true;
    const execProtocol = {
      enabled,
      leaseToken: params.pair.leaseToken,
      controlPlaneUrl: params.pair.a.baseUrl,
      ...explicitIsolationFacadeFields(params.pair.configA),
      ...params.extraExecProtocol,
    };
    const auth = params.auth ?? trustedProxyAuth;
    const server = createServer((req, res) => {
      void handleExecProtocolHttpRequest(req, res, {
        auth,
        trustedProxies: ["127.0.0.1", "::1"],
        execProtocol,
        env: params.env ?? {},
      }).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: { message: "not owned", type: "not_owned" } }));
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind facade test port");
    }
    return { port: address.port, url: `http://127.0.0.1:${address.port}` };
  }

  async function listenDisabled(): Promise<string> {
    const server = createServer((req, res) => {
      void handleExecProtocolHttpRequest(req, res, {
        auth: { mode: "token", token: "unused", allowTailscale: false },
        trustedProxies: ["127.0.0.1"],
        execProtocol: { enabled: false },
        env: {},
      }).then((handled) => {
        if (!handled) {
          res.statusCode = 599;
          res.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind disabled facade test port");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("does not own unrelated paths, and returns 404 when the facade is disabled", async () => {
    const baseUrl = await listenDisabled();
    const notOwned = await fetch(`${baseUrl}/v1/tasks/artifact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(notOwned.status).toBe(599);
    const disabled = await fetch(`${baseUrl}/v1/exec-protocol/tasks/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(disabled.status).toBe(404);
    const json = (await disabled.json()) as { error?: { type?: string } };
    expect(json.error?.type).toBe("not_found");
  });

  it("refuses production execution mode on the gateway product path", async () => {
    const pair = await startIsolatedPair();
    pairs.push(pair);
    const { url } = await startFacade({
      pair,
      env: { OPENBOT_PRODUCTION_EXECUTION_MODE: "production" },
    });
    const res = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(TEST_TENANT),
      },
      body: JSON.stringify({ taskId: "tsk_dummy" }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error?: { type?: string; message?: string } };
    expect(json.error?.type).toBe("exec_protocol_production_refused");
    expect(json.error?.message).toMatch(/isolation-only/);
    expect(JSON.stringify(json)).not.toContain(pair.leaseToken);
  });

  it("submits, queries status, and downloads a sha256-verified artifact through the gateway", async () => {
    const pair = await startIsolatedPair();
    pairs.push(pair);
    const { url } = await startFacade({ pair });
    const toolCallId = uniqueIdempotencyKey("tool");
    const submittedRes = await fetch(`${url}/v1/exec-protocol/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(TEST_TENANT),
      },
      body: JSON.stringify(
        baseSubmitBody({ toolCallId, input: inlineJsonInput({ message: "via-gw" }) }),
      ),
    });
    expect(submittedRes.status).toBe(201);
    const submitted = (await submittedRes.json()) as { taskId: string; toolCallId: string };
    expect(submitted.taskId).toMatch(/^tsk_[a-f0-9]{32}$/);

    const done = await waitFor(
      async () => {
        const statusRes = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...sessionHeaders(TEST_TENANT),
          },
          body: JSON.stringify({ taskId: submitted.taskId }),
        });
        const payload = (await statusRes.json()) as {
          state?: string;
          artifacts?: Array<{ artifactId: string; sha256: string; byteCount: number }>;
        };
        return { status: statusRes.status, payload };
      },
      (result) => result.status === 200 && result.payload.state === "succeeded",
    );
    expect(done.payload.artifacts).toHaveLength(1);
    const artifact = done.payload.artifacts?.[0];
    if (!artifact) {
      throw new Error("expected an artifact on the succeeded task");
    }

    const jsonDownload = await fetch(`${url}/v1/exec-protocol/tasks/artifact`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(TEST_TENANT),
      },
      body: JSON.stringify({
        taskId: submitted.taskId,
        artifactId: artifact.artifactId,
        includeBytes: true,
      }),
    });
    expect(jsonDownload.status).toBe(200);
    const jsonBody = (await jsonDownload.json()) as {
      sha256: string;
      byteCount: number;
      bytesBase64?: string;
      delivered: boolean;
      artifactId: string;
      taskId: string;
    };
    expect(jsonBody.delivered).toBe(true);
    expect(jsonBody.artifactId).toBe(artifact.artifactId);
    expect(jsonBody.taskId).toBe(submitted.taskId);
    expect(typeof jsonBody.bytesBase64).toBe("string");
    const jsonBytes = decodeBase64Bytes(jsonBody.bytesBase64 ?? "");
    expect(sha256Hex(jsonBytes)).toBe(jsonBody.sha256);
    expect(jsonBody.sha256).toBe(artifact.sha256);
    expect(jsonBytes.byteLength).toBe(jsonBody.byteCount);

    const raw = await fetch(
      `${url}/v1/exec-protocol/tasks/${submitted.taskId}/artifacts/${artifact.artifactId}`,
      { headers: sessionHeaders(TEST_TENANT) },
    );
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("application/octet-stream");
    const rawBytes = new Uint8Array(await raw.arrayBuffer());
    const headerSha = raw.headers.get(EXEC_PROTOCOL_SHA256_HEADER);
    expect(headerSha).toBe(artifact.sha256);
    expect(sha256Hex(rawBytes)).toBe(headerSha);
    expect(raw.headers.get(EXEC_PROTOCOL_ARTIFACT_ID_HEADER)).toBe(artifact.artifactId);
    expect(raw.headers.get(EXEC_PROTOCOL_TASK_ID_HEADER)).toBe(submitted.taskId);
    expect(raw.headers.get(EXEC_PROTOCOL_BYTE_COUNT_HEADER)).toBe(String(rawBytes.byteLength));
    expect(Buffer.from(rawBytes).equals(Buffer.from(jsonBytes))).toBe(true);
  });

  it("rejects a session that tries to download another tenant's artifact", async () => {
    const pair = await startIsolatedPair();
    pairs.push(pair);
    const { url } = await startFacade({ pair });
    const submittedRes = await fetch(`${url}/v1/exec-protocol/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(TEST_TENANT),
      },
      body: JSON.stringify(baseSubmitBody({ input: inlineJsonInput({ message: "tenant-a" }) })),
    });
    const submitted = (await submittedRes.json()) as { taskId: string };
    const done = await waitFor(
      async () => {
        const statusRes = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...sessionHeaders(TEST_TENANT),
          },
          body: JSON.stringify({ taskId: submitted.taskId }),
        });
        return (await statusRes.json()) as {
          state?: string;
          artifacts?: Array<{ artifactId: string }>;
        };
      },
      (payload) => payload.state === "succeeded",
    );
    const artifactId = done.artifacts?.[0]?.artifactId;
    if (!artifactId) {
      throw new Error("expected an artifact");
    }

    const stolen = await fetch(
      `${url}/v1/exec-protocol/tasks/${submitted.taskId}/artifacts/${artifactId}`,
      { headers: sessionHeaders(OTHER_TENANT) },
    );
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(stolen.status).not.toBe(200);
    const body = await stolen.text();
    expect(body).not.toContain("via-gw");
    expect(body).not.toContain(pair.leaseToken);

    const spoofedBody = await fetch(`${url}/v1/exec-protocol/tasks/artifact`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(OTHER_TENANT),
      },
      body: JSON.stringify({
        tenantId: TEST_TENANT,
        taskId: submitted.taskId,
        artifactId,
        includeBytes: true,
      }),
    });
    expect(spoofedBody.status).toBe(403);
    const spoofedJson = (await spoofedBody.json()) as { error?: { type?: string } };
    expect(spoofedJson.error?.type).toBe("exec_protocol_tenant_mismatch");
  });

  it("requires a tenant-bearing session and does not treat a bare forged loopback header as enough in tight mode without a hop", async () => {
    const pair = await startIsolatedPair();
    pairs.push(pair);
    const { url } = await startFacade({
      pair,
      auth: {
        mode: "trusted-proxy",
        allowTailscale: false,
        trustedProxy: {
          userHeader: "x-forwarded-user",
          tenantHeader: "x-tenant-id",
          rejectDirectLoopbackIdentityHeaders: true,
        },
      },
    });
    const res = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-user": "forged-attacker@iso-t163.invalid",
        "x-tenant-id": TEST_TENANT,
      },
      body: JSON.stringify({ taskId: "tsk_dummy" }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error?: { type?: string } };
    expect(json.error?.type).toBe("exec_protocol_tenant_required");
  });

  it("downloads an artifact in tight mode when the designated entry hop credential is presented", async () => {
    const pair = await startIsolatedPair();
    pairs.push(pair);
    const { url } = await startFacade({
      pair,
      auth: {
        mode: "trusted-proxy",
        allowTailscale: false,
        trustedProxy: {
          userHeader: "x-forwarded-user",
          tenantHeader: "x-tenant-id",
          rejectDirectLoopbackIdentityHeaders: true,
          entryHopCredential: "iso-entry-hop-credential",
        },
      },
    });
    const submittedRes = await fetch(`${url}/v1/exec-protocol/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(TEST_TENANT, { "x-openbot-entry-hop": "iso-entry-hop-credential" }),
      },
      body: JSON.stringify(baseSubmitBody({ input: inlineJsonInput({ message: "hop-ok" }) })),
    });
    expect(submittedRes.status).toBe(201);
    const submitted = (await submittedRes.json()) as { taskId: string };
    const done = await waitFor(
      async () => {
        const statusRes = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...sessionHeaders(TEST_TENANT, { "x-openbot-entry-hop": "iso-entry-hop-credential" }),
          },
          body: JSON.stringify({ taskId: submitted.taskId }),
        });
        return (await statusRes.json()) as {
          state?: string;
          artifacts?: Array<{ artifactId: string; sha256: string }>;
        };
      },
      (payload) => payload.state === "succeeded",
    );
    const artifact = done.artifacts?.[0];
    if (!artifact) {
      throw new Error("expected an artifact");
    }
    const raw = await fetch(
      `${url}/v1/exec-protocol/tasks/${submitted.taskId}/artifacts/${artifact.artifactId}`,
      {
        headers: sessionHeaders(TEST_TENANT, { "x-openbot-entry-hop": "iso-entry-hop-credential" }),
      },
    );
    expect(raw.status).toBe(200);
    const rawBytes = new Uint8Array(await raw.arrayBuffer());
    expect(sha256Hex(rawBytes)).toBe(raw.headers.get(EXEC_PROTOCOL_SHA256_HEADER));
    expect(raw.headers.get(EXEC_PROTOCOL_SHA256_HEADER)).toBe(artifact.sha256);
  });
});
