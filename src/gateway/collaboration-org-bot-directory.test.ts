import { describe, expect, it } from "vitest";
import {
  assertCollaborationBotsBelongToTenant,
  buildCollaborationOrgBotDirectory,
  isCollaborationOrgBotOwnedByActor,
} from "./collaboration-org-bot-directory.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import type { OwnershipRecord } from "./ownership-store.js";
import type { GatewayAgentRow } from "./session-utils.js";

const agents: GatewayAgentRow[] = [
  { id: "main", name: "大白管家", scope: "self" },
  {
    id: "research-bot",
    name: "研究助理",
    scope: "shared",
    ownerId: "employee:alice",
    ownerName: "Alice",
  },
  { id: "legal-bot", name: "法律机器人", scope: "self" },
];

const ownershipRecords: OwnershipRecord[] = [
  {
    id: "t1:agent:main",
    tenantId: "t1",
    subjectKind: "agent",
    subjectId: "main",
    positionId: "seat-ceo",
    positionLabel: "CEO",
    createdByUserId: "ceo@acme.com",
    createdByUserLabel: "CEO",
    currentManagerUserId: "ceo@acme.com",
    currentManagerLabel: "CEO",
    bindingStatus: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "t1:agent:legal-bot",
    tenantId: "t1",
    subjectKind: "agent",
    subjectId: "legal-bot",
    positionId: "seat-legal",
    positionLabel: "法务",
    createdByUserId: "legal@acme.com",
    createdByUserLabel: "法务同学",
    currentManagerUserId: "legal@acme.com",
    currentManagerLabel: "法务同学",
    bindingStatus: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const seatStore = {
  seats: {
    "seat-research": {
      seatId: "seat-research",
      tenantId: "t1",
      title: "研究员",
      currentEmployeeId: "alice@acme.com",
      status: "active",
      defaultAgentAssetIds: [],
      defaultSpaceIds: [],
    },
  },
  assetBindings: {
    "binding-research": {
      bindingId: "binding-research",
      tenantId: "t1",
      seatId: "seat-research",
      assetType: "agent",
      assetId: "research-bot",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
} as unknown as EnterpriseSeatAssetsStore;

describe("collaboration-org-bot-directory", () => {
  it("lists all tenant bots with resolved owners for collaboration picking", () => {
    const directory = buildCollaborationOrgBotDirectory({
      tenantId: "t1",
      agents,
      ownershipRecords,
      seatStore,
      memberLabels: new Map([["alice@acme.com", "Alice"]]),
    });

    expect(directory.map((entry) => entry.agentId)).toEqual(
      expect.arrayContaining(["main", "research-bot", "legal-bot"]),
    );
    expect(directory.find((entry) => entry.agentId === "research-bot")).toMatchObject({
      ownerUserId: "alice@acme.com",
      ownerLabel: "Alice",
    });
    expect(directory.find((entry) => entry.agentId === "legal-bot")).toMatchObject({
      ownerUserId: "legal@acme.com",
      ownerLabel: "法务同学",
    });
  });

  it("detects whether the acting user owns a directory bot", () => {
    const identities = new Set(["ceo@acme.com"]);
    expect(
      isCollaborationOrgBotOwnedByActor(
        { agentId: "main", ownerUserId: "ceo@acme.com" },
        identities,
      ),
    ).toBe(true);
    expect(
      isCollaborationOrgBotOwnedByActor(
        { agentId: "legal-bot", ownerUserId: "legal@acme.com" },
        identities,
      ),
    ).toBe(false);
  });

  it("does not list install-wide agents that belong to another tenant", () => {
    const directory = buildCollaborationOrgBotDirectory({
      tenantId: "t1",
      agents: [
        ...agents,
        {
          id: "bot-2",
          name: "市场助手",
          scope: "self",
          ownerId: "upbeyond-user",
          ownerName: "upbeyond",
        },
      ],
      ownershipRecords: [
        ...ownershipRecords,
        {
          id: "001:agent:bot-2",
          tenantId: "001",
          subjectKind: "agent",
          subjectId: "bot-2",
          positionId: "seat-upbeyond",
          positionLabel: "市场",
          createdByUserId: "upbeyond-user",
          createdByUserLabel: "upbeyond",
          currentManagerUserId: "upbeyond-user",
          currentManagerLabel: "upbeyond",
          bindingStatus: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      seatStore,
      memberLabels: new Map([["alice@acme.com", "Alice"]]),
    });

    expect(directory.map((entry) => entry.agentId)).toEqual(
      expect.arrayContaining(["main", "research-bot", "legal-bot"]),
    );
    expect(directory.some((entry) => entry.agentId === "bot-2")).toBe(false);
  });

  it("includes a config-owned bot when the owner is a current tenant seat occupant", () => {
    const directory = buildCollaborationOrgBotDirectory({
      tenantId: "t1",
      agents: [
        ...agents,
        {
          id: "hejun-draft-bot",
          name: "和君草稿助手",
          scope: "self",
          ownerId: "alice@acme.com",
          ownerName: "Alice",
        },
      ],
      ownershipRecords,
      seatStore,
      memberLabels: new Map([["alice@acme.com", "Alice"]]),
    });

    expect(directory.find((entry) => entry.agentId === "hejun-draft-bot")).toMatchObject({
      ownerUserId: "alice@acme.com",
      ownerLabel: "Alice",
    });
  });

  it("rejects inviting a bot that is not proven to belong to the tenant", () => {
    expect(() =>
      assertCollaborationBotsBelongToTenant({
        tenantId: "t1",
        agents,
        ownershipRecords,
        seatStore,
        existingMembers: [],
        nextMembers: [{ memberKind: "bot", agentId: "bot-2" }],
      }),
    ).toThrow("只能邀请本企业租户的机器人加入协作小组");
  });

  it("allows inviting a same-tenant bot and keeps an already-rostered outsider", () => {
    expect(() =>
      assertCollaborationBotsBelongToTenant({
        tenantId: "t1",
        agents,
        ownershipRecords,
        seatStore,
        existingMembers: [{ memberKind: "bot", agentId: "bot-2" }],
        nextMembers: [
          { memberKind: "bot", agentId: "bot-2" },
          { memberKind: "bot", agentId: "legal-bot" },
        ],
      }),
    ).not.toThrow();
  });
});
