import { describe, expect, it } from "vitest";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  detectHandoverExceptionFlags,
  formatHandoverExceptionFlagLabel,
  isRedundantHandoverAccessPolicy,
  normalizeCollaborationAssetKey,
  resolveCollaborationGroupDisplayName,
  resolveHandoverAccessPolicyLabel,
  resolveHandoverSessionDataStatusLabel,
} from "./enterprise-handover-asset-helpers.ts";

function createReadModel(
  partial: Partial<Pick<EnterprisePortReadModel, "meshGroups" | "meshAgents">>,
): EnterprisePortReadModel {
  return {
    meshGroups: partial.meshGroups ?? [],
    meshAgents: partial.meshAgents ?? [],
  } as EnterprisePortReadModel;
}

describe("enterprise-handover-asset-helpers", () => {
  it("normalizes space/group id prefixes for dedupe", () => {
    expect(normalizeCollaborationAssetKey("space-sales")).toBe("sales");
    expect(normalizeCollaborationAssetKey("group-sales")).toBe("sales");
    expect(normalizeCollaborationAssetKey("group-a")).toBe("a");
  });

  it("resolves collaboration display names from mesh groups", () => {
    const readModel = createReadModel({
      meshGroups: [
        {
          groupId: "group-sales",
          name: "销售协同组",
        } as EnterprisePortReadModel["meshGroups"][number],
      ],
    });
    expect(resolveCollaborationGroupDisplayName(readModel, "space-sales")).toBe("销售协同组");
    expect(resolveCollaborationGroupDisplayName(readModel, "group-sales")).toBe("销售协同组");
  });

  it("prefers collaboration.spaces.list titles over raw space ids", () => {
    const readModel = createReadModel({});
    expect(
      resolveCollaborationGroupDisplayName(
        readModel,
        "space-540aaa04-e98c-4f2a-b7d1-1234567890ab",
        {
          spaces: [
            {
              id: "space-540aaa04-e98c-4f2a-b7d1-1234567890ab",
              title: "产品研发与运营小组",
            },
          ],
        },
      ),
    ).toBe("产品研发与运营小组");
  });

  it("filters redundant access policies that mirror primary assets", () => {
    const redundant = isRedundantHandoverAccessPolicy({
      policy: {
        policyId: "p1",
        resourceType: "agent",
        resourceId: "agent-main",
        action: "execute",
      },
      agentIds: new Set(["agent-main"]),
      collaborationIds: new Set(["space-sales"]),
      seatMemoryScopeId: "seat:seat-1",
    });
    expect(redundant).toBe(true);

    const keepConnector = isRedundantHandoverAccessPolicy({
      policy: {
        policyId: "p2",
        resourceType: "connector",
        resourceId: "hubspot",
        action: "use",
      },
      agentIds: new Set(["agent-main"]),
      collaborationIds: new Set(["space-sales"]),
      seatMemoryScopeId: "seat:seat-1",
    });
    expect(keepConnector).toBe(false);
  });

  it("renders friendly labels for non-redundant policies", () => {
    const readModel = createReadModel({
      meshAgents: [
        {
          agentId: "agent-main",
          name: "主数字人",
        } as EnterprisePortReadModel["meshAgents"][number],
      ],
      meshGroups: [
        {
          groupId: "group-sales",
          name: "销售协同组",
        } as EnterprisePortReadModel["meshGroups"][number],
      ],
    });
    expect(
      resolveHandoverAccessPolicyLabel({
        policy: {
          policyId: "p1",
          resourceType: "connector",
          resourceId: "hubspot",
          action: "use",
        },
        seatTitle: "销售总监",
        readModel,
      }),
    ).toBe("连接器 · hubspot");
  });

  it("resolves session data row status labels from transfer execution", () => {
    expect(
      resolveHandoverSessionDataStatusLabel({
        dataKey: "history_archive",
        transfer: {
          recentSessions: false,
          historyArchive: true,
          coveredAgentIds: ["agent-main"],
          executedAt: "2026-06-12T12:00:00.000Z",
          archivedSessionIds: ["sess-old", "sess-older"],
        },
      }),
    ).toEqual({ label: "已归档 2", tone: "ok" });
    expect(
      resolveHandoverSessionDataStatusLabel({
        dataKey: "recent_sessions",
        transfer: {
          recentSessions: true,
          historyArchive: false,
          coveredAgentIds: ["agent-main"],
        },
      }),
    ).toEqual({ label: "待继承", tone: "warn" });
  });

  it("formats exception flags for human-readable display", () => {
    expect(formatHandoverExceptionFlagLabel("connector_rebind_required")).toBe(
      "连接器需继任后重新授权",
    );
    expect(
      detectHandoverExceptionFlags({ connectorCredentialReauthorizationRequired: true }),
    ).toEqual(["connector_rebind_required"]);
  });

  it("falls back to friendly collaboration labels for unresolved ids", () => {
    const readModel = createReadModel({});
    expect(resolveCollaborationGroupDisplayName(readModel, "grp-daniel-hhd-gmail-com")).toContain(
      "协作小组",
    );
    expect(resolveCollaborationGroupDisplayName(readModel, "space-540aaa04-e98c-4613")).toContain(
      "协作空间",
    );
  });
});
