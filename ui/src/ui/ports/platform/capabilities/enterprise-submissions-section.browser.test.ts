// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import {
  renderEnterpriseSubmissionsSection,
  resetEnterpriseSubmissionsSectionState,
} from "./enterprise-submissions-section.ts";

function createProps(
  overrides?: Partial<PlatformSurfaceProps["actions"]["capabilities"]>,
): PlatformSurfaceProps {
  return {
    tab: "platformCapabilities",
    basePath: "/platform",
    readModel: {} as never,
    channelsProps: {} as never,
    pageViewModels: {} as never,
    actions: {
      dashboard: { onRefresh: async () => {} },
      tenants: {
        onRefresh: async () => {},
        onRefreshDirectory: async () => {},
        onRefreshCoverage: async () => {},
      },
      capabilities: {
        onRefresh: async () => {},
        onRefreshCatalog: async () => {},
        onRefreshInstalled: async () => {},
        onRefreshSetupHealth: async () => {},
        onResolveRemoteImport: async () => [],
        onDiscover: async () => {},
        onSubmitExternalProposal: async () => {},
        onApproveProposal: async () => {},
        onRejectProposal: async () => {},
        onPromoteDistribution: async () => {},
        onRevokeDistribution: async () => {},
        onDeprecate: async () => {},
        onRetire: async () => {},
        onUpdateManifest: async () => {},
        onRefreshEnterpriseSubmissions: async () => ({
          submissions: [
            {
              submissionId: "sub-1",
              capabilityId: "cap-demo",
              capabilityName: "演示能力",
              enterpriseId: "ent-a",
              enterpriseName: "演示企业",
              submittedAt: Date.now(),
              status: "pending-review",
              sanitized: true,
              sanitizationFindings: 3,
              sanitizedPackageId: "pkg-1",
              artifactHash: "sha256-demo",
            },
          ],
          total: 1,
          pendingCount: 1,
          reviewingCount: 0,
        }),
        onReviewEnterpriseSubmission: async (submissionId: string) => ({
          submissionId,
          capabilityId: "cap-demo",
          capabilityName: "演示能力",
          enterpriseId: "ent-a",
          enterpriseName: "演示企业",
          submittedAt: Date.now(),
          status: "pending-review",
          sanitized: true,
          sanitizationFindings: 3,
          sanitizedPackageId: "pkg-1",
          artifactHash: "sha256-demo",
          sourceProvenance: "enterprise-sanitization",
          reviewerId: null,
          reviewedAt: null,
          rejectionReason: null,
        }),
        onPublishEnterpriseSubmission: vi.fn(async () => {}),
        onRejectEnterpriseSubmission: vi.fn(async () => {}),
        onReturnEnterpriseSubmission: vi.fn(async () => {}),
        onApproveEnterpriseOnlySubmission: vi.fn(async () => {}),
        ...overrides,
      },
      models: {
        onRefresh: async () => {},
        onRefreshPool: async () => {},
        onRefreshCatalog: async () => {},
        onProbeHealth: async () => {},
        onRefreshPolicies: async () => {},
        onRefreshOverrides: async () => {},
      },
      platformAgents: { onRefresh: async () => {} },
      advanced: { onRefresh: async () => {} },
      auth: { onRefresh: async () => {} },
      channels: { onRefresh: async () => {} },
      config: { onRefresh: async () => {} },
      debug: { onRefresh: async () => {} },
      devices: { onRefresh: async () => {} },
      execApprovals: { onRefresh: async () => {} },
      logs: { onRefresh: async () => {} },
      nodes: { onRefresh: async () => {} },
      presence: { onRefresh: async () => {} },
      sessions: { onRefresh: async () => {} },
      skills: { onRefresh: async () => {} },
    },
  } as unknown as PlatformSurfaceProps;
}

describe("enterprise-submissions-section", () => {
  let container: HTMLDivElement;
  let messages: Array<{ kind: "success" | "error"; text: string }>;

  beforeEach(() => {
    resetEnterpriseSubmissionsSectionState();
    container = document.createElement("div");
    document.body.appendChild(container);
    messages = [];
  });

  afterEach(() => {
    container.remove();
    resetEnterpriseSubmissionsSectionState();
  });

  it("renders pending enterprise submissions from gateway", async () => {
    const props = createProps();
    render(
      renderEnterpriseSubmissionsSection({
        props,
        requestRerender: () => {
          render(
            renderEnterpriseSubmissionsSection({
              props,
              requestRerender: () => {},
              onShowActionMessage: (kind, text) => messages.push({ kind, text }),
              onOpenCapabilityDistribution: () => {},
            }),
            container,
          );
        },
        onShowActionMessage: (kind, text) => messages.push({ kind, text }),
        onOpenCapabilityDistribution: () => {},
      }),
      container,
    );
    await vi.waitFor(() => {
      expect(container.textContent).toContain("演示能力");
      expect(container.textContent).toContain("待审核");
    });
  });

  it("publishes a submission and opens distribution guidance", async () => {
    const onPublish = vi.fn(async () => {});
    const onOpenDistribution = vi.fn();
    const props = createProps({ onPublishEnterpriseSubmission: onPublish });
    const createHost = () => ({
      props,
      requestRerender: () => {
        render(renderEnterpriseSubmissionsSection(createHost()), container);
      },
      onShowActionMessage: (kind: "success" | "error", text: string) =>
        messages.push({ kind, text }),
      onOpenCapabilityDistribution: onOpenDistribution,
    });
    const host = createHost();

    render(renderEnterpriseSubmissionsSection(host), container);
    await vi.waitFor(() => expect(container.textContent).toContain("演示能力"));

    const reviewButton = container.querySelector<HTMLElement>(
      ".platform-capabilities__inline-action.is-primary",
    );
    expect(reviewButton).toBeTruthy();
    reviewButton?.click();

    await vi.waitFor(() => expect(container.textContent).toContain("发布到平台"));

    const publishButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("发布到平台"),
    );
    expect(publishButton).toBeTruthy();
    publishButton?.click();

    await vi.waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith("sub-1");
      expect(onOpenDistribution).toHaveBeenCalledWith("cap-demo");
    });
  });
});
