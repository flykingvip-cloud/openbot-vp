import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  publishAccountComputerObserver,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "../../agents/sandbox/account-computer-stream.js";
import { resetNoVncObserverTokensForTests } from "../../agents/sandbox/novnc-auth.js";
import { setHandoffGateProbeForTests } from "../../agents/sandbox/secure-form-handoff-gate-probe.js";
import { resetSecureFormHandoffWaitForTests } from "../../agents/sandbox/secure-form-handoff-wait.js";
import { resetSecureFormStoreForTests } from "../../agents/sandbox/secure-form-store.js";
import { browserPreviewHandlers } from "./browser-preview.js";
import { secureFormHandlers } from "./secure-form.js";
import type { GatewayClient } from "./types.js";

function client(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return {
    sessionEnterpriseId: "tenant-1",
    platformUserId: "user-1",
    ...overrides,
  } as GatewayClient;
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

function makeContext() {
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  return {
    broadcasts,
    context: {
      broadcast: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
    } as never,
  };
}

async function callSecure(
  method: keyof typeof secureFormHandlers,
  params: Record<string, unknown>,
  viewer: GatewayClient | null = client(),
) {
  const respond = viRespond();
  const { broadcasts, context } = makeContext();
  await secureFormHandlers[method]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context,
    req: { type: "req", id: "req-1", method },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

async function callPreview(
  params: Record<string, unknown>,
  viewer: GatewayClient | null = client(),
) {
  const respond = viRespond();
  const { broadcasts, context } = makeContext();
  await browserPreviewHandlers["browser.preview"]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context,
    req: { type: "req", id: "req-2", method: "browser.preview" },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

describe("secure_form P5b handoff", () => {
  beforeEach(() => {
    resetAccountComputerSlotsForTests();
    setAccountBrowserLivenessForTests(async () => "running");
    resetNoVncObserverTokensForTests();
    resetSecureFormStoreForTests();
    resetSecureFormHandoffWaitForTests();
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
  });

  afterEach(() => {
    setHandoffGateProbeForTests(null);
    resetSecureFormHandoffWaitForTests();
    resetSecureFormStoreForTests();
    resetAccountComputerSlotsForTests();
  });

  it("broadcasts secure_form.handoff_active after handoff takeControl", async () => {
    const result = await callSecure("secure_form.handoff", {
      sessionKey: "chat-a",
      reason: "sso",
      instruction: "请在右侧电脑完成登录。",
    });
    expect(result.calls[0]?.[0]).toBe(true);
    const active = result.broadcasts.find((b) => b.event === "secure_form.handoff_active");
    expect(active).toBeTruthy();
    const payload = active?.payload as Record<string, unknown>;
    expect(payload.sessionKey).toBe("chat-a");
    expect(payload.instruction).toBe("请在右侧电脑完成登录。");
    expect(payload.reason).toBe("sso");
    expect((payload.controlledBy as { kind: string })?.kind).toBe("user");
    expect(JSON.stringify(payload)).not.toContain("secret-vnc");
    const response = result.calls[0]?.[1] as Record<string, unknown>;
    expect(response.status).toBe("handoff_active");
    expect(JSON.stringify(response)).not.toContain("secret-vnc");
  });

  it("await_return resolves when explicitHandback releaseControl broadcasts manual_handback", async () => {
    await callSecure("secure_form.handoff", {
      sessionKey: "chat-a",
      reason: "passkey",
    });
    const waiting = callSecure("secure_form.await_return", {
      sessionKey: "chat-a",
      timeoutMs: 5_000,
    });
    // Let the waiter register
    await new Promise((r) => setTimeout(r, 20));
    const released = await callPreview({
      action: "open",
      sessionKey: "chat-a",
      releaseControl: true,
      explicitHandback: true,
    });
    expect(released.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(true);
    const awaited = await waiting;
    expect(awaited.calls[0]?.[0]).toBe(true);
    const body = awaited.calls[0]?.[1] as Record<string, unknown>;
    expect(body.status).toBe("handoff_returned");
    expect(body.resume).toBe("manual_handback");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("ambient releaseControl during mid-gate wait does not abort as manual_handback", async () => {
    await callSecure("secure_form.handoff", {
      sessionKey: "chat-ambient",
      reason: "qr",
    });
    let n = 0;
    const { setHandoffGateProbeForTests } =
      await import("../../agents/sandbox/secure-form-handoff-gate-probe.js");
    setHandoffGateProbeForTests(async () => {
      n += 1;
      // Stay uncleared for a few polls, then clear — proves ambient release did not wake early.
      return n >= 4
        ? { signedInAttr: "true" as const }
        : { signedInAttr: null, href: "https://www.zhihu.com/signin" };
    });
    const waiting = callSecure("secure_form.await_return", {
      sessionKey: "chat-ambient",
      timeoutMs: 5_000,
      pollIntervalMs: 30,
    });
    await new Promise((r) => setTimeout(r, 25));
    // Ambient default-AI open: releaseControl without explicitHandback (UI race).
    const ambient = await callPreview({
      action: "open",
      sessionKey: "chat-ambient",
      releaseControl: true,
    });
    expect(ambient.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(false);
    const awaited = await waiting;
    expect(awaited.calls[0]?.[0]).toBe(true);
    const body = awaited.calls[0]?.[1] as Record<string, unknown>;
    expect(body.status).toBe("handoff_returned");
    expect(body.resume).toBe("auto_gate_cleared");
  });

  it("await_return resolves immediately within grace after notify", async () => {
    // Simulate a return that already happened
    const { notifyHandoffReturned } =
      await import("../../agents/sandbox/secure-form-handoff-wait.js");
    notifyHandoffReturned("chat-grace");
    const result = await callSecure("secure_form.await_return", {
      sessionKey: "chat-grace",
      timeoutMs: 1_000,
    });
    expect(result.calls[0]?.[0]).toBe(true);
    const graceBody = result.calls[0]?.[1] as { status?: string } | undefined;
    expect(graceBody?.status).toBe("handoff_returned");
  });

  it("await_return auto-resumes when page gate clears (no 交给AI click)", async () => {
    let n = 0;
    setHandoffGateProbeForTests(async () => {
      n += 1;
      return n >= 2 ? { signedInAttr: "true" } : { signedInAttr: null };
    });
    await callSecure("secure_form.handoff", {
      sessionKey: "chat-auto",
      reason: "qr",
    });
    const waiting = callSecure("secure_form.await_return", {
      sessionKey: "chat-auto",
      timeoutMs: 5_000,
      pollIntervalMs: 40,
    });
    const awaited = await waiting;
    expect(awaited.calls[0]?.[0]).toBe(true);
    expect((awaited.calls[0]?.[1] as { status?: string })?.status).toBe("handoff_returned");
    expect(awaited.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(true);
    const payload = awaited.broadcasts.find((b) => b.event === "secure_form.handoff_returned")
      ?.payload as { resume?: string };
    expect(payload.resume).toBe("auto_gate_cleared");
  });

  it("default handoff instruction is concise auto-continue copy", async () => {
    const SHORT = "请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。";
    const result = await callSecure("secure_form.handoff", {
      sessionKey: "chat-copy",
      reason: "sms",
    });
    const active = result.broadcasts.find((b) => b.event === "secure_form.handoff_active");
    const instruction = String((active?.payload as { instruction?: string })?.instruction ?? "");
    expect(instruction).toBe(SHORT);
    expect(instruction).not.toMatch(/完成后点「交给AI」/);
    expect(instruction).not.toContain("无需点「交给AI」");
    expect(instruction).not.toContain("不用点「交给AI」");
    expect(instruction).not.toContain("当前保持 AI 接管");
    expect(instruction).not.toContain("有二维码扫码和手机号");
    expect(instruction).not.toContain("页面快照");
    expect(instruction).not.toContain("二选一");
  });

  it("qr/sms ignore verbose agent instruction — single short remind only", async () => {
    const SHORT = "请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。";
    const verbose =
      "云电脑浏览器已经打开知乎登录页，并用页面快照确认了状态：页面仍然停留在登录页，登录方式可以扫码或短信验证码二选一。";
    for (const reason of ["qr", "sms"] as const) {
      const result = await callSecure("secure_form.handoff", {
        sessionKey: `chat-force-${reason}`,
        reason,
        instruction: `${verbose}\n${SHORT}`,
      });
      const active = result.broadcasts.find((b) => b.event === "secure_form.handoff_active");
      const instruction = String((active?.payload as { instruction?: string })?.instruction ?? "");
      expect(instruction).toBe(SHORT);
      expect(instruction).not.toContain("页面快照");
      expect(instruction).not.toContain("二选一");
      expect(instruction).not.toContain("知乎登录页");
    }
  });
});
