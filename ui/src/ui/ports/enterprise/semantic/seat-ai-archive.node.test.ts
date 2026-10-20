import { describe, expect, it } from "vitest";
import {
  buildSeatAiArchiveInput,
  buildSeatAiArchiveReadModel,
  isLikelyEmail,
  resolveSeatAiArchivePhase,
  SEAT_AI_ARCHIVE_SECTION_WEIGHTS,
  type SeatAiArchiveInput,
} from "./seat-ai-archive.ts";

function baseInput(overrides: Partial<SeatAiArchiveInput> = {}): SeatAiArchiveInput {
  return {
    seatId: "seat-1",
    name: "销售助理",
    teamLabel: "销售部",
    responsibility: "跟进线索",
    status: "VACANT",
    seatStatus: "vacant",
    memberUserId: null,
    memberDisplayLabel: null,
    memberEmail: null,
    pendingEmployeeUser: null,
    pendingEmployeeDisplayName: null,
    pendingActivationExpiresAt: null,
    roleCode: "SAL-L1-001",
    aiEmployeeLabel: "SAL-L1-001",
    defaultAgentId: null,
    agentIds: [],
    defaultSpaceIds: [],
    memoryScopeIds: [],
    botCount: 0,
    groupCount: 0,
    totalCost: null,
    totalTokens: null,
    sessionCount: null,
    ...overrides,
  };
}

describe("isLikelyEmail", () => {
  it("accepts simple emails and rejects user ids", () => {
    expect(isLikelyEmail("a@example.com")).toBe(true);
    expect(isLikelyEmail("user-123")).toBe(false);
    expect(isLikelyEmail("not an email@")).toBe(false);
  });
});

describe("resolveSeatAiArchivePhase", () => {
  it("maps vacant seat to vacant_shell", () => {
    expect(
      resolveSeatAiArchivePhase({
        status: "VACANT",
        seatStatus: "vacant",
        pendingEmployeeUser: null,
      }),
    ).toBe("vacant_shell");
  });

  it("maps pending employee to pending_activation", () => {
    expect(
      resolveSeatAiArchivePhase({
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
        pendingEmployeeUser: "a@example.com",
      }),
    ).toBe("pending_activation");
  });

  it("maps occupied to occupied", () => {
    expect(
      resolveSeatAiArchivePhase({
        status: "NORMAL",
        seatStatus: "occupied",
        pendingEmployeeUser: null,
      }),
    ).toBe("occupied");
  });

  it("uses only active handover statuses for handover phase", () => {
    expect(
      resolveSeatAiArchivePhase({
        status: "HANDOVER",
        seatStatus: "occupied",
        pendingEmployeeUser: null,
        handoverStatus: "frozen",
      }),
    ).toBe("handover");
    expect(
      resolveSeatAiArchivePhase({
        status: "HANDOVER",
        seatStatus: "occupied",
        pendingEmployeeUser: null,
        handoverStatus: "completed",
      }),
    ).toBe("occupied");
    expect(
      resolveSeatAiArchivePhase({
        status: "HANDOVER",
        seatStatus: "occupied",
        pendingEmployeeUser: null,
        handoverStatus: "rebound",
      }),
    ).toBe("occupied");
  });
});

