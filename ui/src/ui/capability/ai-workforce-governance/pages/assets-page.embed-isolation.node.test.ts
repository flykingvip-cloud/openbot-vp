/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchAssets = vi.hoisted(() => vi.fn());
const fetchGovernanceActions = vi.hoisted(() => vi.fn());

vi.mock("../services/governanceApi.ts", () => ({
  fetchAssets,
  fetchGovernanceActions,
  executePendingAction: vi.fn(),
}));

import "./assets-page.ts";

describe("governance assets embed isolation", () => {
  afterEach(() => {
    document.body.replaceChildren();
    fetchAssets.mockReset();
    fetchGovernanceActions.mockReset();
  });

  it("keeps an empty enterprise mesh empty and does not call governance.assets.list", async () => {
    fetchAssets.mockRejectedValue(
      new Error("governance.assets.list must not run for an empty mesh"),
    );
    const page = document.createElement("governance-assets-page") as HTMLElement & {
      embedMode: boolean;
      readModel: unknown;
      agentsList: unknown;
      updateComplete: Promise<unknown>;
    };
    page.embedMode = true;
    page.agentsList = {
      defaultId: "ceo-bot",
      agents: [{ id: "ceo-bot", name: "CEO Bot" }],
    };
    document.body.appendChild(page);
    page.readModel = {
      meshAgents: [],
      meshGroups: [],
      meshUsers: [],
      meshSummary: { agentCount: 0, groupCount: 0 },
    };
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await page.updateComplete;

    expect(fetchAssets).not.toHaveBeenCalled();
    expect(fetchGovernanceActions).not.toHaveBeenCalled();
    expect(page.shadowRoot?.textContent ?? "").not.toContain("CEO Bot");
  });
});
