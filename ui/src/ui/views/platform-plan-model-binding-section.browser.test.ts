// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import "./platform-plan-model-binding-section.ts";
import type { PlatformPlanModelBindingSection } from "./platform-plan-model-binding-section.ts";

const PLAN = {
  id: "plan-a",
  name: "入门版",
  billingCycle: "monthly" as const,
  basePriceCents: 0,
  currentVersionId: "pv-a",
  seatQuota: {},
  botQuota: 1,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const BUNDLE_OVERVIEW = {
  catalog: ["ollama/llama3.2", "api-proxy-deepseek/deepseek-chat"],
  plans: [
    {
      plan: PLAN,
      versions: [
        {
          versionId: "pv-a",
          version: 1,
          status: "active" as const,
          snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 1, pricing: [] },
          binding: {
            planVersionId: "pv-a",
            allowedModelIds: ["ollama/llama3.2"],
            allowedPolicies: ["balanced"],
            policyId: "balanced",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          entitlementSnapshot: {
            planVersionId: "pv-a",
            monthlyPriceCents: 0,
            monthlyCredits: 0,
            maxSeats: {},
            maxBots: 1,
            allowedPolicies: ["balanced"],
            allowedTiers: [],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bindingState: "valid" as const,
          activationReady: true,
          activationBlockers: [],
        },
      ],
    },
  ],
};

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<platform-plan-model-binding-section> (browser)", () => {
  it("loads bundle overview and renders matrix + reverse view", async () => {
    const request = vi.fn((method: string) => {
      if (method === "platform-plan-bundle.overview") {
        return Promise.resolve(BUNDLE_OVERVIEW);
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement(
      "platform-plan-model-binding-section",
    ) as PlatformPlanModelBindingSection;
    el.client = { request } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const text = el.textContent ?? "";
    expect(text).toContain("入门版");
    expect(text).toContain("ollama/llama3.2");
    expect(request).toHaveBeenCalledWith(
      "platform-plan-bundle.overview",
      expect.objectContaining({
        debugSource: "legacy.platformPlanModelBindingSection.load",
      }),
    );
    expect(el.querySelector('[data-model-id="ollama/llama3.2"]')?.textContent).toContain("入门版");
  });

  it("toggling a model issues platform-plan-bundle.update", async () => {
    let updateReq: { planId: string; allowedModelIds: string[] } | null = null;
    const request = vi.fn((method: string, params: unknown) => {
      if (method === "platform-plan-bundle.overview") {
        return Promise.resolve(BUNDLE_OVERVIEW);
      }
      if (method === "platform-plan-bundle.update") {
        updateReq = params as { planId: string; allowedModelIds: string[] };
        return Promise.resolve({
          plan: PLAN,
          version: { id: "pv-a", planId: "plan-a", version: 1, status: "active" },
          binding: {
            planVersionId: "pv-a",
            allowedModelIds: updateReq.allowedModelIds,
            updatedAt: "x",
          },
        });
      }
      throw new Error(`unexpected ${method}`);
    });
    const el = document.createElement(
      "platform-plan-model-binding-section",
    ) as PlatformPlanModelBindingSection;
    el.client = { request } as never;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const boxes = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const target = [...boxes].find((b) => !b.checked)!;
    target.checked = true;
    target.dispatchEvent(new Event("change"));
    await flush();
    expect(updateReq).not.toBeNull();
    expect(updateReq!.planId).toBe("plan-a");
    expect(updateReq!.allowedModelIds.toSorted()).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
    ]);
  });
});
