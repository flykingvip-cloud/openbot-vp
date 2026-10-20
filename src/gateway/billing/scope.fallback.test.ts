// @vitest-environment node
// Feature: cost-budget-billing
// 本地单运营者租户回退：auth.mode=none / 无平台用户头时，按请求方 tenantId 解析作用域。

import { beforeEach, describe, expect, it, vi } from "vitest";

// platform-auth 与 config 由本测试控制，验证主路径优先 + 回退路径生效。
const loadConfigMock = vi.fn();
const resolvePlatformAuthConfigMock = vi.fn();
const loadPlatformAuthStoreMock = vi.fn();
const findUserByEmailMock = vi.fn();
const findMembershipByUserIdMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: (...args: unknown[]) => resolvePlatformAuthConfigMock(...args),
  loadPlatformAuthStore: (...args: unknown[]) => loadPlatformAuthStoreMock(...args),
  findUserByEmail: (...args: unknown[]) => findUserByEmailMock(...args),
  findMembershipByUserId: (...args: unknown[]) => findMembershipByUserIdMock(...args),
}));

const { resolveBillingScope, USAGE_BUDGET_PERMISSION } = await import("./scope.ts");

const STORE: {
  enterprises: Record<string, { id: string; name: string; status: string }>;
  users: Record<string, { id: string; email: string; normalizedEmail: string; status: "active" }>;
  memberships: Record<
    string,
    {
      id: string;
      userId: string;
      enterpriseId: string;
      membershipRole: "enterprise-admin" | "member";
    }
  >;
} = {
  enterprises: {
    "001": { id: "001", name: "UPBEYOND", status: "paid" },
    "aegis-99491024": { id: "aegis-99491024", name: "Aegis", status: "paid" },
  },
  users: {},
  memberships: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  loadConfigMock.mockReturnValue({ gateway: { auth: { trustedProxy: {} } } });
  resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
  STORE.users = {};
  STORE.memberships = {};
  loadPlatformAuthStoreMock.mockResolvedValue(STORE);
  findUserByEmailMock.mockReturnValue(null);
  findMembershipByUserIdMock.mockReturnValue(null);
});

describe("resolveBillingScope 本地租户回退", () => {
  it("无平台用户 + 携带已知 tenantId → 解析为该租户的本地运营者作用域", async () => {
    const scope = await resolveBillingScope(
      { connect: {} as never, user: undefined },
      { requestedTenantId: "001" },
    );
    expect(scope.enterpriseId).toBe("001");
    // 本地运营者授予企业管理员等价权限（可写预算/控制）。
    expect(scope.isEnterpriseAdmin).toBe(true);
    expect(scope.permissions.has(USAGE_BUDGET_PERMISSION)).toBe(true);
  });

  it("携带未知 tenantId → 不放行（纵深防御，返回空作用域）", async () => {
    const scope = await resolveBillingScope(
      { connect: {} as never, user: undefined },
      { requestedTenantId: "does-not-exist" },
    );
    expect(scope.enterpriseId).toBeNull();
  });

  it("未携带 tenantId 且无平台用户 → 空作用域", async () => {
    const scope = await resolveBillingScope({ connect: {} as never, user: undefined });
    expect(scope.enterpriseId).toBeNull();
  });

  it("平台用户主路径优先于回退 tenantId", async () => {
    STORE.users["user-1"] = {
      id: "user-1",
      email: "admin@example.com",
      normalizedEmail: "admin@example.com",
      status: "active",
    };
    STORE.memberships["mem-admin"] = {
      id: "mem-admin",
      userId: "user-1",
      enterpriseId: "aegis-99491024",
      membershipRole: "enterprise-admin",
    };
    const scope = await resolveBillingScope(
      { connect: {} as never, user: "admin@example.com" },
      { requestedTenantId: "001" },
    );
    // 主路径解析到的企业（membership）胜出，忽略请求方声明的 001。
    expect(scope.enterpriseId).toBe("aegis-99491024");
    expect(scope.isEnterpriseAdmin).toBe(true);
  });

  it("平台鉴权未启用 → 直接采用请求方 tenantId（无权威来源）", async () => {
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: false });
    const scope = await resolveBillingScope(
      { connect: {} as never, user: undefined },
      { requestedTenantId: "001" },
    );
    expect(scope.enterpriseId).toBe("001");
  });
});
