import { describe, expect, it } from "vitest";
import {
  assertDiagnosisCanarySessionKey,
  deliverDiagnosisViaOfficialLiveGateway,
  isGatewayAuthOrAuthorizationError,
  isGatewayTimeoutError,
  type OfficialDiagnosisGatewayCall,
  type OfficialLiveSendTrace,
} from "./official-live-send.js";
import {
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "./production-cutover.js";
import { DiagnosisContractError } from "./types.js";

function trace(): OfficialLiveSendTrace {
  return { methods: [], resetKeys: [], skippedInjectBecauseAuth: false };
}

function input(overrides: { sessionKey?: string; tenantId?: string } = {}) {
  return {
    sessionKey: overrides.sessionKey ?? DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
    tenantId: overrides.tenantId ?? DIAGNOSIS_P24_5_CANARY_TENANT,
    text: "【诊断提醒】isolated fixture",
    deliveryId: "dlv-iso-1",
  };
}

describe("official diagnosis live send", () => {
  it("refuses non-canary session keys before any gateway call", async () => {
    expect(() => assertDiagnosisCanarySessionKey("someone-else-session")).toThrow(
      DiagnosisContractError,
    );
    const calls: string[] = [];
    const call: OfficialDiagnosisGatewayCall = async (opts) => {
      calls.push(opts.method);
      return {};
    };
    await expect(
      deliverDiagnosisViaOfficialLiveGateway(input({ sessionKey: "someone-else-session" }), {
        call,
      }),
    ).rejects.toMatchObject({ code: "canary_session_mismatch" });
    expect(calls).toEqual([]);
  });

  it("refuses non-canary tenants before any gateway call", async () => {
    const calls: string[] = [];
    await expect(
      deliverDiagnosisViaOfficialLiveGateway(input({ tenantId: "tenant-foreign" }), {
        call: async (opts) => {
          calls.push(opts.method);
          return {};
        },
      }),
    ).rejects.toMatchObject({ code: "canary_tenant_mismatch" });
    expect(calls).toEqual([]);
  });

  it("accepts a successful chat.send with deliver:false and does not inject", async () => {
    const seen: Array<{ method: string; params: unknown }> = [];
    const t = trace();
    const result = await deliverDiagnosisViaOfficialLiveGateway(input(), {
      trace: t,
      call: async (opts) => {
        seen.push({ method: opts.method, params: opts.params });
        return { ok: true };
      },
    });
    expect(result).toBe("accepted");
    expect(t.methods).toEqual(["chat.send"]);
    expect(seen[0]?.params).toEqual(
      expect.objectContaining({
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
        deliver: false,
        idempotencyKey: "dlv-iso-1",
      }),
    );
  });

  it("falls back to chat.inject after send already wrote but the response timed out", async () => {
    const t = trace();
    const result = await deliverDiagnosisViaOfficialLiveGateway(input(), {
      trace: t,
      call: async (opts) => {
        if (opts.method === "chat.send") {
          throw new Error("gateway timeout after 200ms\nurl: ws://127.0.0.1:9");
        }
        return { ok: true };
      },
    });
    expect(
      isGatewayTimeoutError(new Error("gateway timeout after 200ms\nurl: ws://127.0.0.1:9")),
    ).toBe(true);
    expect(result).toBe("accepted");
    expect(t.methods).toEqual(["chat.send", "chat.inject"]);
    expect(t.skippedInjectBecauseAuth).toBe(false);
  });

  it("does not bypass an authorization failure via chat.inject", async () => {
    const t = trace();
    const result = await deliverDiagnosisViaOfficialLiveGateway(input(), {
      trace: t,
      call: async (opts) => {
        if (opts.method === "chat.send") {
          const err = new Error("unauthorized: invalid token");
          (err as { code?: string }).code = "UNAUTHORIZED";
          throw err;
        }
        throw new Error("inject must not be called after auth failure");
      },
    });
    expect(isGatewayAuthOrAuthorizationError(new Error("UNAUTHORIZED: invalid token"))).toBe(true);
    expect(result).toBe("unauthorized");
    expect(t.methods).toEqual(["chat.send"]);
    expect(t.skippedInjectBecauseAuth).toBe(true);
  });

  it("returns unavailable on inject failure that is not session-not-found", async () => {
    const t = trace();
    const result = await deliverDiagnosisViaOfficialLiveGateway(input(), {
      trace: t,
      call: async (opts) => {
        if (opts.method === "chat.send") {
          throw new Error("gateway timeout after 200ms");
        }
        if (opts.method === "chat.inject") {
          throw new Error("failed to write transcript: disk full");
        }
        throw new Error(`unexpected method ${opts.method}`);
      },
    });
    expect(result).toBe("unavailable");
    expect(t.methods).toEqual(["chat.send", "chat.inject"]);
    expect(t.resetKeys).toEqual([]);
  });

  it("resets only the canary session on session-not-found, then injects again", async () => {
    const t = trace();
    let injectAttempts = 0;
    const result = await deliverDiagnosisViaOfficialLiveGateway(input(), {
      trace: t,
      call: async (opts) => {
        if (opts.method === "chat.send") {
          throw new Error("gateway timeout after 200ms");
        }
        if (opts.method === "chat.inject") {
          injectAttempts += 1;
          if (injectAttempts === 1) {
            throw new Error("session not found: diagnosis:canary:daibai");
          }
          return { ok: true };
        }
        if (opts.method === "sessions.reset") {
          const key = (opts.params as { key?: string }).key;
          expect(key).toBe(DIAGNOSIS_P24_5_LIVE_SESSION_KEY);
          return { ok: true, key };
        }
        throw new Error(`unexpected method ${opts.method}`);
      },
    });
    expect(result).toBe("accepted");
    expect(t.methods).toEqual(["chat.send", "chat.inject", "sessions.reset", "chat.inject"]);
    expect(t.resetKeys).toEqual([DIAGNOSIS_P24_5_LIVE_SESSION_KEY]);
  });
});
