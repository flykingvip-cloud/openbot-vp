/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  renderOrganizationPositionDetail,
  resetArchiveActiveSectionsForTests,
  resolveArchiveActiveSection,
  resolveArchivePrimaryActionLabels,
  setArchiveActiveSection,
  type OrganizationPositionDetailRow,
} from "./enterprise-org-position-detail.ts";

function createReadModel(
  overrides: Partial<EnterprisePortReadModel> = {},
): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "owner@example.com",
    membershipRole: "enterprise-admin",
    memberCount: 1,
    memberUsers: ["owner@example.com"],
    memberSummaries: [
      {
        user: "owner@example.com",
        displayLabel: "Owner",
        membershipRole: "enterprise-admin",
        status: "active",
        seatTitle: "销售助理",
        seatStatus: "occupied",
        seatTeamLabel: "销售部",
      },
    ],
    adminCount: 1,
    seatCount: 1,
    occupiedSeatCount: 0,
    assignedSeatCount: 0,
    vacantSeatCount: 1,
    handoverSeatCount: 0,
    frozenSeatCount: 0,
    handoverCaseCount: 0,
    pendingOfferCount: 0,
    organizationDepartmentPaths: ["销售部"],
    seatSummaries: [
      {
        seatId: "seat-1",
        title: "销售助理",
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
    ...overrides,
  } as EnterprisePortReadModel;
}

function baseRow(
  overrides: Partial<OrganizationPositionDetailRow> = {},
): OrganizationPositionDetailRow {
  return {
    seatId: "seat-1",
    name: "销售助理",
    teamLabel: "销售部",
    responsibility: null,
    memberUserId: null,
    memberDisplayLabel: null,
    memberLabel: null,
    aiEmployeeLabel: "SAL-L1-001",
    botCount: 0,
    groupCount: 0,
    totalCost: null,
    status: "VACANT",
    seatStatus: "vacant",
    defaultAgentId: null,
    agentIds: [],
    defaultSpaceIds: [],
    memoryScopeIds: [],
    offer: null,
    handover: null,
    roleCode: "SAL-L1-001",
    ...overrides,
  };
}

