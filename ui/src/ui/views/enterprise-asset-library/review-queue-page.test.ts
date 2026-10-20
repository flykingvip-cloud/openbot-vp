// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ReviewQueueItemWithAssessment } from "../../capability/enterprise-capability/endpoints.ts";
import type { ReviewQueuePageProps } from "./review-queue-page.ts";
import { renderReviewQueuePage } from "./review-queue-page.ts";

const PROPOSAL_ID = "proposal:urn:openclaw:skill:consult-win-advisor@1.0.2";

function queueEntry(
  overrides: Partial<ReviewQueueItemWithAssessment["item"]> = {},
): ReviewQueueItemWithAssessment {
  return {
    item: {
      id: overrides.id ?? PROPOSAL_ID,
      capabilityId: overrides.capabilityId ?? "consult-win-advisor",
      capabilityName: overrides.capabilityName ?? "打单参谋",
      capabilitySummary: overrides.capabilitySummary ?? "会前推演",
      usageScenarios: overrides.usageScenarios ?? ["首谈"],
      sourceEmployee: overrides.sourceEmployee ?? { id: "emp-1", name: "员工A" },
      sourceRobot: overrides.sourceRobot ?? { id: "robot-1", name: "Skill孵化" },
      sourceTaskSummary: overrides.sourceTaskSummary ?? "企业提交",
      usageCount: overrides.usageCount ?? 1,
      robotCount: overrides.robotCount ?? 1,
      lastUsedAt: overrides.lastUsedAt ?? 1,
      submittedAt: overrides.submittedAt ?? 1,
      status: overrides.status ?? "待审核",
      assetType: overrides.assetType,
      mcpServerName: overrides.mcpServerName,
      enterpriseAssetPackage: overrides.enterpriseAssetPackage,
    },
    assessment: {
      security: {
        sensitiveInfo: false,
        dangerousOps: false,
        externalCalls: true,
        permissionRisk: false,
      },
      quality: {
        successRate30d: 100,
        robotCount: 1,
        employeeCount: 1,
        namingCompliant: true,
      },
    },
  };
}

function pageProps(overrides: Partial<ReviewQueuePageProps> = {}): ReviewQueuePageProps {
  return {
    items: overrides.items ?? [queueEntry()],
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    pagination: overrides.pagination ?? {
      currentPage: 1,
      pageSize: 20,
      totalItems: 1,
    },
    filters: overrides.filters ?? { status: null, searchQuery: "" },
    submitting: overrides.submitting ?? false,
    submitError: overrides.submitError ?? null,
    lastReviewRecord: overrides.lastReviewRecord ?? null,
    lastEmployeeFeedbackNotice: overrides.lastEmployeeFeedbackNotice ?? null,
    onFilterChange: overrides.onFilterChange ?? vi.fn(),
    onPageChange: overrides.onPageChange ?? vi.fn(),
    onApprove: overrides.onApprove ?? vi.fn(),
    onReject: overrides.onReject ?? vi.fn(),
    onRequestModification: overrides.onRequestModification ?? vi.fn(),
    onBack: overrides.onBack ?? vi.fn(),
  };
}

function mount(props: ReviewQueuePageProps): HTMLDivElement {
  const container = document.createElement("div");
  render(renderReviewQueuePage(props), container);
  return container;
}

describe("renderReviewQueuePage actions", () => {
  it("fires approve/reject/modify when the review task id contains CSS-special characters", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onRequestModification = vi.fn();
    const container = mount(
      pageProps({
        onApprove,
        onReject,
        onRequestModification,
      }),
    );

    const form = container.querySelector(".review-queue-page__form");
    expect(form).not.toBeNull();
    const opinion = form!.querySelector<HTMLTextAreaElement>('[data-review-field="opinion"]');
    expect(opinion).not.toBeNull();
    opinion!.value = "安全复核通过，可以进入企业库。";

    const approve = container.querySelector<HTMLButtonElement>(".enterprise-btn--success");
    const reject = container.querySelector<HTMLButtonElement>(".enterprise-btn--danger");
    const modify = container.querySelector<HTMLButtonElement>(".enterprise-btn--warning");
    expect(approve?.disabled).toBe(false);
    expect(reject?.disabled).toBe(false);
    expect(modify?.disabled).toBe(false);

    approve?.click();
    reject?.click();
    modify?.click();

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove.mock.calls[0]?.[0]).toBe(PROPOSAL_ID);
    expect(onApprove.mock.calls[0]?.[1]).toBe("安全复核通过，可以进入企业库。");
    expect(onApprove.mock.calls[0]?.[2]).toMatchObject({
      applicableScope: { kind: "enterprise" },
      domain: "销售",
      needsEnterpriseSecrets: false,
      promoteToIncubation: false,
    });
    expect(onReject).toHaveBeenCalledWith(PROPOSAL_ID, "安全复核通过，可以进入企业库。");
    expect(onRequestModification).toHaveBeenCalledWith(
      PROPOSAL_ID,
      "安全复核通过，可以进入企业库。",
    );
  });

  it("shows submitError next to the action buttons", () => {
    const container = mount(pageProps({ submitError: "拒绝时审核意见至少需要 10 个字符" }));
    const errors = container.querySelectorAll(".review-queue-page__submit-error");
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[1]?.textContent).toContain("至少需要 10 个字符");
  });

  it("shows an MCP type badge and server name for MCP submissions", () => {
    const container = mount(
      pageProps({
        items: [
          queueEntry({
            assetType: "mcp",
            mcpServerName: "consult-win-advisor",
          }),
        ],
      }),
    );
    expect(container.querySelector(".review-queue-page__type-badge")?.textContent).toBe("MCP");
    expect(container.textContent).toContain("服务 consult-win-advisor");
  });
});
