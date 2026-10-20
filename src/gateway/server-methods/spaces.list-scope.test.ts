import { beforeEach, describe, expect, it, vi } from "vitest";

const listGatewayCollaborationSpacesMock = vi.fn();
const resolveEmployeeWorkbenchActorMock = vi.fn();
const resolveSecurityProfileMock = vi.fn((..._args: unknown[]) => ({
  profile: "personal_local",
}));
const resolveMembershipTenantIdForAclMock = vi.fn(
  async (..._args: unknown[]): Promise<string | null> => null,
);
const resolveTrustedCollaborationTenantIdMock = vi.fn(
  async (..._args: unknown[]): Promise<string | null> => null,
);
const loadAuthoritativeGroupMembersMock = vi.fn(
  async (..._args: unknown[]): Promise<unknown[]> => [],
);
const filterCollaborationSpacesForEmployeeActorMock = vi.fn(
  (spaces: unknown[], _actor: unknown) => spaces,
);
const filterSpacesForEnterpriseTenantClientMock = vi.fn(
  async (_client: unknown, spaces: unknown[]) => spaces,
);
const buildArchivedCollaborationGroupIdSetMock = vi.fn((..._args: unknown[]) => new Set<string>());
const isPersonalWorkbenchClientMock = vi.fn(
  (client: { sessionDomain?: string } | null | undefined) =>
    client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise",
);

vi.mock("../collaboration-learning.js", () => ({
  listGatewayCollaborationSpaces: (...args: unknown[]) =>
    listGatewayCollaborationSpacesMock(...args),
  dissolveGatewayCollaborationSpace: vi.fn(),
  leaveGatewayCollaborationSpace: vi.fn(),
  loadGroupCharterForRuntime: vi.fn(),
  resetGatewayCollaborationSpace: vi.fn(),
  resolveCollaborationTransitionError: vi.fn(),
  transferGatewayCollaborationSpaceOwnership: vi.fn(),
  updateGatewayCollaborationSpaceMembers: vi.fn(),
}));

vi.mock("../employee-workbench-scope.js", () => ({
  buildArchivedCollaborationGroupIdSet: (...args: unknown[]) =>
    buildArchivedCollaborationGroupIdSetMock(...args),
  filterCollaborationSpacesForEmployeeActor: (...args: unknown[]) =>
    filterCollaborationSpacesForEmployeeActorMock(...(args as [unknown[], unknown])),
  isCollaborationSpaceVisibleToEmployeeUser: (
    space: { ownerUserId?: string },
    actor: { userId?: string },
  ) => space.ownerUserId === actor.userId,
  isPersonalWorkbenchClient: (...args: unknown[]) =>
    isPersonalWorkbenchClientMock(...(args as [never])),
  resolveCollaborationSpaceMutateDenial: vi.fn(async () => null),
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveEmployeeWorkbenchActorMock(...args),
}));

vi.mock("../enterprise-tenant-roster-scope.js", () => ({
  filterSpacesForEnterpriseTenantClient: (...args: unknown[]) =>
    filterSpacesForEnterpriseTenantClientMock(...(args as [unknown, unknown[]])),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../security-profile.js", () => ({
  resolveSecurityProfile: (...args: unknown[]) => resolveSecurityProfileMock(...args),
}));

vi.mock("../collaboration-learning/trusted-tenant.js", () => ({
  resolveMembershipTenantIdForAcl: (...args: unknown[]) =>
    resolveMembershipTenantIdForAclMock(...args),
  resolveTrustedCollaborationTenantId: (...args: unknown[]) =>
    resolveTrustedCollaborationTenantIdMock(...args),
}));

type ListedSpacesProvisionParams = {
  tenantId?: string;
  spaces?: Array<{ groupId?: string }>;
  actor?: { userId?: string };
};

const { provisionListedSpacesMock } = vi.hoisted(() => ({
  provisionListedSpacesMock: vi.fn(
    async (_params: ListedSpacesProvisionParams): Promise<unknown[]> => [],
  ),
}));

vi.mock("../workspace/group-acl.js", () => ({
  loadAuthoritativeGroupMembers: (...args: unknown[]) => loadAuthoritativeGroupMembersMock(...args),
}));

