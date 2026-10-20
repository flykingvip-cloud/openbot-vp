// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { normalizeGovernanceOverview } from "../controllers/operational-identity-governance.ts";
import { renderOperationalIdentityGovernancePanel } from "./operational-identity-governance-panel.ts";

function mount(template: unknown): HTMLElement {
  const container = document.createElement("div");
  render(template as never, container);
  return container;
}

describe("normalizeGovernanceOverview (controller)", () => {
  it("fills defensive defaults for a sparse payload", () => {
    const overview = normalizeGovernanceOverview({ scope: { kind: "platform" } });
    expect(overview.totals.identities).toBe(0);
    expect(overview.recentDenials).toEqual([]);
    expect(overview.recentLifecycle).toEqual([]);
    expect(overview.activeGrants).toBe(0);
  });
});

describe("renderOperationalIdentityGovernancePanel", () => {
  it("renders totals, tenant breakdown, denials, and lifecycle for platform scope", () => {
    const container = mount(
      renderOperationalIdentityGovernancePanel({
        loading: false,
        error: null,
        overview: normalizeGovernanceOverview({
          scope: { kind: "platform" },
          totals: { identities: 7, active: 5, expired: 1, reauthRequired: 1, revoked: 0 },
          activeGrants: 4,
          pendingBindingRequests: 2,
          recentDenials: [
            {
              eventId: "e1",
              ownerId: "user-9",
              tenantId: "tenant-a",
              agentId: "agent-1",
              identityId: "i1",
              provider: "github-personal",
              action: "create_issue",
              result: "denied",
              denialCode: "USER_IDENTITY_ENTERPRISE_SEAT_REVOKED",
              createdAt: "2026-06-01T00:00:00.000Z",
            },
          ],
          recentLifecycle: [
            {
              eventId: "l1",
              ownerId: "user-9",
              identityId: "i1",
              provider: "github-personal",
              action: "revoked",
              createdAt: "2026-06-01T00:00:00.000Z",
            },
          ],
          tenantBreakdown: [{ tenantId: "tenant-a", identities: 7, activeGrants: 4, denials: 1 }],
        }),
      }),
    );
    expect(container.textContent).toContain("运营身份监管");
    expect(container.textContent).toContain("平台（全部租户）");
    expect(container.textContent).toContain("7");
    expect(container.textContent).toContain("tenant-a");
    expect(container.textContent).toContain("USER_IDENTITY_ENTERPRISE_SEAT_REVOKED");
    expect(container.textContent).toContain("已吊销");
  });

  it("blocks platform scope data in enterprise view context", () => {
    const container = mount(
      renderOperationalIdentityGovernancePanel({
        viewContext: "enterprise",
        loading: false,
        error: null,
        overview: normalizeGovernanceOverview({
          scope: { kind: "platform" },
          totals: { identities: 99, active: 99, expired: 0, reauthRequired: 0, revoked: 0 },
        }),
      }),
    );
    expect(container.textContent).toContain("运营身份监管");
    expect(container.textContent).toContain("企业管理员");
    expect(container.textContent).not.toContain("平台（全部租户）");
    expect(container.textContent).not.toContain("99");
  });

  it("shows an error alert when the overview failed to load", () => {
    const container = mount(
      renderOperationalIdentityGovernancePanel({
        overview: null,
        loading: false,
        error: "运营身份监管数据刷新失败。",
      }),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
