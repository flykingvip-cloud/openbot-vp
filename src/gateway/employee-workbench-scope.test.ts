import { describe, expect, it } from "vitest";
import {
  actorHasPendingHumanInviteInSpace,
  actorOwnsPendingBotInviteInSpace,
  buildArchivedCollaborationGroupIdSet,
  buildAuditableGroupBotSessionSet,
  buildEmployeeSessionVisibilityContextForActor,
  canEmployeeActorWriteCollaborationSpace,
  collectVisibleCollaborationSpaceIdsForActor,
  filterAgentsForEmployeeActor,
  filterCollaborationSpacesForEmployeeActor,
  filterSessionsForEmployeeActor,
  humanRosterMemberMatchesActorIdentities,
  isAgentOwnedByEmployeeUser,
  isArchivedCollaborationSpace,
  isCollaborationSpaceListedForEmployeeUser,
  isCollaborationSpaceVisibleToEmployeeUser,
  resolveCollaborationSpaceMutateDenialForActor,
  resolveUserOwnedSubjectIds,
} from "./employee-workbench-scope.js";

const actor = {
  userId: "user-elle",
  userEmail: "elledecke204@gmail.com",
  tenantId: "upbeyond",
  seatAgentIds: ["main"],
  seatSpaceIds: ["team-onboarding"],
};