vi.mock("../workspace/managed-group-members-provision.js", () => ({
  provisionManagedGroupMembersForListedSpaces: (params: ListedSpacesProvisionParams) =>
    provisionListedSpacesMock(params),
}));

describe("collaboration.spaces.list scope branching", () => {
  beforeEach(() => {
    listGatewayCollaborationSpacesMock.mockReset();
    resolveEmployeeWorkbenchActorMock.mockReset();
    filterCollaborationSpacesForEmployeeActorMock.mockClear();
    filterSpacesForEnterpriseTenantClientMock.mockClear();
    buildArchivedCollaborationGroupIdSetMock.mockReset();
    buildArchivedCollaborationGroupIdSetMock.mockReturnValue(new Set());
    isPersonalWorkbenchClientMock.mockClear();
    listGatewayCollaborationSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: "grp-ceo",
          groupId: "grp-ceo",
          title: "CEO 小组",
          ownerUserId: "ceo",
          members: { humans: [{ userId: "ceo", status: "active" }], bots: [] },
        },
        {
          id: "grp-other",
          groupId: "grp-other",
          title: "他人小组",
          ownerUserId: "alice",
          members: { humans: [{ userId: "alice", status: "active" }], bots: [] },
        },
      ],
    });
    filterCollaborationSpacesForEmployeeActorMock.mockImplementation((spaces: unknown[]) =>
      (spaces as Array<{ ownerUserId?: string }>).filter((space) => space.ownerUserId === "ceo"),
    );
    filterSpacesForEnterpriseTenantClientMock.mockImplementation(
      async (_client: unknown, spaces: unknown[]) => spaces,
    );
    resolveSecurityProfileMock.mockReset();
    resolveSecurityProfileMock.mockReturnValue({ profile: "personal_local" });
    resolveMembershipTenantIdForAclMock.mockReset();
    resolveMembershipTenantIdForAclMock.mockResolvedValue(null);
    resolveTrustedCollaborationTenantIdMock.mockReset();
    resolveTrustedCollaborationTenantIdMock.mockResolvedValue(null);
    loadAuthoritativeGroupMembersMock.mockReset();
    loadAuthoritativeGroupMembersMock.mockResolvedValue([]);
    provisionListedSpacesMock.mockReset();
    provisionListedSpacesMock.mockResolvedValue([]);
  });

  it("scopes enterprise-admin personal workbench to the actor by default", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "ceo",
      userEmail: "ceo@example.com",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "enterprise", user: "ceo" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(filterSpacesForEnterpriseTenantClientMock).not.toHaveBeenCalled();
    expect(filterCollaborationSpacesForEmployeeActorMock).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [expect.objectContaining({ id: "grp-ceo" })],
      }),
      undefined,
    );
  });

  it("returns tenant-wide spaces for enterprise mesh when scope is tenant", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "ceo",
      userEmail: "ceo@example.com",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: { scope: "tenant" },
      respond: respond as never,
      client: { sessionDomain: "enterprise", user: "ceo" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(filterSpacesForEnterpriseTenantClientMock).toHaveBeenCalled();
    expect(filterCollaborationSpacesForEmployeeActorMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: expect.arrayContaining([
          expect.objectContaining({ id: "grp-ceo" }),
          expect.objectContaining({ id: "grp-other" }),
        ]),
      }),
      undefined,
    );
  });

  it("does not expand employee sessions that request tenant scope", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "alice",
      userEmail: "alice@example.com",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    filterCollaborationSpacesForEmployeeActorMock.mockImplementation((spaces: unknown[]) =>
      (spaces as Array<{ ownerUserId?: string }>).filter((space) => space.ownerUserId === "alice"),
    );
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: { scope: "tenant" },
      respond: respond as never,
      client: { sessionDomain: "employee", user: "alice" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(filterSpacesForEnterpriseTenantClientMock).not.toHaveBeenCalled();
    expect(filterCollaborationSpacesForEmployeeActorMock).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [expect.objectContaining({ id: "grp-other" })],
      }),
      undefined,
    );
  });

  it("hides managed spaces whose tenant members.json is empty", async () => {
    resolveSecurityProfileMock.mockReturnValue({ profile: "managed_enterprise" });
    resolveMembershipTenantIdForAclMock.mockResolvedValue("001");
    resolveTrustedCollaborationTenantIdMock.mockResolvedValue("001");
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "ceo",
      userEmail: "ceo@example.com",
      tenantId: "001",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    filterCollaborationSpacesForEmployeeActorMock.mockImplementation((spaces: unknown[]) => spaces);
    loadAuthoritativeGroupMembersMock.mockImplementation(async (...args: unknown[]) => {
      const groupId = (args[0] as { groupId?: string } | undefined)?.groupId;
      return groupId === "grp-ceo"
        ? [{ userId: "ceo", status: "active", memberKind: "human" }]
        : [];
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "employee", user: "ceo" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [expect.objectContaining({ id: "grp-ceo" })],
      }),
      undefined,
    );
  });

  it("keeps actor-owned spaces even when tenant members.json is empty", async () => {
    resolveSecurityProfileMock.mockReturnValue({ profile: "managed_enterprise" });
    resolveMembershipTenantIdForAclMock.mockResolvedValue("001");
    resolveTrustedCollaborationTenantIdMock.mockResolvedValue("001");
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "ceo",
      userEmail: "ceo@example.com",
      tenantId: "001",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    listGatewayCollaborationSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: "grp-user-scoped",
          groupId: "grp-user-scoped",
          title: "Glen owned",
          ownerUserId: "ceo",
          members: { humans: [{ userId: "ceo", status: "active" }], bots: [] },
        },
      ],
    });
    filterCollaborationSpacesForEmployeeActorMock.mockImplementation((spaces: unknown[]) => spaces);
    loadAuthoritativeGroupMembersMock.mockResolvedValue([]);
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "employee", user: "ceo" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [expect.objectContaining({ id: "grp-user-scoped" })],
      }),
      undefined,
    );
  });

  it("provisions C5 for every actor-listed managed space, mixed owners included", async () => {
    resolveSecurityProfileMock.mockReturnValue({ profile: "managed_enterprise" });
    resolveMembershipTenantIdForAclMock.mockResolvedValue("001");
    resolveTrustedCollaborationTenantIdMock.mockResolvedValue("001");
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "ceo",
      userEmail: "ceo@example.com",
      tenantId: "001",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    listGatewayCollaborationSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: "grp-ceo",
          groupId: "grp-ceo",
          title: "CEO 小组",
          ownerUserId: "ceo",
          members: { humans: [{ userId: "ceo", status: "active" }], bots: [] },
        },
        {
          id: "grp-shared",
          groupId: "grp-shared",
          title: "Shared with ceo",
          ownerUserId: "alice",
          members: {
            humans: [
              { userId: "alice", status: "active" },
              { userId: "ceo", status: "active" },
            ],
            bots: [],
          },
        },
        {
          id: "grp-other",
          groupId: "grp-other",
          title: "他人小组",
          ownerUserId: "alice",
          members: { humans: [{ userId: "alice", status: "active" }], bots: [] },
        },
      ],
    });
    filterCollaborationSpacesForEmployeeActorMock.mockImplementation((spaces: unknown[]) =>
      (spaces as Array<{ groupId?: string }>).filter(
        (space) => space.groupId === "grp-ceo" || space.groupId === "grp-shared",
      ),
    );
    // C5 may already exist for some listed spaces; list still asks provision to
    // walk every actor-listed group (mixed owners), not a single fixture.
    loadAuthoritativeGroupMembersMock.mockImplementation(async (...args: unknown[]) => {
      const groupId = (args[0] as { groupId?: string } | undefined)?.groupId;
      return groupId === "grp-other"
        ? []
        : [{ userId: "ceo", status: "active", memberKind: "human" }];
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "employee", user: "ceo" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [
          expect.objectContaining({ id: "grp-ceo" }),
          expect.objectContaining({ id: "grp-shared" }),
        ],
      }),
      undefined,
    );
    expect(provisionListedSpacesMock).toHaveBeenCalledTimes(1);
    const provisionArgs = provisionListedSpacesMock.mock.calls[0]?.[0];
    expect(provisionArgs?.tenantId).toBe("001");
    expect(provisionArgs?.actor?.userId).toBe("ceo");
    expect(provisionArgs?.spaces?.map((space) => space.groupId).toSorted()).toEqual([
      "grp-ceo",
      "grp-shared",
    ]);
  });
});
