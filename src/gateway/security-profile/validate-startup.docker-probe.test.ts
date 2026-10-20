import { describe, expect, it } from "vitest";
import { evaluateManagedEnterpriseStartup } from "./validate-startup.js";

const managedEnv = {
  OPENBOT_DATA_MODE: "managed",
  OPENBOT_SECURITY_PROFILE: "managed_enterprise",
  OPENBOT_TENANTS_ROOT: "/var/lib/openbot/tenant-volumes",
  OPENBOT_MULTITENANT: "1",
  OPENBOT_ACCOUNT_WORKER: "1",
  OPENBOT_ACCOUNT_WORKER_DOCKER: "1",
};

const sandboxedCfg = {
  data: { mode: "managed" as const },
  agents: { defaults: { sandbox: { mode: "all" as const } } },
};

describe("evaluateManagedEnterpriseStartup docker probe", () => {
  it("refuses multitenant docker boundary when docker runtime is missing", () => {
    const assessment = evaluateManagedEnterpriseStartup(sandboxedCfg, managedEnv, {
      probeDockerRuntime: () => ({ ok: false }),
    });
    expect(assessment.reasons).toContain("docker_runtime_unavailable");
    expect(assessment.addressing).toBe("shared_process");
  });

  it("allows multitenant docker boundary when docker runtime probe passes", () => {
    const assessment = evaluateManagedEnterpriseStartup(sandboxedCfg, managedEnv, {
      probeDockerRuntime: () => ({ ok: true }),
    });
    expect(assessment.reasons).toEqual([]);
  });

  it("does not special-case any tenant id in docker probe failure", () => {
    const assessment = evaluateManagedEnterpriseStartup(sandboxedCfg, managedEnv, {
      probeDockerRuntime: () => ({ ok: false }),
    });
    expect(JSON.stringify(assessment)).not.toMatch(/tenant-|employee-|user-/i);
  });
});
