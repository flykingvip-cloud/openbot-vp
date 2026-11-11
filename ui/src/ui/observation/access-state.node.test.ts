import { describe, expect, it } from "vitest";
import {
  AUTH_INVALID_COPY,
  NO_GRANT_COPY,
  PRECISE_QUERY_MISS_COPY,
  RUN_DENIED_COPY,
  VERIFICATION_INELIGIBLE_COPY,
  accessibleRuns,
  applyDrawerParams,
  canAccessRun,
  currentAuthorization,
  hasObservationReadScope,
  metricScopeHint,
  preciseQueryMissCopy,
  projectVerificationReceipt,
  readDrawerRequest,
  resolveDrawerSelection,
  resolveObservationAuthorized,
  stripDrawerParams,
} from "./access-state.ts";
import type { ObservationRun } from "./model.ts";

function run(overrides: Partial<ObservationRun> = {}): ObservationRun {
  return {
    id: "quote-c01",
    label: "询价",
    scope: "personal",
    tenantId: "tenant-a",
    tenantLabel: "企业 A",
    clientRunId: "quote-c01",
    sourceRunId: "engine-a",
    admittedWorkId: null,
    scenarioTaskRef: null,
    outcomeRevision: null,
    toolState: "completed",
    outcomeState: "pending",
    latencyMs: 100,
    attributedCost: null,
    stages: [],
    reasons: [],
    eventCount: 2,
    sample: true,
    ...overrides,
  };
}

const granted = {
  authorized: true,
  role: "enterprise" as const,
  actorTenantId: "tenant-a",
  tenantFilter: "all",
  tenantGrant: "granted" as const,
};

describe("observation access decision", () => {
  it("shares one authorization decision across query, list, open, and restore", () => {
    const deniedAuth = currentAuthorization({ ...granted, authorized: false });
    expect(deniedAuth).toEqual({
      ok: false,
      code: "auth_invalid",
      message: AUTH_INVALID_COPY,
    });
    expect(canAccessRun({ ...granted, authorized: false, run: run() })).toEqual(deniedAuth);
    expect(accessibleRuns([run()], { ...granted, authorized: false })).toEqual([]);

    const other = run({ id: "north-b01", clientRunId: "north-b01", tenantId: "tenant-north" });
    const deniedRun = canAccessRun({ ...granted, run: other });
    expect(deniedRun).toEqual({
      ok: false,
      code: "run_out_of_scope",
      message: RUN_DENIED_COPY,
    });
    expect(accessibleRuns([run(), other], granted).map((row) => row.id)).toEqual(["quote-c01"]);
  });

  it("denies a platform tenant filter with no grant and does not invent a grant from unknown", () => {
    expect(
      currentAuthorization({
        authorized: true,
        role: "platform",
        actorTenantId: null,
        tenantFilter: "tenant-restricted",
        tenantGrant: "none",
      }).code,
    ).toBe("no_grant");
    expect(
      currentAuthorization({
        authorized: true,
        role: "platform",
        actorTenantId: null,
        tenantFilter: "tenant-restricted",
        tenantGrant: "unknown",
      }).ok,
    ).toBe(true);
    expect(NO_GRANT_COPY).toContain("无授权");
  });

  it("treats scopes as a display boundary and never grants from a URL-supplied role", () => {
    expect(hasObservationReadScope(["operator.read"])).toBe(true);
    expect(hasObservationReadScope([])).toBe(false);
    expect(resolveObservationAuthorized({ scopes: [] })).toBe(false);
    expect(resolveObservationAuthorized({ authorized: false, scopes: ["operator.admin"] })).toBe(
      false,
    );
    expect(resolveObservationAuthorized({ scopes: null })).toBe(true);
  });
});

describe("drawer restore and URL stripping", () => {
  it("rejects a directly supplied run/drawer on init and strips drawer/run from the URL", () => {
    const search = "?combo=filtered&run=quote-c01&drawer=1&tab=analysis";
    expect(readDrawerRequest(search)).toEqual({ runId: "quote-c01", drawer: true });
    const denied = resolveDrawerSelection({
      access: { ...granted, authorized: false },
      runs: [run()],
      allRuns: [run()],
      requestedRunId: "quote-c01",
      requestedDrawer: true,
    });
    expect(denied).toMatchObject({
      run: undefined,
      expanded: false,
      deny: true,
      notice: AUTH_INVALID_COPY,
      url: { runId: null, drawer: false },
    });
    expect(stripDrawerParams(search)).toBe("?combo=filtered&tab=analysis");
    expect(applyDrawerParams("?tab=analysis", { runId: null, drawer: false })).toBe(
      "?tab=analysis",
    );
  });

  it("allows restore only when the same access decision admits the run", () => {
    const allowed = resolveDrawerSelection({
      access: granted,
      runs: [run()],
      requestedRunId: "quote-c01",
      requestedDrawer: true,
    });
    expect(allowed.deny).toBe(false);
    expect(allowed.expanded).toBe(true);
    expect(allowed.run?.id).toBe("quote-c01");
    expect(allowed.url).toEqual({ runId: "quote-c01", drawer: true });
    expect(applyDrawerParams("", allowed.url)).toBe("?drawer=1&run=quote-c01");
  });
});

describe("precise query miss copy", () => {
  it("uses one copy for not found and unauthorized and does not hint at other tenants", () => {
    for (const err of [
      "not_found",
      "unauthorized",
      new Error("forbidden"),
      { gatewayCode: "403", message: "denied" },
      { code: "404" },
    ]) {
      expect(preciseQueryMissCopy(err)).toBe(PRECISE_QUERY_MISS_COPY);
    }
    expect(PRECISE_QUERY_MISS_COPY).toBe("当前授权范围内未找到匹配记录");
    expect(PRECISE_QUERY_MISS_COPY).not.toContain("其他");
    expect(PRECISE_QUERY_MISS_COPY).not.toContain("租户是否");
    expect(preciseQueryMissCopy(new Error("upstream timeout"))).toBeNull();
  });
});

describe("verification receipt projection", () => {
  it("does not project an ineligible receipt as 已验证", () => {
    const ineligible = projectVerificationReceipt({
      verificationId: "v-1",
      eligible: false,
      passed: false,
    });
    expect(ineligible.label).toBe(VERIFICATION_INELIGIBLE_COPY);
    expect(ineligible.label).not.toContain("已验证");
    expect(
      projectVerificationReceipt({ verificationId: "v-2", eligible: true, passed: false }).label,
    ).toBe(VERIFICATION_INELIGIBLE_COPY);
    expect(
      projectVerificationReceipt({ verificationId: "v-3", eligible: true, passed: true }).label,
    ).not.toBe("已验证");
  });
});

describe("metric list-scope hint", () => {
  it("describes a list-only filter and keeps the top-stat denominator wording", () => {
    expect(metricScopeHint("active_runs", 1)).toBe(
      "下方列表已按「活跃运行」筛选，共 1 条。顶部指标仍按原筛选集合统计，分母未改变。",
    );
    expect(metricScopeHint("all", 3)).toBeNull();
  });
});
