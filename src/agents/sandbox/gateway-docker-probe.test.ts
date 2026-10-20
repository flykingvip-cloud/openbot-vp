import { describe, expect, it } from "vitest";
import {
  GATEWAY_DOCKER_PROBE_CRITICAL,
  gatewayRequiresDockerRuntime,
  probeGatewayDockerRuntime,
} from "./gateway-docker-probe.js";

describe("probeGatewayDockerRuntime", () => {
  it("passes when docker CLI is on PATH", () => {
    const result = probeGatewayDockerRuntime({
      env: { PATH: "/usr/bin" },
      pathExists: (file) => file === "/usr/bin/docker",
      isSocket: () => false,
    });
    expect(result.ok).toBe(true);
    expect(result.transport.kind).toBe("cli");
    expect(result.criticalMessage).toBeNull();
    expect(result.detail).toContain("CLI");
  });

  it("passes when only an engine socket is mounted", () => {
    const result = probeGatewayDockerRuntime({
      env: { PATH: "/empty" },
      pathExists: () => false,
      isSocket: (file) => file === "/var/run/docker.sock",
    });
    expect(result.ok).toBe(true);
    expect(result.transport.kind).toBe("socket");
    expect(result.criticalMessage).toBeNull();
  });

  it("fails closed with CRITICAL when CLI and socket are both missing", () => {
    const result = probeGatewayDockerRuntime({
      env: { PATH: "/empty" },
      pathExists: () => false,
      isSocket: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.transport.kind).toBe("missing");
    expect(result.criticalMessage).toBe(GATEWAY_DOCKER_PROBE_CRITICAL);
    expect(result.criticalMessage).toContain("OPENCLAW_INSTALL_DOCKER_CLI=1");
    expect(result.criticalMessage).toContain("ENOENT");
    // Cross-tenant: no tenant / user identifiers in the message.
    expect(result.criticalMessage).not.toMatch(/tenant-[a-z0-9]|user-[a-z0-9]|employee-/i);
    expect(result.criticalMessage).toContain("every tenant");
  });
});

describe("gatewayRequiresDockerRuntime", () => {
  it("requires docker when sandbox.mode=all", () => {
    expect(
      gatewayRequiresDockerRuntime({
        cfg: { agents: { defaults: { sandbox: { mode: "all" } } } },
        env: {},
      }),
    ).toBe(true);
  });

  it("requires docker for account-worker docker without sandbox mode", () => {
    expect(
      gatewayRequiresDockerRuntime({
        cfg: { agents: { defaults: { sandbox: { mode: "off" } } } },
        env: { OPENBOT_ACCOUNT_WORKER: "1", OPENBOT_ACCOUNT_WORKER_DOCKER: "1" },
      }),
    ).toBe(true);
  });

  it("does not require docker when sandbox is off and account worker docker is off", () => {
    expect(
      gatewayRequiresDockerRuntime({
        cfg: { agents: { defaults: { sandbox: { mode: "off" } } } },
        env: {},
      }),
    ).toBe(true); // P6b: dual flags default ON when unset
    expect(
      gatewayRequiresDockerRuntime({
        cfg: { agents: { defaults: { sandbox: { mode: "off" } } } },
        env: { OPENBOT_ACCOUNT_WORKER: "0", OPENBOT_ACCOUNT_WORKER_DOCKER: "0" },
      }),
    ).toBe(false);
  });
});