describe("employee-workbench-scope", () => {
  it("does not treat ownerId as a cross-tenant grant", () => {
    expect(
      isAgentOwnedByEmployeeUser(
        { id: "host-ceo", ownerId: "user-elle", scope: "self", tenantId: "host-tenant" },
        actor,
      ),
    ).toBe(false);
    expect(
      isAgentOwnedByEmployeeUser(
        { id: "host-ceo-unscoped", ownerId: "user-elle", scope: "self" },
        actor,
      ),
    ).toBe(false);
    expect(
      isAgentOwnedByEmployeeUser(
        { id: "local-bot", ownerId: "user-elle", scope: "self", tenantId: "upbeyond" },
        actor,
      ),
    ).toBe(false);
  });

  it("does not treat a matching user ownerId as enterprise bot ownership", () => {
    expect(
      isAgentOwnedByEmployeeUser(
        { id: "creator-bot", ownerId: "user-elle", scope: "self", tenantId: "upbeyond" },
        actor,
      ),
    ).toBe(false);
    expect(
      isAgentOwnedByEmployeeUser(
        { id: "position-bot", ownerId: "seat-cs", scope: "shared", tenantId: "upbeyond" },
        { ...actor, seatAgentIds: ["main", "position-bot"] },
      ),
    ).toBe(true);
  });

  it("treats unowned self-scoped agents as foreign unless granted by seat assets", () => {
    expect(
      isAgentOwnedByEmployeeUser({ id: "market", ownerId: undefined, scope: "self" }, actor),
    ).toBe(false);
    expect(
      isAgentOwnedByEmployeeUser({ id: "main", ownerId: undefined, scope: "self" }, actor),
    ).toBe(true);
  });

  it("keeps only owned or seat-granted agents for employee sessions", () => {
    const filtered = filterAgentsForEmployeeActor(
      [
        { id: "main", name: "大白管家", scope: "self" },
        { id: "market", name: "市场助手", ownerId: "daniel-user", scope: "self" },
        { id: "shared-bot", name: "共享助手", ownerId: "daniel-user", scope: "shared" },
      ],
      actor,
    );
    expect(filtered.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("exposes position-owned shared agents only when granted on the active seat", () => {
    const csActor = {
      userId: "user-elle",
      userEmail: "elledecke204@gmail.com",
      tenantId: "upbeyond",
      currentSeatId: "seat-cs",
      seatAgentIds: ["main", "agt-cs-bot"],
      seatSpaceIds: [],
    };
    const ceoActor = {
      userId: "user-ceo",
      userEmail: "daniel.hhd@gmail.com",
      tenantId: "upbeyond",
      currentSeatId: "seat-ceo",
      seatAgentIds: ["main", "bot"],
      seatSpaceIds: [],
    };
    const agents = [
      { id: "main", name: "大白管家" },
      {
        id: "agt-cs-bot",
        name: "客户经理",
        scope: "shared",
        ownerId: "seat-cs",
        ownerName: "客服专员",
      },
      {
        id: "agt-legal-bot",
        name: "法律机器人",
        scope: "shared",
        ownerId: "seat-cs",
        ownerName: "客服专员",
      },
      { id: "bot", name: "高级秘书" },
    ];
    expect(filterAgentsForEmployeeActor(agents, csActor).map((entry) => entry.id)).toEqual([
      "main",
      "agt-cs-bot",
    ]);
    expect(filterAgentsForEmployeeActor(agents, ceoActor).map((entry) => entry.id)).toEqual([
      "main",
      "bot",
    ]);
  });

  it("always exposes builtin steward even when seat assets omit it", () => {
    const actorWithoutSeatSteward = {
      ...actor,
      seatAgentIds: ["market"],
    };
    const filtered = filterAgentsForEmployeeActor(
      [
        { id: "main", name: "大白管家", scope: "self" },
        { id: "market", name: "市场助手", ownerId: "user-elle", scope: "self" },
      ],
      actorWithoutSeatSteward,
    );
    expect(filtered.map((entry) => entry.id)).toEqual(["main", "market"]);
  });

  it("keeps only collaboration spaces owned by or joined by the current employee", () => {
    const filtered = filterCollaborationSpacesForEmployeeActor(
      [
        {
          id: "space:team-onboarding",
          groupId: "team-onboarding",
          ownerUserId: "user-elle",
          members: { humans: [{ userId: "user-elle", status: "active" }] },
        },
        {
          id: "space:daniel-private",
          groupId: "daniel-private",
          ownerUserId: "daniel-user",
          members: { humans: [{ userId: "daniel-user", status: "active" }] },
        },
      ],
      actor,
    );
    expect(filtered.map((entry) => entry.groupId)).toEqual(["team-onboarding"]);
  });

  it("allows pending human invitees to mutate for accept/reject without chat write", () => {
    const invitee = {
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      userEmail: "daniel.hhd@gmail.com",
      tenantId: "upbeyond",
      seatAgentIds: ["main"] as string[],
      seatSpaceIds: [] as string[],
    };
    const space = {
      id: "space:contingency",
      groupId: "grp-hrqb-权变管理专家",
      ownerUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
      members: {
        humans: [
          { userId: "c6862233-2e3e-4c89-a942-ce813e782637", status: "active" },
          { userId: "daniel.hhd@gmail.com", status: "invited" },
        ],
        bots: [],
      },
      invites: {
        humans: [{ userId: "daniel.hhd@gmail.com", status: "invited" }],
        bots: [],
      },
    };
    expect(isCollaborationSpaceVisibleToEmployeeUser(space, invitee)).toBe(false);
    expect(canEmployeeActorWriteCollaborationSpace(space, invitee)).toBe(false);
    expect(actorHasPendingHumanInviteInSpace(space, invitee)).toBe(true);
    expect(isCollaborationSpaceListedForEmployeeUser(space, invitee)).toBe(true);
    expect(
      resolveCollaborationSpaceMutateDenialForActor({
        actor: invitee,
        groupId: "grp-hrqb-权变管理专家",
        spaces: [space],
      }),
    ).toBeNull();
  });

  it("lists spaces where the actor owns a pending bot invite without granting chat write", () => {
    const botOwnerActor = {
      userId: "bot-owner",
      userEmail: "owner@example.com",
      tenantId: "upbeyond",
      seatAgentIds: ["market-assistant"],
      seatSpaceIds: [] as string[],
    };
    const space = {
      id: "space:colleague",
      groupId: "colleague",
      ownerUserId: "inviter",
      members: { humans: [{ userId: "inviter", status: "active" }], bots: [] },
      invites: {
        humans: [],
        bots: [{ agentId: "market-assistant", status: "invited", ownerUserId: "bot-owner" }],
      },
    };
    expect(isCollaborationSpaceVisibleToEmployeeUser(space, botOwnerActor)).toBe(false);
    expect(canEmployeeActorWriteCollaborationSpace(space, botOwnerActor)).toBe(false);
    expect(actorOwnsPendingBotInviteInSpace(space, botOwnerActor)).toBe(true);
    expect(isCollaborationSpaceListedForEmployeeUser(space, botOwnerActor)).toBe(true);
    expect(
      filterCollaborationSpacesForEmployeeActor([space], botOwnerActor).map(
        (entry) => entry.groupId,
      ),
    ).toEqual(["colleague"]);
    expect(
      resolveCollaborationSpaceMutateDenialForActor({
        actor: botOwnerActor,
        groupId: "colleague",
        spaces: [space],
      }),
    ).toBeNull();
  });

  it("does not list foreign spaces for a stamped builtin-steward pending invite", () => {
    const ceoActor = {
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      userEmail: "daniel.hhd@gmail.com",
      tenantId: "upbeyond",
      seatAgentIds: ["main", "market-assistant"],
      seatSpaceIds: [] as string[],
    };
    const space = {
      id: "space:training",
      groupId: "grp-training",
      ownerUserId: "caoyuqi@sohu.com",
      members: {
        humans: [{ userId: "caoyuqi@sohu.com", status: "active" }],
        bots: [
          {
            agentId: "main",
            status: "invited",
            ownerUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
          },
        ],
      },
    };
    expect(actorOwnsPendingBotInviteInSpace(space, ceoActor)).toBe(false);
    expect(isCollaborationSpaceListedForEmployeeUser(space, ceoActor)).toBe(false);
    expect(filterCollaborationSpacesForEmployeeActor([space], ceoActor)).toEqual([]);
  });

  it("hides archived collaboration spaces from employee workbench projections", () => {
    expect(
      isCollaborationSpaceVisibleToEmployeeUser(
        {
          id: "space:market-research",
          groupId: "market-research",
          ownerUserId: "user-elle",
          operatingState: {
            groupProfile: { lifecycleStatus: "archived" },
          },
          members: { humans: [{ userId: "user-elle", status: "active" }] },
        },
        actor,
      ),
    ).toBe(false);
    expect(
      buildArchivedCollaborationGroupIdSet([
        {
          id: "space:market-research",
          groupId: "market-research",
          operatingState: { groupProfile: { lifecycleStatus: "archived" } },
        },
        {
          id: "space:active-group",
          groupId: "active-group",
          operatingState: { groupProfile: { lifecycleStatus: "active" } },
        },
      ]),
    ).toEqual(new Set(["market-research"]));
  });

  it("fails closed when collaboration policy lookup fails", async () => {
    let lookupCalled = false;
    let warning = "";
    const context = await buildEmployeeSessionVisibilityContextForActor({
      actor,
      visibleAgents: [{ id: "main" }],
      logGateway: {
        warn: (message) => {
          warning = message;
        },
      },
      listCollaborationSpaces: async () => {
        lookupCalled = true;
        throw new Error("policy unavailable");
      },
    });

    expect(lookupCalled).toBe(true);
    expect(context).toBeNull();
    expect(warning).toContain("failed to resolve employee session visibility");
  });

  it("filters sessions belonging to archived collaboration groups", () => {
    const archivedGroupIds = new Set(["market-research"]);
    const filtered = filterSessionsForEmployeeActor(
      [
        { key: "agent:main:space:market-research", kind: "group", groupId: "market-research" },
        { key: "space:market-research", kind: "group", groupId: "market-research" },
        { key: "agent:main:space:team-onboarding", kind: "group", groupId: "team-onboarding" },
      ],
      actor,
      [{ id: "main" }],
      new Set(),
      archivedGroupIds,
    );
    expect(filtered.map((entry) => entry.key)).toEqual(["agent:main:space:team-onboarding"]);
  });

  it("filters sessions to visible agents and collaboration spaces", () => {
    const visibleAgents = [{ id: "main" }];
    const filtered = filterSessionsForEmployeeActor(
      [
        { key: "main", kind: "direct" },
        { key: "agent:main:main", kind: "direct" },
        { key: "agent:main:employee:user-elle", kind: "direct" },
        { key: "agent:main:employee:daniel-user", kind: "direct" },
        { key: "agent:market:main", kind: "direct" },
        { key: "agent:main:space:team-onboarding", kind: "group", groupId: "team-onboarding" },
        { key: "agent:main:space:daniel-private", kind: "group", groupId: "daniel-private" },
      ],
      { ...actor, userId: "user-elle" },
      visibleAgents,
    );
    expect(filtered.map((entry) => entry.key)).toEqual([
      "agent:main:employee:user-elle",
      "agent:main:space:team-onboarding",
    ]);
  });

  it("hides organization inter-agent inboxes from the workbench session list", () => {
    const filtered = filterSessionsForEmployeeActor(
      [
        { key: "agent:market:main", kind: "direct" },
        { key: "agent:market:org:upbeyond", kind: "direct" },
      ],
      actor,
      [{ id: "market" }],
    );
    expect(filtered.map((entry) => entry.key)).toEqual(["agent:market:main"]);
  });

  it("does not let a non-member read group content via bot ownership", () => {
    const ownerActor = {
      userId: "user-elle",
      userEmail: "elledecke204@gmail.com",
      tenantId: "upbeyond",
      currentSeatId: "seat-cs",
      seatAgentIds: ["main", "agt-cs-bot"],
      seatSpaceIds: [],
    };
    const spaces = [
      {
        id: "space:foreign-group",
        groupId: "foreign-group",
        ownerUserId: "daniel-user",
        members: {
          bots: [
            { agentId: "agt-cs-bot", status: "active" },
            { agentId: "main", status: "active" },
          ],
        },
      },
    ];
    const auditable = buildAuditableGroupBotSessionSet(ownerActor, spaces);
    // Owned, non-steward bot in a foreign group is auditable.
    expect(auditable.has("agt-cs-bot::foreign-group")).toBe(true);
    // Universal steward must never leak through the audit channel.
    expect(auditable.has("main::foreign-group")).toBe(false);

    const filtered = filterSessionsForEmployeeActor(
      [
        {
          key: "agent:agt-cs-bot:main:space:foreign-group",
          kind: "group",
          groupId: "foreign-group",
        },
        { key: "agent:main:main:space:foreign-group", kind: "group", groupId: "foreign-group" },
      ],
      ownerActor,
      [{ id: "main" }, { id: "agt-cs-bot" }],
      auditable,
    );
    expect(filtered.map((entry) => entry.key)).toEqual([]);
  });

  it("denies group writes for owner-audit actors who are not members", () => {
    const ownerActor = {
      userId: "user-elle",
      userEmail: "elledecke204@gmail.com",
      tenantId: "upbeyond",
      currentSeatId: "seat-cs",
      seatAgentIds: ["main", "agt-cs-bot"],
      seatSpaceIds: [],
    };
    const foreignGroup = {
      id: "space:foreign-group",
      groupId: "foreign-group",
      ownerUserId: "daniel-user",
      members: {
        humans: [{ userId: "daniel-user", status: "active" }],
      },
    };
    expect(canEmployeeActorWriteCollaborationSpace(foreignGroup, ownerActor)).toBe(false);

    const ownGroup = {
      id: "space:my-group",
      groupId: "my-group",
      ownerUserId: "user-elle",
      members: {
        humans: [{ userId: "user-elle", status: "active" }],
      },
    };
    expect(canEmployeeActorWriteCollaborationSpace(ownGroup, ownerActor)).toBe(true);
  });

  it("lets observers read the space but not write", () => {
    const observerActor = {
      userId: "observer-user",
      userEmail: "observer@example.com",
      tenantId: "upbeyond",
      seatAgentIds: ["main"] as string[],
      seatSpaceIds: [] as string[],
    };
    const space = {
      id: "space:observed",
      groupId: "observed",
      ownerUserId: "owner-user",
      members: {
        humans: [
          { userId: "owner-user", status: "active", governanceRole: "owner" },
          { userId: "observer-user", status: "active", governanceRole: "observer" },
        ],
      },
    };
    expect(isCollaborationSpaceVisibleToEmployeeUser(space, observerActor)).toBe(true);
    expect(canEmployeeActorWriteCollaborationSpace(space, observerActor)).toBe(false);
  });

  it("matches collaboration membership by email when userId is absent", () => {
    expect(
      isCollaborationSpaceVisibleToEmployeeUser(
        {
          id: "space:shared",
          groupId: "shared",
          ownerUserId: "daniel-user",
          members: {
            humans: [{ email: "elledecke204@gmail.com", status: "active" }],
          },
        },
        actor,
      ),
    ).toBe(true);
  });

  describe("resolveUserOwnedSubjectIds (ownership is user-bound, seat-independent)", () => {
    const ownershipRecords = [
      // CEO owns these even though the CEO seat binding is suspended elsewhere.
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "bot",
        currentManagerUserId: "90fed19a",
        bindingStatus: "active",
      },
      {
        tenantId: "001",
        subjectKind: "group",
        subjectId: "grp-ceo",
        currentManagerUserId: "90fed19a",
        bindingStatus: "active",
      },
      // elle owns these (recorded by email).
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "agt-elle-1",
        currentManagerUserId: "elledecke204@gmail.com",
        bindingStatus: "active",
      },
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "agt-elle-2",
        currentManagerUserId: "elledecke204@gmail.com",
        bindingStatus: "active",
      },
      // Revoked ownership must never resolve.
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "agt-revoked",
        currentManagerUserId: "elledecke204@gmail.com",
        bindingStatus: "revoked",
      },
      // Other tenant must never resolve.
      {
        tenantId: "002",
        subjectKind: "agent",
        subjectId: "agt-other-tenant",
        currentManagerUserId: "elledecke204@gmail.com",
        bindingStatus: "active",
      },
    ];

    it("resolves only the current user's owned agents/groups regardless of seat status", () => {
      const ceo = resolveUserOwnedSubjectIds({
        records: ownershipRecords,
        tenantId: "001",
        identities: new Set(["90fed19a", "daniel.hhd@gmail.com"]),
      });
      expect(ceo.agentIds).toEqual(["bot"]);
      expect(ceo.groupIds).toEqual(["grp-ceo"]);
    });

    it("matches ownership recorded by email and excludes revoked / other-tenant / foreign records", () => {
      const elle = resolveUserOwnedSubjectIds({
        records: ownershipRecords,
        tenantId: "001",
        identities: new Set(["user-elle", "elledecke204@gmail.com"]),
      });
      expect(elle.agentIds).toEqual(["agt-elle-1", "agt-elle-2"]);
      expect(elle.groupIds).toEqual([]);
      // Never leaks the CEO's bot to elle.
      expect(elle.agentIds).not.toContain("bot");
    });
  });

  describe("groupId-bearing rows must clear the group ACL (fail closed)", () => {
    it("hides a groupId session from a non-member even when chatType/kind are absent", () => {
      // Legacy / mislabeled canonical row: a visible non-steward agent, an opaque
      // key that does NOT derive to a group, a groupId pointing at a foreign
      // group, and chatType/kind unset. Previously this fell through to
      // `return true` and leaked the foreign group's transcript to anyone who
      // could see the bot.
      const filtered = filterSessionsForEmployeeActor(
        [{ key: "agent:bot:sess-abc", groupId: "foreign-group" }],
        actor,
        [{ id: "bot" }],
      );
      expect(filtered).toEqual([]);
    });

    it("shows a groupId-only session only when the actor is a member of that space", () => {
      const filtered = filterSessionsForEmployeeActor(
        [{ key: "agent:bot:sess-abc", groupId: "team-onboarding" }],
        actor, // seatSpaceIds: ["team-onboarding"]
        [{ id: "bot" }],
      );
      expect(filtered.map((entry) => entry.key)).toEqual(["agent:bot:sess-abc"]);
    });

    it("still shows a genuine personal (no groupId) session to the owning agent", () => {
      const filtered = filterSessionsForEmployeeActor([{ key: "agent:bot:sess-direct" }], actor, [
        { id: "bot" },
      ]);
      expect(filtered.map((entry) => entry.key)).toEqual(["agent:bot:sess-direct"]);
    });
  });

  describe("archived stays archived when sources disagree (fail closed)", () => {
    it("treats a profile-archived space as archived even when operating-state is stale-active", () => {
      const space = {
        id: "space:market-research",
        groupId: "market-research",
        ownerUserId: "user-elle",
        lifecycleStatus: "archived",
        operatingState: { groupProfile: { lifecycleStatus: "active" } },
        members: { humans: [{ userId: "user-elle", status: "active" }] },
      };
      expect(isArchivedCollaborationSpace(space)).toBe(true);
      expect(isCollaborationSpaceVisibleToEmployeeUser(space, actor)).toBe(false);
    });

    it("does not let a blank operating-state status resurrect a profile-archived space", () => {
      const space = {
        id: "space:market-research",
        groupId: "market-research",
        lifecycleStatus: "archived",
        operatingState: { groupProfile: { lifecycleStatus: "" } },
      };
      expect(isArchivedCollaborationSpace(space)).toBe(true);
    });

    it("treats an operating-state-archived space as archived even if the profile lags active", () => {
      const space = {
        id: "space:market-research",
        groupId: "market-research",
        lifecycleStatus: "active",
        operatingState: { groupProfile: { lifecycleStatus: "archived" } },
      };
      expect(isArchivedCollaborationSpace(space)).toBe(true);
    });

    it("keeps a fully-active space visible to its owner", () => {
      const space = {
        id: "space:team-onboarding",
        groupId: "team-onboarding",
        ownerUserId: "user-elle",
        lifecycleStatus: "active",
        operatingState: { groupProfile: { lifecycleStatus: "active" } },
        members: { humans: [{ userId: "user-elle", status: "active" }] },
      };
      expect(isArchivedCollaborationSpace(space)).toBe(false);
      expect(isCollaborationSpaceVisibleToEmployeeUser(space, actor)).toBe(true);
    });
  });

  describe("collaboration space authority convergence contracts", () => {
    const productTestGroup = {
      id: "space:product-test",
      groupId: "product-test",
      ownerUserId: "ceo-user",
      members: {
        humans: [
          { userId: "ceo-user", status: "active" },
          { userId: "wang-user", email: "hrqb@163.com", status: "active" },
        ],
        bots: [{ agentId: "agt-dabai", status: "active" }],
      },
    };

    it("non-owner human member (no seat) can see space, session, and write", async () => {
      const memberActor = {
        userId: "wang-user",
        userEmail: "hrqb@163.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"],
        seatSpaceIds: [] as string[],
      };
      expect(isCollaborationSpaceVisibleToEmployeeUser(productTestGroup, memberActor)).toBe(true);
      expect(canEmployeeActorWriteCollaborationSpace(productTestGroup, memberActor)).toBe(true);

      const visibleIds = collectVisibleCollaborationSpaceIdsForActor(memberActor, [
        productTestGroup,
      ]);
      expect(visibleIds.has("product-test")).toBe(true);

      const filtered = filterSessionsForEmployeeActor(
        [
          { key: "space:product-test", kind: "group", groupId: "product-test" },
          {
            key: "agent:agt-dabai:main:space:product-test",
            kind: "group",
            groupId: "product-test",
          },
        ],
        memberActor,
        [{ id: "agt-dabai" }, { id: "main" }],
        new Set(),
        new Set(),
        [productTestGroup],
      );
      expect(filtered.map((entry) => entry.key)).toEqual([
        "space:product-test",
        "agent:agt-dabai:main:space:product-test",
      ]);

      const context = await buildEmployeeSessionVisibilityContextForActor({
        actor: memberActor,
        visibleAgents: [{ id: "agt-dabai" }, { id: "main" }],
        listCollaborationSpaces: async () => ({ spaces: [productTestGroup] }),
      });
      expect(context?.visibleSpaceIds.has("product-test")).toBe(true);
    });

    it("bot-owner non-member cannot read group content and cannot write", () => {
      const botOwnerActor = {
        userId: "bot-owner",
        userEmail: "owner@example.com",
        tenantId: "upbeyond",
        seatAgentIds: ["agt-dabai"],
        seatSpaceIds: [] as string[],
      };
      expect(isCollaborationSpaceVisibleToEmployeeUser(productTestGroup, botOwnerActor)).toBe(
        false,
      );
      expect(canEmployeeActorWriteCollaborationSpace(productTestGroup, botOwnerActor)).toBe(false);

      const auditable = buildAuditableGroupBotSessionSet(botOwnerActor, [productTestGroup]);
      expect(auditable.has("agt-dabai::product-test")).toBe(true);

      const filtered = filterSessionsForEmployeeActor(
        [
          {
            key: "agent:agt-dabai:main:space:product-test",
            kind: "group",
            groupId: "product-test",
          },
          { key: "space:product-test", kind: "group", groupId: "product-test" },
        ],
        botOwnerActor,
        [{ id: "agt-dabai" }],
        auditable,
        new Set(),
        [productTestGroup],
      );
      expect(filtered.map((entry) => entry.key)).toEqual([]);
    });

    it("lets a group member post across users", () => {
      const otherMember = {
        userId: "wang-user",
        userEmail: "hrqb@163.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"],
        seatSpaceIds: [] as string[],
      };
      expect(canEmployeeActorWriteCollaborationSpace(productTestGroup, otherMember)).toBe(true);
      expect(otherMember.userId).not.toBe(productTestGroup.ownerUserId);
    });

    it("matches owner email to actor UUID via roster (same person)", () => {
      const ownerActor = {
        userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        userEmail: "alias@example.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"] as string[],
        seatSpaceIds: [] as string[],
      };
      const space = {
        id: "space:owned-by-email",
        groupId: "owned-by-email",
        ownerUserId: "glen@example.com",
        members: {
          humans: [
            {
              userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
              email: "glen@example.com",
              handle: "glen@example.com",
              status: "active",
            },
          ],
        },
      };
      expect(isCollaborationSpaceVisibleToEmployeeUser(space, ownerActor)).toBe(true);
    });

    it("matches owner UUID to actor email via roster (same person)", () => {
      const ownerActor = {
        userId: "actor-alias",
        userEmail: "glen@example.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"] as string[],
        seatSpaceIds: [] as string[],
      };
      const space = {
        id: "space:owned-by-uuid",
        groupId: "owned-by-uuid",
        ownerUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        members: {
          humans: [
            {
              userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
              email: "glen@example.com",
              handle: "glen@example.com",
              status: "active",
            },
          ],
        },
      };
      expect(isCollaborationSpaceVisibleToEmployeeUser(space, ownerActor)).toBe(true);
    });

    it("keeps member-only others' groups visible and hides archived owned spaces", () => {
      const memberActor = {
        userId: "wang-user",
        userEmail: "hrqb@163.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"] as string[],
        seatSpaceIds: [] as string[],
      };
      const othersGroup = {
        id: "space:product-test",
        groupId: "product-test",
        ownerUserId: "ceo-user",
        members: {
          humans: [
            { userId: "ceo-user", status: "active" },
            { userId: "wang-user", email: "hrqb@163.com", status: "active" },
          ],
        },
      };
      expect(isCollaborationSpaceVisibleToEmployeeUser(othersGroup, memberActor)).toBe(true);

      const archivedOwned = {
        id: "space:owned-archived",
        groupId: "owned-archived",
        ownerUserId: "wang-user",
        lifecycleStatus: "archived",
        members: { humans: [{ userId: "wang-user", email: "hrqb@163.com", status: "active" }] },
      };
      expect(isCollaborationSpaceVisibleToEmployeeUser(archivedOwned, memberActor)).toBe(false);
    });

    it("matches human roster by userId, email, or handle against actor identities", () => {
      const identities = new Set(["wang-user", "hrqb@163.com"]);
      expect(humanRosterMemberMatchesActorIdentities({ userId: "wang-user" }, identities)).toBe(
        true,
      );
      expect(humanRosterMemberMatchesActorIdentities({ email: "hrqb@163.com" }, identities)).toBe(
        true,
      );
      expect(humanRosterMemberMatchesActorIdentities({ handle: "hrqb@163.com" }, identities)).toBe(
        true,
      );
      expect(humanRosterMemberMatchesActorIdentities({ userId: "other" }, identities)).toBe(false);
    });

    it("mutate ACL allows create (unknown group), members of existing groups, and denies foreigners", () => {
      const memberActor = {
        userId: "wang-user",
        userEmail: "hrqb@163.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"],
        seatSpaceIds: [] as string[],
      };
      const stranger = {
        userId: "stranger",
        userEmail: "stranger@example.com",
        tenantId: "upbeyond",
        seatAgentIds: ["main"],
        seatSpaceIds: [] as string[],
      };
      expect(
        resolveCollaborationSpaceMutateDenialForActor({
          actor: memberActor,
          groupId: "brand-new-group",
          spaces: [productTestGroup],
        }),
      ).toBeNull();
      expect(
        resolveCollaborationSpaceMutateDenialForActor({
          actor: memberActor,
          groupId: "product-test",
          spaces: [productTestGroup],
        }),
      ).toBeNull();
      expect(
        resolveCollaborationSpaceMutateDenialForActor({
          actor: stranger,
          groupId: "product-test",
          spaces: [productTestGroup],
        }),
      ).toBe("you do not have permission to access this collaboration space");
    });
  });
});