describe("buildSeatAiArchiveReadModel", () => {
  it("does not score identity without department", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        teamLabel: "未分组",
        memberUserId: "user-1",
        memberEmail: "a@example.com",
        status: "NORMAL",
        seatStatus: "occupied",
      }),
    );
    expect(archive.sections.identity.filled).toBe(false);
    expect(archive.completeness).not.toBeGreaterThanOrEqual(
      SEAT_AI_ARCHIVE_SECTION_WEIGHTS.identity + SEAT_AI_ARCHIVE_SECTION_WEIGHTS.digital,
    );
  });

  it("requires name + department + person for identity score", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        pendingEmployeeUser: "hire@example.com",
        memberEmail: "hire@example.com",
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
      }),
    );
    expect(archive.sections.identity.filled).toBe(true);
    expect(archive.completeness).toBeGreaterThanOrEqual(SEAT_AI_ARCHIVE_SECTION_WEIGHTS.identity);
  });

  it("does not award timeline points for empty vacant seats", () => {
    const archive = buildSeatAiArchiveReadModel(baseInput());
    expect(archive.timeline.events).toEqual([]);
    expect(archive.sections.timeline.filled).toBe(false);
    expect(archive.completeness).toBe(SEAT_AI_ARCHIVE_SECTION_WEIGHTS.digital);
  });

  it("does not treat non-email memberUserId as email", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-abc-001",
        memberDisplayLabel: "张三",
        memberEmail: null,
        agentIds: ["bot-a"],
        botCount: 1,
      }),
    );
    expect(archive.identity.email).toBeNull();
    expect(archive.identity.emailDisplay).toBe("未提供");
    expect(archive.identity.memberLabel).toBe("张三");
  });

  it("records terminal handover as history without handover phase", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        status: "HANDOVER",
        seatStatus: "occupied",
        memberUserId: "user-1",
        memberEmail: "a@example.com",
        handoverStatus: "completed",
      }),
    );
    expect(archive.phase).toBe("occupied");
    expect(archive.timeline.events.some((event) => event.id === "handover_history")).toBe(true);
    expect(archive.timeline.events.some((event) => event.id === "handover_active")).toBe(false);
  });

  it("fills skills when knownSkills projected", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        knownSkills: ["web-search", "browser"],
        agentIds: ["bot-a"],
        botCount: 1,
      }),
    );
    expect(archive.sections.skills.filled).toBe(true);
    expect(archive.skills.items).toEqual(["web-search", "browser"]);
    expect(archive.completeness).toBeGreaterThanOrEqual(
      SEAT_AI_ARCHIVE_SECTION_WEIGHTS.digital + SEAT_AI_ARCHIVE_SECTION_WEIGHTS.skills,
    );
  });

  it("scores contribution from identity bindings even without agents", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        identityBindingCount: 2,
        meshSessionCount: 9,
      }),
    );
    expect(archive.contribution.breakdown.identityBindingCount).toBe(2);
    expect(archive.contribution.breakdown.meshSessionCount).toBe(9);
    expect(archive.contribution.breakdown.total).toBe(2);
    expect(archive.sections.contribution.filled).toBe(true);
  });

  it("orders timeline by timestamp and keeps event sources", () => {
    const archive = buildSeatAiArchiveReadModel(
      baseInput({
        status: "HANDOVER",
        seatStatus: "occupied",
        memberUserId: "user-1",
        memberEmail: "a@example.com",
        agentIds: ["bot-a"],
        botCount: 1,
        handoverStatus: "frozen",
        handoverCreatedAt: "2026-07-20T00:00:00.000Z",
        botBoundAt: "2026-07-10T00:00:00.000Z",
        offerTargetEmail: "next@example.com",
        offerOfferedAt: "2026-07-15T00:00:00.000Z",
      }),
    );
    expect(archive.timeline.events[0]?.id).toBe("handover_active");
    expect(archive.timeline.events.map((event) => event.source)).toEqual(
      expect.arrayContaining(["handover", "offer", "bot", "activation"]),
    );
    expect(archive.timeline.avgDailyHours).toBeNull();
  });
});

