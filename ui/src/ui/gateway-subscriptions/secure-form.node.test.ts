import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import { handleSecureFormGatewayEvent, type SecureFormGatewayHost } from "./secure-form.ts";

const NOW = 1_800_000_000_000;

function host(sessionKey = "session:main"): SecureFormGatewayHost {
  return {
    sessionKey,
    secureFormOffered: null,
    secureFormValues: {},
    secureFormBusy: false,
    secureFormError: null,
    secureFormReceipt: null,
    secureFormHandoff: null,
  } as unknown as SecureFormGatewayHost;
}

function offered(overrides: Record<string, unknown> = {}): GatewayEventFrame {
  return {
    event: "secure_form.offered",
    payload: {
      formId: "f1",
      sessionKey: "session:main",
      agentLabel: "Agent",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "password", kind: "password", label: "密码", ref: "e1" }],
      createdAt: NOW,
      tenantId: "t1",
      userId: "u1",
      ...overrides,
    },
  } as unknown as GatewayEventFrame;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("secure form subscription", () => {
  it("stores offered for the current sessionKey", () => {
    const h = host();
    expect(handleSecureFormGatewayEvent(h as unknown as GatewayHost, offered())).toBe(true);
    expect(h.secureFormOffered?.formId).toBe("f1");
    expect(h.secureFormOffered?.domain.host).toBe("login.example.com");
  });

  it("ignores offered for a different sessionKey", () => {
    const h = host("session:other");
    expect(handleSecureFormGatewayEvent(h as unknown as GatewayHost, offered())).toBe(true);
    expect(h.secureFormOffered).toBeNull();
  });

  it("clears the card on receipt", () => {
    const h = host();
    handleSecureFormGatewayEvent(h as unknown as GatewayHost, offered());
    h.secureFormValues = { password: "x" };
    expect(
      handleSecureFormGatewayEvent(
        h as unknown as GatewayHost,
        {
          event: "secure_form.receipt",
          payload: { formId: "f1", status: "filled", completedAt: NOW },
        } as GatewayEventFrame,
      ),
    ).toBe(true);
    expect(h.secureFormOffered).toBeNull();
    expect(h.secureFormValues).toEqual({});
    expect(h.secureFormReceipt?.status).toBe("filled");
  });

  it("stores handoff_active for the current sessionKey", () => {
    const h = host();
    expect(
      handleSecureFormGatewayEvent(
        h as unknown as GatewayHost,
        {
          event: "secure_form.handoff_active",
          payload: {
            sessionKey: "session:main",
            instruction: "请在右侧电脑完成登录。",
            reason: "sso",
            controlledBy: { kind: "user", label: "user-1" },
          },
        } as GatewayEventFrame,
      ),
    ).toBe(true);
    expect(h.secureFormHandoff?.instruction).toContain("请在右侧电脑完成登录");
    expect(h.secureFormOffered).toBeNull();
  });

  it("clears handoff on handoff_returned", () => {
    const h = host();
    h.secureFormHandoff = {
      sessionKey: "session:main",
      instruction: "hint",
    };
    expect(
      handleSecureFormGatewayEvent(
        h as unknown as GatewayHost,
        {
          event: "secure_form.handoff_returned",
          payload: { sessionKey: "session:main" },
        } as GatewayEventFrame,
      ),
    ).toBe(true);
    expect(h.secureFormHandoff).toBeNull();
  });
});
