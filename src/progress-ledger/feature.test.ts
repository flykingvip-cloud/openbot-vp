import { describe, expect, it } from "vitest";
import {
  PROGRESS_LEDGER_ENABLED_ENV,
  PROGRESS_LEDGER_SHUTDOWN_ENV,
  PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV,
  describeProgressLedgerCanaryScope,
  isProgressLedgerEnabled,
  isProgressLedgerProjected,
  isProgressLedgerShutdown,
  isProgressLedgerTenantAdmitted,
  resolveProgressLedgerGate,
} from "./feature.js";

describe("isProgressLedgerEnabled", () => {
  const off = () => false;

  it("is off by default", () => {
    expect(isProgressLedgerEnabled({}, off)).toBe(false);
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "0" }, off)).toBe(false);
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "" }, off)).toBe(false);
  });

  it("is on for 1/true/yes/on", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: value }, off)).toBe(true);
    }
  });

  it("config OR env enables", () => {
    expect(isProgressLedgerEnabled({}, () => true)).toBe(true);
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "1" }, off)).toBe(true);
  });

  it("env=0 does not disable an enabled config source", () => {
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "0" }, () => true)).toBe(true);
    const gate = resolveProgressLedgerGate({ [PROGRESS_LEDGER_ENABLED_ENV]: "0" }, () => true);
    expect(gate.envEnabled).toBe(false);
    expect(gate.configEnabled).toBe(true);
    expect(gate.processEnabled).toBe(true);
    expect(gate.enablementSources).toEqual(["config"]);
  });
});

describe("progress ledger shutdown and tenant admission", () => {
  it("shutdown env wins over env and config enablement", () => {
    const env = {
      [PROGRESS_LEDGER_ENABLED_ENV]: "1",
      [PROGRESS_LEDGER_SHUTDOWN_ENV]: "1",
    };
    expect(isProgressLedgerEnabled(env, () => true)).toBe(false);
    expect(isProgressLedgerShutdown(env, () => true)).toBe(true);
    expect(describeProgressLedgerCanaryScope(env, () => true)).toBe("shutdown");
  });

  it("shutdown config wins over env enablement", () => {
    const env = { [PROGRESS_LEDGER_ENABLED_ENV]: "1" };
    const readConfig = () => ({ enabled: true, shutdown: true });
    expect(isProgressLedgerEnabled(env, readConfig)).toBe(false);
    const gate = resolveProgressLedgerGate(env, readConfig);
    expect(gate.shutdownSources).toEqual(["shutdown_config"]);
    expect(gate.enablementSources).toEqual(["env", "config"]);
  });

  it("empty allowlist is process-wide, not a single-tenant canary", () => {
    const env = { [PROGRESS_LEDGER_ENABLED_ENV]: "1" };
    expect(describeProgressLedgerCanaryScope(env, () => false)).toBe("process_wide");
    expect(isProgressLedgerTenantAdmitted(undefined, env, () => false)).toBe(true);
    expect(isProgressLedgerTenantAdmitted("tenant-a", env, () => false)).toBe(true);
    expect(isProgressLedgerProjected({ tenantId: "tenant-b", env, readConfig: () => false })).toBe(
      true,
    );
  });

  it("allowlist admits only listed tenants and fail-closes a missing tenant id", () => {
    const env = {
      [PROGRESS_LEDGER_ENABLED_ENV]: "1",
      [PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]: "tenant-a, Tenant-C ",
    };
    const off = () => false;
    expect(describeProgressLedgerCanaryScope(env, off)).toBe("tenant_allowlist");
    expect(isProgressLedgerProjected({ tenantId: "tenant-a", env, readConfig: off })).toBe(true);
    expect(isProgressLedgerProjected({ tenantId: "TENANT-C", env, readConfig: off })).toBe(true);
    expect(isProgressLedgerProjected({ tenantId: "tenant-b", env, readConfig: off })).toBe(false);
    expect(isProgressLedgerProjected({ tenantId: "", env, readConfig: off })).toBe(false);
    expect(isProgressLedgerProjected({ env, readConfig: off })).toBe(false);
  });

  it("config allowlist unions with env allowlist", () => {
    const env = {
      [PROGRESS_LEDGER_ENABLED_ENV]: "1",
      [PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]: "tenant-a",
    };
    const readConfig = () => ({ enabled: true, tenantAllowlist: ["tenant-b"] });
    expect(isProgressLedgerProjected({ tenantId: "tenant-a", env, readConfig })).toBe(true);
    expect(isProgressLedgerProjected({ tenantId: "tenant-b", env, readConfig })).toBe(true);
    expect(isProgressLedgerProjected({ tenantId: "tenant-c", env, readConfig })).toBe(false);
  });

  it("clearing env enablement alone is not a complete rollback when config is on", () => {
    const afterEnvZero = resolveProgressLedgerGate({ [PROGRESS_LEDGER_ENABLED_ENV]: "0" }, () => ({
      enabled: true,
    }));
    expect(afterEnvZero.processEnabled).toBe(true);
    const afterShutdown = resolveProgressLedgerGate(
      { [PROGRESS_LEDGER_ENABLED_ENV]: "0", [PROGRESS_LEDGER_SHUTDOWN_ENV]: "1" },
      () => ({ enabled: true }),
    );
    expect(afterShutdown.processEnabled).toBe(false);
  });
});
