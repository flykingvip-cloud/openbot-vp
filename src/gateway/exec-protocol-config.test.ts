import { describe, expect, it } from "vitest";
import { isolationConfigToEnv, isolationProfile } from "../exec-protocol/config.js";
import { ExecConfigError } from "../exec-protocol/errors.js";
import {
  GATEWAY_EXEC_PROTOCOL_CONTROL_PLANE_URL_ENV,
  GATEWAY_EXEC_PROTOCOL_LEASE_TOKEN_ENV,
  assertLoopbackControlPlaneUrl,
  controlPlaneUrlFromBindPort,
  explicitIsolationFacadeFields,
  resolveGatewayExecProtocolIsolation,
} from "./exec-protocol-config.js";

const LEASE = "iso-lease-token-for-tests";

describe("resolveGatewayExecProtocolIsolation", () => {
  it("is disabled by default and does not load isolation signed values", () => {
    const resolved = resolveGatewayExecProtocolIsolation({});
    expect(resolved).toEqual({ enabled: false });
    expect(resolveGatewayExecProtocolIsolation({ execProtocol: { port: 18790 } })).toEqual({
      enabled: false,
    });
  });

  it("loads a complete explicit isolation config and derives a loopback URL", () => {
    const isolation = isolationProfile({ port: 19121 });
    const resolved = resolveGatewayExecProtocolIsolation({
      execProtocol: {
        enabled: true,
        leaseToken: LEASE,
        ...explicitIsolationFacadeFields(isolation),
      },
      env: {},
    });
    expect(resolved.enabled).toBe(true);
    if (!resolved.enabled) {
      return;
    }
    expect(resolved.config.port).toBe(19121);
    expect(resolved.config.bind).toBe("127.0.0.1");
    expect(resolved.controlPlaneUrl).toBe("http://127.0.0.1:19121");
    expect(resolved.leaseToken).toBe(LEASE);
  });

  it("loads a complete env profile when the config only opts in and supplies a lease token", () => {
    const isolation = isolationProfile({ port: 19122 });
    const resolved = resolveGatewayExecProtocolIsolation({
      execProtocol: { enabled: true, leaseToken: LEASE },
      env: isolationConfigToEnv(isolation),
    });
    expect(resolved.enabled).toBe(true);
    if (!resolved.enabled) {
      return;
    }
    expect(resolved.config.port).toBe(19122);
    expect(resolved.controlPlaneUrl).toBe("http://127.0.0.1:19122");
  });

  it("refuses a partial config object and does not auto-fill signed isolation numbers", () => {
    expect(() =>
      resolveGatewayExecProtocolIsolation({
        execProtocol: { enabled: true, leaseToken: LEASE, bind: "127.0.0.1", port: 18790 },
        env: {},
      }),
    ).toThrow(ExecConfigError);
    try {
      resolveGatewayExecProtocolIsolation({
        execProtocol: { enabled: true, leaseToken: LEASE, bind: "127.0.0.1", port: 18790 },
        env: {},
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ExecConfigError);
      expect((error as ExecConfigError).message).toContain("missing required fields");
      expect((error as ExecConfigError).message).not.toContain(LEASE);
    }
  });

  it("refuses enablement when the lease token is missing", () => {
    expect(() =>
      resolveGatewayExecProtocolIsolation({
        execProtocol: {
          enabled: true,
          ...explicitIsolationFacadeFields(isolationProfile()),
        },
        env: {},
      }),
    ).toThrow(/lease token is required/);
  });

  it("reads the lease token and control-plane URL from env when configured", () => {
    const isolation = isolationProfile({ port: 19123 });
    const resolved = resolveGatewayExecProtocolIsolation({
      execProtocol: { enabled: true },
      env: {
        ...isolationConfigToEnv(isolation),
        [GATEWAY_EXEC_PROTOCOL_LEASE_TOKEN_ENV]: LEASE,
        [GATEWAY_EXEC_PROTOCOL_CONTROL_PLANE_URL_ENV]: "http://127.0.0.1:19123",
      },
    });
    expect(resolved.enabled).toBe(true);
    if (!resolved.enabled) {
      return;
    }
    expect(resolved.leaseToken).toBe(LEASE);
    expect(resolved.controlPlaneUrl).toBe("http://127.0.0.1:19123");
  });

  it("refuses production execution mode and does not fall back to isolation values", () => {
    const isolation = isolationProfile();
    expect(() =>
      resolveGatewayExecProtocolIsolation({
        execProtocol: {
          enabled: true,
          leaseToken: LEASE,
          ...explicitIsolationFacadeFields(isolation),
        },
        env: { OPENBOT_PRODUCTION_EXECUTION_MODE: "production" },
      }),
    ).toThrow(/isolation-only/);
    try {
      resolveGatewayExecProtocolIsolation({
        execProtocol: {
          enabled: true,
          leaseToken: LEASE,
          ...explicitIsolationFacadeFields(isolation),
        },
        env: { OPENBOT_PRODUCTION_EXECUTION_MODE: "production" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ExecConfigError);
      expect((error as ExecConfigError).message).toMatch(/production profile is not frozen/);
      expect((error as ExecConfigError).missing).toEqual(["OPENBOT_PRODUCTION_EXECUTION_MODE"]);
      expect((error as ExecConfigError).message).not.toContain(LEASE);
    }
  });

  it("refuses a non-loopback control plane URL", () => {
    expect(() =>
      resolveGatewayExecProtocolIsolation({
        execProtocol: {
          enabled: true,
          leaseToken: LEASE,
          controlPlaneUrl: "http://10.21.88.5:18790",
          ...explicitIsolationFacadeFields(isolationProfile()),
        },
        env: {},
      }),
    ).toThrow(/loopback/);
  });
});

describe("control plane URL helpers", () => {
  it("formats loopback bind and port and rejects public hosts", () => {
    expect(controlPlaneUrlFromBindPort("127.0.0.1", 18790)).toBe("http://127.0.0.1:18790");
    expect(controlPlaneUrlFromBindPort("::1", 18790)).toBe("http://[::1]:18790");
    expect(assertLoopbackControlPlaneUrl("http://127.0.0.1:19124/")).toBe("http://127.0.0.1:19124");
    expect(() => assertLoopbackControlPlaneUrl("http://example.com:18790")).toThrow(/loopback/);
    expect(() => assertLoopbackControlPlaneUrl("https://127.0.0.1:18790")).toThrow(
      /http on loopback/,
    );
  });
});
