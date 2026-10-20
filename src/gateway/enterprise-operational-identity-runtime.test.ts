import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn();
const resolvePlatformAuthConfigMock = vi.fn();
const loadPlatformAuthStoreMock = vi.fn();
const findUserByEmailMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("./platform-auth.js", () => ({
  resolvePlatformAuthConfig: (...args: unknown[]) => resolvePlatformAuthConfigMock(...args),
  loadPlatformAuthStore: (...args: unknown[]) => loadPlatformAuthStoreMock(...args),
  findUserByEmail: (...args: unknown[]) => findUserByEmailMock(...args),
}));

const {
  formatOperationalIdentityRuntimePrompt,
  resolveActorEmployeeIdFromGatewayClient,
  resolveOperationalIdentityActorEmployeeId,
  resolveOperationalIdentityActorEmployeeIdFromPlatformUser,
} = await import("./enterprise-operational-identity-runtime.js");

beforeEach(() => {
  vi.clearAllMocks();
  loadConfigMock.mockReturnValue({ gateway: { auth: { trustedProxy: {} } } });
  resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
  loadPlatformAuthStoreMock.mockResolvedValue({});
  findUserByEmailMock.mockReturnValue({ id: "platform-user-42" });
});

describe("operational identity actor employee id", () => {
  it("prefers platform user id when provided directly", async () => {
    expect(resolveOperationalIdentityActorEmployeeIdFromPlatformUser(" user-1 ")).toBe("user-1");
    await expect(
      resolveOperationalIdentityActorEmployeeId({
        platformUserId: "user-1",
        client: { connect: {} as never, user: "admin@example.com" },
      }),
    ).resolves.toBe("user-1");
  });

  it("resolves gateway client email to platform user id for audit", async () => {
    const actorEmployeeId = await resolveActorEmployeeIdFromGatewayClient({
      connect: {} as never,
      user: "Admin@Example.com",
    });
    expect(findUserByEmailMock).toHaveBeenCalledWith({}, "admin@example.com");
    expect(actorEmployeeId).toBe("platform-user-42");
    expect(actorEmployeeId).not.toBe("admin@example.com");
  });
});

describe("operational identity runtime prompt", () => {
  it("formats active identity access for agent system prompt", () => {
    const prompt = formatOperationalIdentityRuntimePrompt([
      {
        identityId: "id-mail",
        displayName: "Acme Mail",
        provider: "enterprise-email",
        providerLabel: "企业邮箱",
        status: "active",
        allowedActions: ["send_email"],
        policyIds: ["policy-1"],
      },
    ]);
    expect(prompt).toContain("Acme Mail");
    expect(prompt).toContain("send_email");
    expect(prompt).toContain("does not grant enterprise data invoke elevation");
    expect(prompt).toContain("Server re-validates every operational_identity execute call.");
    expect(prompt?.toLowerCase()).not.toMatch(/enrollment/);
    expect(prompt).not.toMatch(/OWNER_GRANT_/);
  });

  it("tells agents to use identity publish_draft instead of leftover wechat-article scripts", () => {
    const prompt = formatOperationalIdentityRuntimePrompt([
      {
        identityId: "id-oa",
        displayName: "AI数字替身",
        provider: "wechat-official",
        providerLabel: "微信公众号",
        status: "active",
        allowedActions: ["publish_draft", "upload_thumb"],
        policyIds: ["policy-1"],
      },
    ]);
    expect(prompt).toContain("publish_draft");
    expect(prompt).toContain("thumbUrl");
    expect(prompt).toContain("leftover publish scripts");
  });

  it("returns undefined when no active access entries", () => {
    expect(
      formatOperationalIdentityRuntimePrompt([
        {
          identityId: "id-mail",
          displayName: "Acme Mail",
          provider: "enterprise-email",
          providerLabel: "企业邮箱",
          status: "reauth_required",
          allowedActions: ["send_email"],
          policyIds: ["policy-1"],
        },
      ]),
    ).toBeUndefined();
  });
});
