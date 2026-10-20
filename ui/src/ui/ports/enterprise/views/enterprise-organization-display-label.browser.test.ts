/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { resetOrganizationStructureTransientState } from "./enterprise-organization-surface.ts";
import {
  preloadEnterpriseSurface,
  renderEnterpriseSurface as renderEnterpriseSurfaceActual,
} from "./enterprise-surfaces.ts";

type RenderSurfaceArgs = Parameters<typeof renderEnterpriseSurfaceActual>[0];

function renderEnterpriseSurface(
  props: Omit<RenderSurfaceArgs, "ownershipTransferEditor" | "identityManagementEditor"> &
    Partial<Pick<RenderSurfaceArgs, "ownershipTransferEditor" | "identityManagementEditor">>,
) {
  return renderEnterpriseSurfaceActual({
    ...props,
    ownershipTransferEditor: props.ownershipTransferEditor ?? ({ onOpen: vi.fn() } as never),
    identityManagementEditor: props.identityManagementEditor ?? ({ onOpen: vi.fn() } as never),
  });
}

function createDirtyNameReadModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "owner@example.com",
    membershipRole: "enterprise-admin",
    memberCount: 1,
    memberUsers: ["owner@example.com"],
    memberSummaries: [
      {
        user: "368809901@qq.com",
        displayLabel: "368809901@qq.com",
        membershipRole: "member",
        status: "pending_activation",
        seatTitle: "368809901@qq.com",
        seatStatus: "assigned",
        seatTeamLabel: null,
      },
    ],
    adminCount: 1,
    seatCount: 2,
    occupiedSeatCount: 0,
    assignedSeatCount: 1,
    vacantSeatCount: 1,
    handoverSeatCount: 0,
    frozenSeatCount: 0,
    handoverCaseCount: 0,
    pendingOfferCount: 0,
    organizationDepartmentPaths: [],
    seatSummaries: [
      {
        seatId: "seat-email",
        title: "368809901@qq.com",
        teamLabel: null,
        status: "assigned",
        currentEmployeeUser: null,
        currentEmployeeLabel: null,
        pendingEmployeeUser: "368809901@qq.com",
        pendingEmployeeDisplayName: "368809901@qq.com",
        roleCode: "SAL-L1-001",
        defaultAgentId: null,
        agentIds: [],
        defaultSpaceIds: [],
        memoryScopeIds: [],
        responsibility: null,
      },
      {
        seatId: "seat-sales",
        title: "销售助理",
        teamLabel: "销售部",
        status: "vacant",
        currentEmployeeUser: null,
        currentEmployeeLabel: null,
        roleCode: "SAL-L1-002",
        defaultAgentId: null,
        agentIds: [],
        defaultSpaceIds: [],
        memoryScopeIds: [],
        responsibility: null,
      },
    ],
    handoverSummaries: [],
    offerSummaries: [],
    latestInviteCode: null,
    latestInviteExpiresAt: null,
    agentCount: 0,
    defaultAgentId: null,
    presenceCount: 0,
    runtimeHosts: [],
    sessionsCount: 0,
    nodeCount: 0,
    groupIds: [],
    cronJobCount: 0,
    meshSummary: {
      userCount: 0,
      agentCount: 0,
      groupCount: 0,
      onlineAgentCount: 0,
      activeAgentCount: 0,
      activeGroupCount: 0,
      activeAgentRate: 0,
      activeGroupRate: 0,
      totalCost: 0,
      totalTokens: 0,
      sessionCount: 0,
      inefficientAssetCount: 0,
      unattributedCostCount: 0,
      unownedAssetCount: 0,
      governanceIssueCount: 0,
    },
    meshUsers: [],
    meshAgents: [],
    meshGroups: [],
    meshIssues: [],
    identitySummaries: [],
    seatOperationalIdentityAccess: [],
    configIssueLabels: [],
  } as unknown as EnterprisePortReadModel;
}

describe("organization queue display labels", () => {
  beforeAll(async () => {
    await preloadEnterpriseSurface("enterpriseOrganization");
  });

  beforeEach(() => {
    resetOrganizationStructureTransientState();
    window.history.pushState({}, "", "/openclaw");
  });

  it("does not render emails as seat titles or owner names", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createDirtyNameReadModel(),
        actions: {
          organization: {
            onRefreshUsers: vi.fn(),
            onSendActivationEmails: vi.fn(),
            onStartSeatHandover: vi.fn(),
          },
        } as never,
        authPanelProps: {
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        } as never,
        seatOfferEditor: {
          mode: "offer",
          seatId: null,
          seatTitle: "",
          seatStatus: null,
          defaultAgentId: null,
          availableAgentIds: [],
          defaultSpaceIds: [],
          selectedAgentIds: [],
          selectedSpaceIds: [],
          inheritMode: "full",
          inheritMemoryScope: false,
          memoryScopeAvailable: false,
          employeeEmail: "",
          busy: false,
          error: null,
          notice: null,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onEmployeeEmailChange: vi.fn(),
          onInheritModeChange: vi.fn(),
          onToggleAgentId: vi.fn(),
          onToggleSpaceId: vi.fn(),
          onInheritMemoryScopeChange: vi.fn(),
          onSubmit: vi.fn(),
        },
        handoverEditor: { onOpen: vi.fn() } as never,
        createPositionEditor: { onOpen: vi.fn(), onClose: vi.fn() } as never,
      }),
      container,
    );

    expect(container.textContent).toContain("岗位数字人治理队列");
    expect(container.textContent).toContain("待补岗位名");
    expect(container.textContent).toContain("待补数字人名");
    expect(container.textContent).toContain("销售助理");
    expect(container.textContent).toContain("销售助理数字人");
    expect(container.textContent).toContain("368809901");
    expect(container.textContent).toContain("未分组");
    expect(container.textContent).toContain("销售部");
    expect(container.textContent).not.toContain("368809901@qq.com");
    expect(container.textContent).not.toContain("SAL-L1-001");
    expect(container.textContent).not.toContain("SAL-L1-002");
  });
});