describe("buildSeatAiArchiveInput", () => {
  it("aggregates pending fields from seatSummaries and keeps email separate", () => {
    const input = buildSeatAiArchiveInput(
      {
        seatId: "seat-1",
        name: "销售助理",
        teamLabel: "销售部",
        responsibility: null,
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
        memberUserId: null,
        memberDisplayLabel: null,
        aiEmployeeLabel: "SAL-1",
        defaultAgentId: null,
        agentIds: [],
        defaultSpaceIds: [],
        memoryScopeIds: [],
        botCount: 0,
        groupCount: 0,
        totalCost: null,
        totalTokens: 12,
        sessionCount: 2,
        runtimeLabel: "ONLINE",
      },
      {
        seatSummaries: [
          {
            seatId: "seat-1",
            pendingEmployeeUser: "hire@example.com",
            pendingEmployeeDisplayName: "新人",
            pendingActivationExpiresAt: "2026-08-01T00:00:00.000Z",
            roleCode: "SAL-L1-001",
          },
        ],
        seatOperationalIdentityAccess: [],
      },
    );
    expect(input.pendingEmployeeUser).toBe("hire@example.com");
    expect(input.memberEmail).toBe("hire@example.com");
    expect(input.roleCode).toBe("SAL-L1-001");
    expect(input.totalTokens).toBe(12);
  });

  it("does not promote non-email currentEmployeeUser into memberEmail", () => {
    const input = buildSeatAiArchiveInput(
      {
        seatId: "seat-2",
        name: "工程师",
        teamLabel: "研发部",
        responsibility: null,
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-xyz",
        memberDisplayLabel: "李四",
        aiEmployeeLabel: "ENG-1",
        defaultAgentId: null,
        agentIds: [],
        defaultSpaceIds: [],
        memoryScopeIds: [],
        botCount: 0,
        groupCount: 0,
        totalCost: null,
      },
      {
        seatSummaries: [
          {
            seatId: "seat-2",
            currentEmployeeUser: "user-xyz",
            roleCode: "ENG-L1-001",
          },
        ],
        seatOperationalIdentityAccess: [],
      },
    );
    expect(input.memberEmail).toBeNull();
  });

  it("projects mesh bots, identity bindings and activity into archive input", () => {
    const input = buildSeatAiArchiveInput(
      {
        seatId: "seat-3",
        name: "运营助理",
        teamLabel: "运营部",
        responsibility: null,
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "ops@example.com",
        memberDisplayLabel: "王五",
        aiEmployeeLabel: "OPS-1",
        defaultAgentId: "bot-ops",
        agentIds: ["bot-ops"],
        defaultSpaceIds: ["space-1"],
        memoryScopeIds: [],
        botCount: 1,
        groupCount: 0,
        totalCost: 12,
        lastActiveAt: 1_700_000_000_000,
        offer: {
          targetEmployeeUser: "next@example.com",
          offeredAt: "2026-07-01T00:00:00.000Z",
        },
      },
      {
        seatSummaries: [{ seatId: "seat-3", roleCode: "OPS-L1-001" }],
        seatOperationalIdentityAccess: [],
        meshAgents: [
          {
            agentId: "bot-ops",
            sessionCount: 4,
            lastActiveAt: 1_700_000_100_000,
            ownership: {
              positionId: "seat-3",
              createdAt: "2026-06-01T00:00:00.000Z",
            },
          },
        ],
        employeeIdentityBindingRows: [
          { seatId: "seat-3", updatedAt: "2026-06-15T00:00:00.000Z" },
          { seatId: "seat-other", updatedAt: "2026-06-16T00:00:00.000Z" },
        ],
        recentIdentityBindingActivity: [
          {
            auditEventId: "evt-1",
            kind: "bound",
            identityDisplayName: "企微主号",
            agentLabel: "运营 Bot",
            seatId: "seat-3",
            seatTitle: "运营助理",
            createdAt: "2026-06-20T00:00:00.000Z",
          },
          {
            auditEventId: "evt-title-only",
            kind: "bound",
            identityDisplayName: "误匹配号",
            agentLabel: "其他 Bot",
            seatTitle: "运营助理",
            createdAt: "2026-06-21T00:00:00.000Z",
          },
        ],
        knownSkillsBySeatId: new Map([["seat-3", ["crm-sync"]]]),
      },
    );
    expect(input.roleCode).toBe("OPS-L1-001");
    expect(input.botBoundAt).toBe("2026-06-01T00:00:00.000Z");
    expect(input.meshSessionCount).toBe(4);
    expect(input.identityBindingCount).toBe(1);
    expect(input.knownSkills).toEqual(["crm-sync"]);
    expect(input.identityTimelineEvents?.map((event) => event.id)).toEqual(["identity_evt-1"]);
    expect(input.lastActiveAt).toBe(1_700_000_000_000);
  });
});
