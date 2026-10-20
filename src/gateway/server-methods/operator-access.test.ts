/**
 * Real three-way ACL tests (membership ∩ agent ownership ∩ resource tenant).
 * Does NOT mock resolveAgentDirForClient — that is storage, not authorization.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfigMock,
  resolvePlatformAuthConfigMock,
  loadPlatformAuthStoreMock,
  findUserByEmailMock,
  findMembershipByUserIdMock,
  getAgentMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  resolvePlatformAuthConfigMock: vi.fn(),
  loadPlatformAuthStoreMock: vi.fn(),
  findUserByEmailMock: vi.fn(),
  findMembershipByUserIdMock: vi.fn(),
  getAgentMock: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: resolvePlatformAuthConfigMock,
  loadPlatformAuthStore: loadPlatformAuthStoreMock,
  findUserByEmail: findUserByEmailMock,
  findMembershipByUserId: findMembershipByUserIdMock,
}));
vi.mock("../agent-runtime-store.js", () => ({
  getAgent: getAgentMock,
}));

import {
  assertClientMayAccessAgentDetailed,
  assertClientMayAccessCandidate,
  assertClientMayGovernRuntimeAgent,
  isRuntimeAgentUniqueOwnerForTenant,
} from "./operator-access.js";
import type { GatewayClient, RespondFn } from "./types.js";

function client(email: string, scopes: string[] = []): GatewayClient {
  return {
    connect: { scopes } as never,
    user: email,
    sessionDomain: "enterprise",
  } as GatewayClient;
}

function respondCapture(): {
  respond: RespondFn;
  last: { ok: boolean; error?: string };
} {
  const last = { ok: true as boolean, error: undefined as string | undefined };
  const respond: RespondFn = (ok, _payload, error) => {
    last.ok = ok;
    last.error =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : undefined;
  };
  return { respond, last };
}

describe("assertClientMayAccessAgentDetailed (real ownership)", () => {
  beforeEach(() => {
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      agents: {
        list: [
          { id: "agent-acme", tenantId: "tenant-acme" },
          { id: "agent-globex", tenantId: "tenant-globex" },
        ],
      },
    });
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true, storePath: "/tmp/x" });
    loadPlatformAuthStoreMock.mockResolvedValue({});
    getAgentMock.mockReturnValue(null);
    findUserByEmailMock.mockReset();
    findMembershipByUserIdMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows when membership tenant matches agent tenantId", async () => {
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({
      enterpriseId: "tenant-acme",
      userId: "user-a",
    });
    const { respond, last } = respondCapture();
    const access = await assertClientMayAccessAgentDetailed(
      client("a@acme.com"),
      "agent-acme",
      respond,
    );
    expect(last.ok).toBe(true);
    expect(access).toEqual({
      agentId: "agent-acme",
      tenantId: "tenant-acme",
      userId: "user-a",
    });
  });

  it("denies when membership tenant does not own the agent", async () => {
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({
      enterpriseId: "tenant-acme",
      userId: "user-a",
    });
    const { respond, last } = respondCapture();
    const access = await assertClientMayAccessAgentDetailed(
      client("a@acme.com"),
      "agent-globex",
      respond,
    );
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(last.error).toMatch(/access denied|ownership/i);
  });

  it("denies without membership even if agent exists", async () => {
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue(undefined);
    const { respond, last } = respondCapture();
    const access = await assertClientMayAccessAgentDetailed(
      client("a@acme.com"),
      "agent-acme",
      respond,
    );
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(last.error).toMatch(/membership/i);
  });

  it("uses runtime tenantCoverage when config has no tenantId", async () => {
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      agents: { list: [{ id: "runtime-bot" }] },
    });
    getAgentMock.mockReturnValue({
      runtimeAgentId: "runtime-bot",
      tenantCoverage: ["tenant-acme"],
    });
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({
      enterpriseId: "tenant-acme",
      userId: "user-a",
    });
    const { respond, last } = respondCapture();
    const access = await assertClientMayAccessAgentDetailed(
      client("a@acme.com"),
      "runtime-bot",
      respond,
    );
    expect(last.ok).toBe(true);
    expect(access?.tenantId).toBe("tenant-acme");
  });

  it("candidate ACL requires candidate.tenantId match membership", async () => {
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({
      enterpriseId: "tenant-acme",
      userId: "user-a",
    });
    const { respond: r1, last: l1 } = respondCapture();
    expect(
      await assertClientMayAccessCandidate(
        client("a@acme.com"),
        { agentId: "agent-acme", tenantId: "tenant-acme" },
        r1,
      ),
    ).toBeTruthy();
    expect(l1.ok).toBe(true);

    const { respond: r2, last: l2 } = respondCapture();
    expect(
      await assertClientMayAccessCandidate(
        client("a@acme.com"),
        { agentId: "agent-acme", tenantId: "tenant-globex" },
        r2,
      ),
    ).toBeNull();
    expect(l2.ok).toBe(false);
    expect(l2.error).toMatch(/tenant mismatch/i);

    const { respond: r3, last: l3 } = respondCapture();
    expect(
      await assertClientMayAccessCandidate(
        client("a@acme.com"),
        { agentId: "agent-acme", tenantId: null },
        r3,
      ),
    ).toBeNull();
    expect(l3.ok).toBe(false);
    expect(l3.error).toMatch(/tenantId required/i);
  });
});

describe("assertClientMayGovernRuntimeAgent (shared-agent RBAC)", () => {
  beforeEach(() => {
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      agents: { list: [] },
    });
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true, storePath: "/tmp/x" });
    loadPlatformAuthStoreMock.mockResolvedValue({});
    findUserByEmailMock.mockReset();
    findMembershipByUserIdMock.mockReset();
    getAgentMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("denies tenant operator on multi-tenant shared agent", async () => {
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({
      enterpriseId: "tenant-acme",
      userId: "user-a",
    });
    getAgentMock.mockReturnValue({
      runtimeAgentId: "shared-bot",
      tenantCoverage: ["tenant-acme", "tenant-globex"],
    });
    expect(await isRuntimeAgentUniqueOwnerForTenant("shared-bot", "tenant-acme")).toBe(false);

    const { respond, last } = respondCapture();
    const access = await assertClientMayGovernRuntimeAgent(
      client("a@acme.com", ["operator.approvals"]),
      "shared-bot",
      respond,
    );
    expect(access).toBeNull();
    expect(last.ok).toBe(false);
    expect(last.error).toMatch(/shared-agent-requires-platform-admin/);
  });

  it("allows tenant operator when uniquely owned", async () => {
    findUserByEmailMock.mockReturnValue({ id: "user-a", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({
      enterpriseId: "tenant-acme",
      userId: "user-a",
    });
    getAgentMock.mockReturnValue({
      runtimeAgentId: "solo-bot",
      tenantCoverage: ["tenant-acme"],
    });
    expect(await isRuntimeAgentUniqueOwnerForTenant("solo-bot", "tenant-acme")).toBe(true);

    const { respond, last } = respondCapture();
    const access = await assertClientMayGovernRuntimeAgent(
      client("a@acme.com", ["operator.approvals"]),
      "solo-bot",
      respond,
    );
    expect(last.ok).toBe(true);
    expect(access).toEqual({
      agentId: "solo-bot",
      tenantId: "tenant-acme",
      userId: "user-a",
    });
  });

  it("allows platform admin on shared agent without membership match", async () => {
    findUserByEmailMock.mockReturnValue(null);
    findMembershipByUserIdMock.mockReturnValue(null);
    getAgentMock.mockReturnValue({
      runtimeAgentId: "shared-bot",
      tenantCoverage: ["tenant-acme", "tenant-globex"],
    });
    const { respond, last } = respondCapture();
    const access = await assertClientMayGovernRuntimeAgent(
      client("admin@openbot.love", ["operator.admin"]),
      "shared-bot",
      respond,
    );
    expect(last.ok).toBe(true);
    expect(access?.agentId).toBe("shared-bot");
    expect(access?.tenantId).toBe("tenant-acme");
  });
});
