import { describe, expect, it } from "vitest";
import {
  canCreateSupervisorTask,
  canEditEnterpriseSupervisorPolicy,
  formatWorkerHealthSummary,
  localizeSupervisorHealthReason,
} from "./supervisor-types.ts";
import type { SupervisorWorkerHealthRow } from "./supervisor-types.ts";

describe("canCreateSupervisorTask", () => {
  it("allows operator.write and operator.admin", () => {
    expect(canCreateSupervisorTask(["operator.read"])).toBe(false);
    expect(canCreateSupervisorTask(["operator.write"])).toBe(true);
    expect(canCreateSupervisorTask(["operator.admin"])).toBe(true);
  });
});

describe("canEditEnterpriseSupervisorPolicy", () => {
  it("allows enterprise-admin only", () => {
    expect(canEditEnterpriseSupervisorPolicy("enterprise-admin")).toBe(true);
    expect(canEditEnterpriseSupervisorPolicy("member")).toBe(false);
    expect(canEditEnterpriseSupervisorPolicy(null)).toBe(false);
  });
});

describe("localizeSupervisorHealthReason", () => {
  it("maps known English probe reasons to Chinese", () => {
    expect(localizeSupervisorHealthReason("Credential missing or invalid")).toBe(
      "缺少或无效的凭证",
    );
    expect(localizeSupervisorHealthReason('Node Agent "mac-1" is offline')).toBe(
      "Node Agent「mac-1」离线",
    );
    expect(
      localizeSupervisorHealthReason(
        'Node Agent placement is not available for worker "cursor-cli"',
      ),
    ).toBe("Cursor CLI 暂不可在本机 Node 执行");
  });
});

describe("formatWorkerHealthSummary", () => {
  it("returns Chinese auth reason for unauthenticated gateway workers", () => {
    const row: SupervisorWorkerHealthRow = {
      backendId: "kiro-cli",
      recommendedPolicy: "api_key",
      recommendedPlacement: "gateway",
      identity: { policy: "api_key", status: "missing" },
      placement: { available: true, executor: "gateway" },
      auth: {
        installed: true,
        authenticated: false,
        status: "missing",
        source: "probe",
        reason: "Credential missing or invalid",
      },
    };
    expect(formatWorkerHealthSummary(row)).toBe("缺少或无效的凭证");
  });

  it("prefers auth reason when logged in locally but node placement is offline", () => {
    const row: SupervisorWorkerHealthRow = {
      backendId: "grok-cli",
      recommendedPolicy: "local_ide_login",
      recommendedPlacement: "node_agent",
      identity: { policy: "local_ide_login", status: "configured" },
      placement: {
        available: false,
        executor: null,
        reason: 'Node Agent "mac-1" is offline',
      },
      auth: {
        installed: true,
        authenticated: true,
        status: "validated",
        source: "probe",
        reason: "Gateway 宿主机探测：CLI 已登录（Node 离线时任务仍不可执行）",
      },
    };
    expect(formatWorkerHealthSummary(row)).toBe(
      "Gateway 宿主机探测：CLI 已登录（Node 离线时任务仍不可执行）",
    );
  });
});
