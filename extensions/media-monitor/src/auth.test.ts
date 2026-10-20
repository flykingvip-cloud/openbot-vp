import type { GatewayClient } from "openclaw/plugin-sdk/media-monitor";
import { describe, expect, it } from "vitest";
import { MonitorAuthError, resolveMonitorAuth } from "./auth.js";

function client(partial: Partial<GatewayClient> & { scopes?: string[] }): GatewayClient {
  const scopes = partial.scopes;
  const { scopes: _drop, ...rest } = partial as Partial<GatewayClient> & { scopes?: string[] };
  return {
    connect: { scopes } as GatewayClient["connect"],
    ...rest,
  } as GatewayClient;
}

describe("media-monitor auth", () => {
  it("rejects missing tenant/agent identity (no unfiltered dump)", () => {
    expect(() => resolveMonitorAuth({ client: null, params: {} })).toThrow(MonitorAuthError);
    expect(() => resolveMonitorAuth({ client: null, params: { tenantId: "t1" } })).toThrow(
      /agentId required/,
    );
  });

  it("binds tenant callers to explicit tenant+agent", () => {
    const auth = resolveMonitorAuth({
      client: null,
      params: { tenantId: "t1", agentId: "a1" },
    });
    expect(auth).toEqual({ role: "tenant", tenantId: "t1", agentId: "a1" });
  });

  it("prefers session tenant and rejects forged tenantId", () => {
    const auth = resolveMonitorAuth({
      client: client({ sessionTenantId: "session-t" }),
      params: { agentId: "a1" },
    });
    expect(auth).toEqual({ role: "tenant", tenantId: "session-t", agentId: "a1" });

    expect(() =>
      resolveMonitorAuth({
        client: client({ sessionTenantId: "session-t" }),
        params: { tenantId: "other", agentId: "a1" },
      }),
    ).toThrow(/tenant mismatch with session/);
  });

  it("requires trusted admin client for admin:true full-store access", () => {
    expect(() =>
      resolveMonitorAuth({
        client: null,
        params: { admin: true },
      }),
    ).toThrow(/admin capability required/);

    const auth = resolveMonitorAuth({
      client: client({ scopes: ["operator.admin"] }),
      params: { admin: true },
    });
    expect(auth).toEqual({ role: "admin" });

    const viaKind = resolveMonitorAuth({
      client: client({ sessionKind: "platform-admin" }),
      params: { admin: true },
    });
    expect(viaKind).toEqual({ role: "admin" });
  });
});
