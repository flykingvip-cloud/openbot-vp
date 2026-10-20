import { beforeEach, describe, expect, it } from "vitest";
import {
  publishAccountComputerObserver,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "../../agents/sandbox/account-computer-stream.js";
import { resetNoVncObserverTokensForTests } from "../../agents/sandbox/novnc-auth.js";
import {
  resetSecureFormHandoffWaitForTests,
  waitForHandoffReturn,
} from "../../agents/sandbox/secure-form-handoff-wait.js";
import { browserPreviewHandlers } from "./browser-preview.js";
import type { GatewayClient } from "./types.js";

function client(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return {
    sessionEnterpriseId: "tenant-1",
    platformUserId: "user-1",
    ...overrides,
  } as GatewayClient;
}

async function call(params: Record<string, unknown>, viewer: GatewayClient | null = client()) {
  const respond = viRespond();
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  await browserPreviewHandlers["browser.preview"]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context: {
      broadcast: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
    } as never,
    req: { type: "req", id: "req-1", method: "browser.preview" },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

function viRespond() {
  const calls: Array<[boolean, unknown?, { message?: string }?]> = [];
  return {
    calls,
    fn: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      calls.push([ok, payload, error]);
    },
  };
}

describe("browser.preview", () => {
  beforeEach(() => {
    resetAccountComputerSlotsForTests();
    resetNoVncObserverTokensForTests();
    resetSecureFormHandoffWaitForTests();
    setAccountBrowserLivenessForTests(async () => "running");
  });

  it("rejects client profile and computer identity keys", async () => {
    for (const key of ["profile", "accountId", "computerId", "cdpPort", "containerName"]) {
      const result = await call({ action: "status", [key]: "nope" });
      expect(result.calls[0]?.[0]).toBe(false);
      expect(result.calls[0]?.[2]?.message).toContain("does not accept");
    }
  });

  it("fails closed when the signed-in account is missing or mismatched", async () => {
    const missing = await call({ action: "open" }, client({ platformUserId: "" }));
    expect(missing.calls[0]?.[0]).toBe(false);
    const mismatch = await call({ action: "status" }, client({ sessionTenantId: "other-tenant" }));
    expect(mismatch.calls[0]?.[0]).toBe(false);
  });

  it("returns one stream for the signed-in account and nothing for anyone else", async () => {
    publishAccountComputerObserver({
      tenantId: "tenant-1",
      userId: "user-1",
      noVncPort: 6080,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-a",
      containerName: "openbot-sb-browser-a",
      agentLabel: "Ada",
    });
    const opened = await call({ action: "open" });
    const payload = opened.calls[0]?.[1] as Record<string, unknown>;
    expect(opened.calls[0]?.[0]).toBe(true);
    expect(payload.status).toBe("READY");
    expect(String(payload.streamUrl)).toMatch(/^\/sandbox\/novnc\?token=/);
    expect(String(payload.streamUrl)).not.toContain("127.0.0.1");
    expect(JSON.stringify(payload)).not.toContain("secret-vnc");
    expect(JSON.stringify(payload)).not.toContain("openbot-sb-browser-a");
    expect(JSON.stringify(payload)).not.toContain("6080");
    expect(Object.keys(payload).toSorted()).toEqual(
      ["controlledBy", "status", "streamUrl", "tenantId", "userId"].toSorted(),
    );

    const other = await call({ action: "open" }, client({ platformUserId: "user-2" }));
    const otherPayload = other.calls[0]?.[1] as Record<string, unknown>;
    expect(otherPayload.status).toBe("COLD");
    expect(otherPayload.streamUrl).toBeUndefined();
  });

  it("drops a live preview when the browser container has exited", async () => {
    setAccountBrowserLivenessForTests(async () => "stopped");
    publishAccountComputerObserver({
      tenantId: "tenant-1",
      userId: "user-1",
      noVncPort: 40795,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-dead",
      containerName: "aw-browser-user-dead",
    });
    const opened = await call({ action: "open" });
    const payload = opened.calls[0]?.[1] as Record<string, unknown>;
    expect(opened.calls[0]?.[0]).toBe(true);
    expect(payload.status).toBe("COLD");
    expect(payload.streamUrl).toBeUndefined();
    expect(String(payload.failure)).toContain("已退出");
    expect(JSON.stringify(payload)).not.toContain("secret-vnc");
  });

  it("keys the open stream by platformUserId and rejects an email", async () => {
    const platformUserId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    publishAccountComputerObserver({
      tenantId: "tenant-1",
      userId: platformUserId,
      noVncPort: 6080,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-a",
      containerName: "openbot-sb-browser-a",
      agentLabel: "Ada",
    });
    const opened = await call(
      { action: "open" },
      client({
        user: "ada@example.com",
        platformUserId,
        sessionEnterpriseId: "tenant-1",
      }),
    );
    const payload = opened.calls[0]?.[1] as Record<string, unknown>;
    expect(opened.calls[0]?.[0]).toBe(true);
    expect(payload.userId).toBe(platformUserId);
    expect(String(payload.userId)).not.toContain("@");
    expect(String(payload.streamUrl)).toMatch(/^\/sandbox\/novnc\?token=/);

    const emailKeyed = await call(
      { action: "open" },
      client({
        user: "ada@example.com",
        platformUserId: "ada@example.com",
        sessionEnterpriseId: "tenant-1",
      }),
    );
    expect(emailKeyed.calls[0]?.[0]).toBe(false);
  });

  it("names the signed-in user while that session holds input", async () => {
    publishAccountComputerObserver({
      tenantId: "tenant-1",
      userId: "user-1",
      noVncPort: 6080,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-a",
      containerName: "openbot-sb-browser-a",
      agentLabel: "Ada",
    });
    const taken = await call({ action: "open", sessionKey: "chat-a", takeControl: true });
    const takenPayload = taken.calls[0]?.[1] as { controlledBy: { kind: string; label: string } };
    expect(takenPayload.controlledBy).toEqual({ kind: "user", label: "user-1" });
    const watching = await call({ action: "status", sessionKey: "chat-b" });
    const watchingPayload = watching.calls[0]?.[1] as {
      controlledBy: { kind: string; label: string };
    };
    expect(watchingPayload.controlledBy).toEqual({ kind: "user", label: "user-1" });
    const released = await call({
      action: "open",
      sessionKey: "chat-a",
      releaseControl: true,
    });
    const releasedPayload = released.calls[0]?.[1] as {
      controlledBy: { kind: string; label: string };
    };
    expect(releasedPayload.controlledBy).toEqual({ kind: "agent", label: "Ada" });
  });

  it("broadcasts secure_form.handoff_returned on successful releaseControl", async () => {
    publishAccountComputerObserver({
      tenantId: "tenant-1",
      userId: "user-1",
      noVncPort: 6080,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-a",
      containerName: "openbot-sb-browser-a",
      agentLabel: "Ada",
    });
    await call({ action: "open", sessionKey: "chat-a", takeControl: true });
    const waiting = waitForHandoffReturn({ sessionKey: "chat-a", timeoutMs: 5_000 });
    const released = await call({
      action: "open",
      sessionKey: "chat-a",
      releaseControl: true,
      explicitHandback: true,
    });
    expect(released.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(true);
    const evt = released.broadcasts.find((b) => b.event === "secure_form.handoff_returned");
    expect(evt?.payload).toEqual({ sessionKey: "chat-a", resume: "manual_handback" });
    expect(JSON.stringify(evt?.payload)).not.toContain("secret");
    await expect(waiting).resolves.toBe("handoff_returned");
  });
});
