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

function createMinimalReadModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "owner@example.com",
    membershipRole: "enterprise-admin",
    memberCount: 1,
    memberUsers: ["owner@example.com"],
    memberSummaries: [],
    adminCount: 1,
    seatCount: 2,
    occupiedSeatCount: 0,
    assignedSeatCount: 1,
    vacantSeatCount: 1,
    handoverSeatCount: 0,
    frozenSeatCount: 0,
    handoverCaseCount: 0,
    pendingOfferCount: 0,
    organizationDepartmentPaths: ["销售部"],
    seatSummaries: [
      {
        seatId: "seat-vacant",
        title: "空岗助理",
        teamLabel: "销售部",
        status: "vacant",
        currentEmployeeUser: null,
        currentEmployeeLabel: null,
        roleCode: "SAL-L1-001",
        defaultAgentId: null,
        agentIds: [],
        defaultSpaceIds: [],
        memoryScopeIds: [],
        responsibility: null,
      },
      {
        seatId: "seat-pending",
        title: "待激活助理",
        teamLabel: "销售部",
        status: "assigned",
        currentEmployeeUser: null,
        currentEmployeeLabel: null,
        pendingEmployeeUser: "hire@example.com",
        pendingEmployeeDisplayName: "新人",
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
      costPerSession: 0,
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

describe("organization inactive activation list (Phase 2)", () => {
  beforeAll(async () => {
    await preloadEnterpriseSurface("enterpriseOrganization");
  });

  beforeEach(() => {
    resetOrganizationStructureTransientState();
    window.history.pushState({}, "", "/openclaw");
  });

  it("exposes 未激活 as a first-class status filter tab", async () => {
    const container = document.createElement("div");
    const onSendActivationEmails = vi.fn();
    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createMinimalReadModel(),
        actions: {
          organization: {
            onRefreshUsers: vi.fn(),
            onSendActivationEmails,
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

    const inactiveTab = Array.from(
      container.querySelectorAll(".enterprise-org-status-tabs__item"),
    ).find((entry) => entry.textContent?.trim() === "未激活");
    expect(inactiveTab).toBeTruthy();
    expect(inactiveTab?.getAttribute("href")).toContain("organizationStatus=inactive");
  });

  it("filters to inactive seats and supports bulk send for pending emails", async () => {
    window.history.pushState({}, "", "/openclaw?organizationStatus=inactive");
    const container = document.createElement("div");
    const onSendActivationEmails = vi.fn();
    const seatOfferOnOpen = vi.fn();
    const readModel = createMinimalReadModel();

    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions: {
            organization: {
              onRefreshUsers: vi.fn(),
              onSendActivationEmails,
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
            onOpen: seatOfferOnOpen,
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

    await vi.waitFor(() => {
      renderSurface();
      expect(container.textContent).toContain("空岗助理");
      expect(container.textContent).toContain("待激活助理");
    });

    const selectAll = container.querySelector<HTMLInputElement>(
      'input[aria-label="全选本页未激活岗位"]',
    );
    expect(selectAll).toBeTruthy();
    selectAll!.checked = true;
    selectAll!.dispatchEvent(new Event("change", { bubbles: true }));
    renderSurface();

    expect(container.querySelector("[data-organization-bulk-activation]")).not.toBeNull();
    const sendButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("发送激活邮件"),
    );
    expect(sendButton).toBeTruthy();
    sendButton?.click();

    expect(onSendActivationEmails).toHaveBeenCalledWith(["hire@example.com"]);
    expect(seatOfferOnOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "activation",
        seatId: "seat-vacant",
      }),
    );
    expect(window.location.search).toContain("organizationSeat=seat-vacant");
  });
});
