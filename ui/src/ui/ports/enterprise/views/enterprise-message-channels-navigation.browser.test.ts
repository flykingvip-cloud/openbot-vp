/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderAccessControlCenter } from "./enterprise-access-control-surface.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

describe("enterprise channels settings navigation", () => {
  it("switches from enterprise channels to another settings tab", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/channels");
    const container = document.createElement("div");
    const props = {
      basePath: "",
      client: null,
      readModel: {
        currentTenantId: "acme",
        currentTenantLabel: "Acme",
        memberSummaries: [],
        adminCount: 0,
        memberCount: 0,
        seatCount: 0,
        occupiedSeatCount: 0,
        agentCount: 0,
        groupIds: [],
        channelCount: 0,
        configuredProviderCount: 0,
        configIssueCount: 0,
        missingCostEntries: 0,
        sessionsCount: 0,
        meshSummary: { governanceIssueCount: 0 },
      },
      actions: {
        settings: {
          onRefresh: () => undefined,
          onSyncChannelToOperationalIdentity: async () => undefined,
        },
      },
      channelCredentialsEditor: {
        syncBusy: false,
        identityLinkHint: null,
        onSelectChannel: () => undefined,
      },
    } as unknown as EnterpriseSurfaceProps;

    render(renderAccessControlCenter(props, []), container);

    const profileTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent?.trim() === "企业信息");
    expect(profileTab).toBeDefined();
    profileTab?.click();

    expect(window.location.pathname).toBe("/enterprise/acme/settings/profile");
  });
});