function renderDetail(params: {
  row?: OrganizationPositionDetailRow;
  readModel?: EnterprisePortReadModel;
  onSendActivationEmails?: (emails: string[]) => void;
  onBindMember?: (seatId: string, teamPath: string) => void;
  onBackToGovernance?: () => void;
  onDeleteSeat?: (seatId: string, seatTitle: string, teamPath: string) => void;
  onDeleteSeatAndMember?: (seatId: string, seatTitle: string, teamPath: string) => void;
  createPositionOnOpen?: (params?: {
    seatId?: string | null;
    seatTitle?: string | null;
    teamLabel?: string | null;
    responsibility?: string | null;
    employeeEmail?: string | null;
    defaultAgentId?: string | null;
    agentIds?: string[];
  }) => void;
  activationBusy?: boolean;
  activationError?: string | null;
  activationNotice?: string | null;
  seatOfferOnOpen?: (params: {
    mode?: "offer" | "activation";
    seatId: string;
    seatTitle: string;
    seatStatus?: string | null;
    defaultAgentId?: string | null;
    availableAgentIds?: string[];
    defaultSpaceIds?: string[];
    memoryScopeAvailable?: boolean;
    employeeEmail?: string | null;
  }) => void;
}) {
  const container = document.createElement("div");
  const onSendActivationEmails =
    params.onSendActivationEmails ?? vi.fn<(emails: string[]) => void>();
  const onBindMember = params.onBindMember ?? vi.fn<(seatId: string, teamPath: string) => void>();
  const seatOfferOnOpen =
    params.seatOfferOnOpen ??
    vi.fn<
      (params: {
        mode?: "offer" | "activation";
        seatId: string;
        seatTitle: string;
        seatStatus?: string | null;
        defaultAgentId?: string | null;
        availableAgentIds?: string[];
        defaultSpaceIds?: string[];
        memoryScopeAvailable?: boolean;
        employeeEmail?: string | null;
      }) => void
    >();
  render(
    renderOrganizationPositionDetail({
      row: params.row ?? baseRow(),
      readModel: params.readModel ?? createReadModel(),
      actions: {
        organization: {
          onSendActivationEmails,
          onStartSeatHandover: vi.fn(),
          onRemindSeatOffer: vi.fn(),
          onCancelSeatOffer: vi.fn(),
          onRevokeOwnership: vi.fn(),
        },
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
      createPositionEditor: {
        open: false,
        seatId: null,
        seatTitle: "",
        teamLabel: "",
        responsibility: "",
        employeeEmail: "",
        defaultAgentId: "",
        agentIds: [],
        agentOptions: [],
        busy: false,
        error: null,
        notice: null,
        onOpen: params.createPositionOnOpen ?? vi.fn(),
        onClose: vi.fn(),
        onSeatTitleChange: vi.fn(),
        onTeamLabelChange: vi.fn(),
        onResponsibilityChange: vi.fn(),
        onEmployeeEmailChange: vi.fn(),
        onDefaultAgentIdChange: vi.fn(),
        onToggleAgentId: vi.fn(),
        onSubmit: vi.fn(),
      },
      handoverEditor: {
        caseId: null,
        seatTitle: "",
        seatId: null,
        status: "",
        reviewSummary: "",
        exceptionFlags: "",
        successorEmail: "",
        seatStatus: null,
        defaultAgentIds: [],
        defaultSpaceIds: [],
        selectedAgentIds: [],
        selectedDataKeys: [],
        selectedSpaceIds: [],
        selectedPolicyIds: [],
        draftNotice: null,
        currentEmployeeEmail: "",
        currentEmployeeDisplayName: "",
        bindingStatus: null,
        teamLabel: "",
        assetSnapshot: null,
        assetQuery: "",
        assetKindFilter: "all",
        busy: false,
        error: null,
        notice: null,
        employeePolicies: [],
        seatPolicies: [],
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onReviewSummaryChange: vi.fn(),
        onExceptionFlagsChange: vi.fn(),
        onSuccessorEmailChange: vi.fn(),
        onToggleAgentAsset: vi.fn(),
        onToggleDataAsset: vi.fn(),
        onToggleSpaceAsset: vi.fn(),
        onTogglePolicyAsset: vi.fn(),
        onAssetQueryChange: vi.fn(),
        onAssetKindFilterChange: vi.fn(),
        onSelectAllAssets: vi.fn(),
        onClearAssetSelection: vi.fn(),
        onSaveDraft: vi.fn(),
        onSubmitReview: vi.fn(),
        onApproveFreeze: vi.fn(),
        onSendBinding: vi.fn(),
      } as never,
      ownershipTransferEditor: {
        open: false,
        tenantId: null,
        subjectKind: null,
        subjectId: null,
        subjectLabel: "",
        positionId: null,
        positionLabel: "",
        currentManagerUserId: null,
        currentManagerLabel: "",
        selectedUserId: "",
        candidateMembers: [],
        busy: false,
        error: null,
        notice: null,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onSelectedUserChange: vi.fn(),
        onSubmit: vi.fn(),
      },
      onBindMember,
      onBackToGovernance: params.onBackToGovernance,
      onDeleteSeat: params.onDeleteSeat,
      onDeleteSeatAndMember: params.onDeleteSeatAndMember,
      onClose: vi.fn(),
      activationBusy: params.activationBusy,
      activationError: params.activationError,
      activationNotice: params.activationNotice,
      onSendActivationEmails,
    }),
    container,
  );
  return { container, onSendActivationEmails, onBindMember, seatOfferOnOpen };
}

describe("enterprise-org-position-detail archive", () => {
  beforeEach(() => {
    resetArchiveActiveSectionsForTests();
  });

  it("exposes phase CTA labels for four archive phases", () => {
    expect(resolveArchivePrimaryActionLabels("vacant_shell").primary).toBe("邀请新成员");
    expect(resolveArchivePrimaryActionLabels("vacant_shell").secondary).toBe("分配在职成员");
    expect(resolveArchivePrimaryActionLabels("pending_activation").primary).toBe("发送激活邮件");
    expect(resolveArchivePrimaryActionLabels("pending_activation").secondary).toBeNull();
    expect(resolveArchivePrimaryActionLabels("occupied").primary).toBe("发起交接");
    expect(resolveArchivePrimaryActionLabels("occupied").secondary).toBe("更换成员");
    expect(resolveArchivePrimaryActionLabels("handover").primary).toBe("查看交接");
    expect(resolveArchivePrimaryActionLabels("handover").secondary).toBe("更换成员");
  });

  it("renders six archive section tabs and vacant CTAs", () => {
    const { container, onBindMember, seatOfferOnOpen } = renderDetail({});
    expect(container.querySelector(".enterprise-org-archive")).not.toBeNull();
    expect(container.querySelector("[data-archive-hero]")).not.toBeNull();
    expect(container.querySelector("[data-archive-completeness-meter]")).not.toBeNull();
    expect(container.querySelector("[data-archive-section-nav]")).not.toBeNull();
    expect(container.querySelectorAll("[data-archive-section-chip]").length).toBe(6);
    expect(container.querySelectorAll("[data-archive-section-badge]").length).toBe(1);
    expect(
      container
        .querySelector('[data-archive-section-chip="identity"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
    expect(container.querySelector("[data-archive-panel='identity']")).not.toBeNull();
    expect(container.querySelector("[data-archive-panel='skills']")).toBeNull();
    expect(
      container.getAttribute("data-archive-phase") ??
        container.querySelector("[data-archive-phase]")?.getAttribute("data-archive-phase"),
    ).toBe("vacant_shell");
    for (const title of [
      "身份与入职状态",
      "岗位数字人与运行时",
      "权限与能力清单",
      "技能与工具图谱",
      "资产与贡献",
      "工作与衔接时间线",
    ]) {
      expect(container.textContent).toContain(title);
    }
    expect(container.textContent).toContain("完善度");
    expect(container.textContent).not.toContain("身份流转");
    expect(container.textContent).not.toContain("岗位资料");
    const primary = container.querySelector<HTMLButtonElement>('[data-archive-cta="primary"]');
    expect(primary?.textContent?.trim()).toBe("邀请新成员");
    primary?.click();
    expect(seatOfferOnOpen).toHaveBeenCalledWith(expect.objectContaining({ mode: "activation" }));
    const secondary = container.querySelector<HTMLButtonElement>('[data-archive-cta="secondary"]');
    expect(secondary?.textContent?.trim()).toBe("分配在职成员");
    secondary?.click();
    expect(onBindMember).toHaveBeenCalledWith("seat-1", "销售部", "offer");
  });

  it("switches archive panels when section tabs are clicked", () => {
    const first = renderDetail({});
    expect(resolveArchiveActiveSection("seat-1")).toBe("identity");
    first.container
      .querySelector<HTMLButtonElement>('[data-archive-section-chip="skills"]')
      ?.click();
    expect(resolveArchiveActiveSection("seat-1")).toBe("skills");
    const second = renderDetail({});
    expect(
      second.container
        .querySelector('[data-archive-section-chip="skills"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
    expect(second.container.querySelector("[data-archive-panel='skills']")).not.toBeNull();
    expect(second.container.querySelector("[data-archive-panel='identity']")).toBeNull();
    expect(second.container.textContent).toContain("暂无已装技能");
  });

  it("renders pending activation send CTA", () => {
    const onSendActivationEmails = vi.fn();
    const { container } = renderDetail({
      onSendActivationEmails,
      row: baseRow({
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
        pendingEmployeeUser: "hire@example.com",
        pendingEmployeeDisplayName: "新人",
        pendingActivationExpiresAt: "2026-08-01T00:00:00.000Z",
      }),
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-1",
            title: "销售助理",
            teamLabel: "销售部",
            status: "assigned",
            currentEmployeeUser: null,
            currentEmployeeLabel: null,
            pendingEmployeeUser: "hire@example.com",
            pendingEmployeeDisplayName: "新人",
            pendingActivationExpiresAt: "2026-08-01T00:00:00.000Z",
            roleCode: "SAL-L1-001",
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
      }),
    });
    const root = container.querySelector("[data-archive-phase]");
    expect(root?.getAttribute("data-archive-phase")).toBe("pending_activation");
    expect(container.querySelector("[data-archive-email]")?.textContent?.trim()).toBe(
      "hire@example.com",
    );
    expect(container.querySelectorAll("[data-archive-email-edit]").length).toBe(1);
    expect(container.querySelector("[data-archive-email-edit]")?.textContent?.trim()).toBe(
      "编辑邮箱资料",
    );
    // Email edit stays inline in identity; hero only keeps the activation CTA.
    expect(container.querySelector('[data-archive-cta="secondary"]')).toBeNull();
    const lifecycle = container.querySelector('[data-archive-action-group="identity-lifecycle"]');
    expect(lifecycle?.textContent).toContain("发送激活邮件");
    expect(lifecycle?.textContent).not.toContain("编辑邮箱资料");
    expect(container.textContent).toContain("席位状态");
    expect(container.textContent).toContain("已分配");
    const expiry = container.querySelector(
      '.enterprise-org-ws__section [title="2026-08-01T00:00:00.000Z"]',
    );
    expect(expiry?.textContent?.trim()).toBeTruthy();
    expect(expiry?.textContent?.trim()).not.toBe("2026-08-01T00:00:00.000Z");
    expect(expiry?.textContent?.trim()).toMatch(/2026/);
    container.querySelector<HTMLButtonElement>('[data-archive-cta="primary"]')?.click();
    expect(onSendActivationEmails).toHaveBeenCalledWith(["hire@example.com"]);
  });

  it("surfaces activation send feedback on the archive detail and prefills edit email", () => {
    const onSendActivationEmails = vi.fn();
    const createPositionOnOpen = vi.fn();
    const { container } = renderDetail({
      onSendActivationEmails,
      createPositionOnOpen,
      activationError: "Only enterprise administrators can issue employee activations.",
      row: baseRow({
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
        pendingEmployeeUser: "hire@example.com",
        pendingEmployeeDisplayName: "新人",
      }),
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-1",
            title: "销售助理",
            teamLabel: "销售部",
            status: "assigned",
            currentEmployeeUser: null,
            currentEmployeeLabel: null,
            pendingEmployeeUser: "hire@example.com",
            pendingEmployeeDisplayName: "新人",
            pendingActivationExpiresAt: null,
            roleCode: "SAL-L1-001",
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
      }),
    });
    expect(container.textContent).toContain(
      "Only enterprise administrators can issue employee activations.",
    );
    container.querySelector<HTMLButtonElement>('[data-archive-meta="edit-position"]')?.click();
    expect(createPositionOnOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        seatId: "seat-1",
        employeeEmail: "hire@example.com",
      }),
    );
  });

  it("dedupes member and email when values match", () => {
    const { container } = renderDetail({
      row: baseRow({
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
        pendingEmployeeUser: "same@example.com",
        pendingEmployeeDisplayName: "same@example.com",
        memberLabel: "same@example.com",
      }),
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-1",
            title: "销售助理",
            teamLabel: "销售部",
            status: "assigned",
            currentEmployeeUser: null,
            currentEmployeeLabel: null,
            pendingEmployeeUser: "same@example.com",
            pendingEmployeeDisplayName: "same@example.com",
            pendingActivationExpiresAt: null,
            roleCode: "SAL-L1-001",
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
      }),
    });
    expect(container.textContent).toContain("成员邮箱");
    expect(container.textContent).not.toContain("当前成员");
    expect(container.querySelectorAll("[data-archive-email]").length).toBe(1);
  });

  it("renders occupied CTAs and does not fake email from user id", () => {
    const { container, seatOfferOnOpen } = renderDetail({
      row: baseRow({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-xyz",
        memberDisplayLabel: "张三",
        memberLabel: "user-xyz",
        agentIds: ["bot-a"],
        botCount: 1,
        totalTokens: 100,
      }),
    });
    expect(
      container.querySelector("[data-archive-phase]")?.getAttribute("data-archive-phase"),
    ).toBe("occupied");
    expect(container.querySelector("[data-archive-email]")?.textContent?.trim()).toBe("未提供");
    expect(container.querySelector("[data-archive-email-edit]")?.textContent?.trim()).toBe(
      "补填邮箱",
    );
    expect(container.querySelector('[data-archive-cta="primary"]')?.textContent?.trim()).toBe(
      "发起交接",
    );
    expect(container.querySelector('[data-archive-cta="secondary"]')?.textContent?.trim()).toBe(
      "更换成员",
    );
    expect(
      container.querySelector('[data-archive-cta="secondary"]')?.classList.contains("btn--ghost"),
    ).toBe(true);
    expect(
      container.querySelector('[data-archive-cta="primary"]')?.classList.contains("btn--primary"),
    ).toBe(false);
    container.querySelector<HTMLButtonElement>('[data-archive-cta="secondary"]')?.click();
    expect(seatOfferOnOpen).toHaveBeenCalled();
  });

  it("omits redundant header subtitle and keeps supervisor under digital tab", () => {
    setArchiveActiveSection("seat-1", "digital");
    const { container } = renderDetail({
      row: baseRow({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-xyz",
        memberDisplayLabel: "张三",
        memberLabel: "user-xyz",
        agentIds: ["bot-a"],
        botCount: 1,
      }),
    });
    expect(container.textContent).toContain("销售助理数字人");
    expect(container.textContent).not.toContain("bot-a");
    expect(container.textContent).not.toContain("SAL-L1-001");
    expect(container.querySelector(".enterprise-org-ws__sub")).toBeNull();
    expect(
      container.querySelector("[data-archive-panel='digital'] [data-archive-supervisor]"),
    ).not.toBeNull();
    setArchiveActiveSection("seat-1", "permissions");
    const { container: perms } = renderDetail({
      row: baseRow({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-xyz",
        memberDisplayLabel: "张三",
        memberLabel: "user-xyz",
        agentIds: ["bot-a"],
        botCount: 1,
      }),
    });
    expect(
      perms.querySelector("[data-archive-panel='permissions'] [data-archive-supervisor]"),
    ).toBeNull();
    expect(perms.textContent).toContain("配置授权后显示");
  });

  it("allows changing email on occupied archive via offer editor", () => {
    const { container, seatOfferOnOpen } = renderDetail({
      row: baseRow({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-kimmy",
        memberDisplayLabel: "kimmy li",
        memberLabel: "kimmy li",
        agentIds: ["bot-a"],
        botCount: 1,
      }),
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-1",
            title: "销售助理",
            teamLabel: "销售部",
            status: "occupied",
            currentEmployeeUser: "2432693274@qq.com",
            currentEmployeeLabel: "kimmy li",
            pendingEmployeeUser: null,
            pendingEmployeeDisplayName: null,
            pendingActivationExpiresAt: null,
            roleCode: "SAL-L1-001",
            defaultAgentId: "bot-a",
            agentIds: ["bot-a"],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
      }),
    });
    expect(container.querySelector("[data-archive-section-nav]")).not.toBeNull();
    expect(container.querySelectorAll("[data-archive-section-chip]").length).toBe(6);
    expect(container.querySelector("[data-archive-email]")?.textContent?.trim()).toBe(
      "2432693274@qq.com",
    );
    const edit = container.querySelector<HTMLButtonElement>("[data-archive-email-edit]");
    expect(edit?.textContent?.trim()).toBe("更改邮箱");
    edit?.click();
    expect(seatOfferOnOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "offer",
        seatId: "seat-1",
        employeeEmail: "2432693274@qq.com",
      }),
    );
  });

  it("converges lifecycle CTAs and danger panel in footer toolbar", () => {
    setArchiveActiveSection("seat-1", "digital");
    const { container } = renderDetail({
      row: baseRow({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-xyz",
        memberDisplayLabel: "张三",
        memberLabel: "user-xyz",
        defaultAgentId: "bot-a",
        agentIds: ["bot-a"],
        botCount: 1,
      }),
      onBackToGovernance: vi.fn(),
      onDeleteSeat: vi.fn(),
      onDeleteSeatAndMember: vi.fn(),
    });
    const hero = container.querySelector("[data-archive-hero]");
    const footer = container.querySelector("[data-archive-footer]");
    const toolbar = container.querySelector("[data-archive-footer-toolbar]");
    const lifecycle = container.querySelector('[data-archive-action-group="identity-lifecycle"]');
    const meta = container.querySelector('[data-archive-action-group="identity-meta"]');
    const ownership = container.querySelector('[data-archive-action-group="digital-ownership"]');
    const danger = container.querySelector("[data-archive-danger-zone]");
    expect(hero?.contains(lifecycle)).toBe(false);
    expect(hero?.contains(meta)).toBe(false);
    expect(toolbar?.contains(lifecycle)).toBe(true);
    expect(toolbar?.contains(meta)).toBe(true);
    expect(toolbar?.contains(danger)).toBe(true);
    expect(footer?.contains(danger)).toBe(true);
    expect(lifecycle?.textContent).toContain("更换成员");
    expect(lifecycle?.textContent).toContain("发起交接");
    expect(meta?.textContent).toContain("编辑");
    expect(ownership?.textContent).toContain("解绑机器人归属");
    expect(ownership?.textContent).toContain("转移机器人归属");
    expect(danger?.classList.contains("enterprise-org-archive__danger-actions")).toBe(true);
    expect(danger?.textContent).toContain("人岗同删");
    expect(danger?.textContent).toContain("删除岗位");
    expect(danger?.querySelector('[data-archive-danger="delete-seat-and-member"]')).toHaveProperty(
      "disabled",
      false,
    );
    expect(danger?.querySelector(".enterprise-org-archive__danger-title")).toBeNull();
    expect(danger?.querySelector(".enterprise-org-archive__danger-hint")).toBeNull();
    expect(danger?.querySelector('[data-archive-danger="delete-seat"]')).toHaveProperty(
      "disabled",
      true,
    );
    expect(danger?.querySelector('[data-archive-danger-guide="unbind"]')?.textContent?.trim()).toBe(
      "先流转成员",
    );
    expect(container.querySelector("[data-archive-footer-nav]")?.textContent).toContain(
      "返回模块首页",
    );
    expect(container.querySelector("[data-archive-footer-actions]")?.textContent).not.toContain(
      "解绑机器人归属",
    );
  });

  it("confirms 人岗同删 for an occupied archive and hides it on a vacant shell", () => {
    const onDeleteSeatAndMember = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const occupied = renderDetail({
      row: baseRow({
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-xyz",
        memberDisplayLabel: "张三",
        memberLabel: "user-xyz",
      }),
      onDeleteSeat: vi.fn(),
      onDeleteSeatAndMember,
    });
    occupied.container
      .querySelector<HTMLButtonElement>('[data-archive-danger="delete-seat-and-member"]')
      ?.click();
    expect(confirmSpy).toHaveBeenCalled();
    expect(String(confirmSpy.mock.calls[0]?.[0])).toContain("张三");
    expect(onDeleteSeatAndMember).toHaveBeenCalledWith("seat-1", "销售助理", "销售部");
    occupied.container.remove();

    const vacant = renderDetail({
      row: baseRow(),
      onDeleteSeat: vi.fn(),
      onDeleteSeatAndMember: vi.fn(),
    });
    expect(
      vacant.container.querySelector('[data-archive-danger="delete-seat-and-member"]'),
    ).toBeNull();
    confirmSpy.mockRestore();
  });

  it("renders active handover CTA", () => {
    const { container } = renderDetail({
      row: baseRow({
        status: "HANDOVER",
        seatStatus: "occupied",
        memberUserId: "owner@example.com",
        memberDisplayLabel: "Owner",
        memberLabel: "owner@example.com",
        handover: {
          handoverCaseId: "ho-1",
          seatTitle: "销售助理",
          status: "frozen",
          outgoingEmployeeUser: "owner@example.com",
          incomingEmployeeUser: null,
          createdAt: null,
          completedAt: null,
        },
      }),
    });
    expect(
      container.querySelector("[data-archive-phase]")?.getAttribute("data-archive-phase"),
    ).toBe("handover");
    expect(container.querySelector('[data-archive-cta="primary"]')?.textContent?.trim()).toBe(
      "查看交接",
    );
  });
});
