/**
 * Real Chromium layout regressions for pricing-v3 shared surface.
 *
 * Canonical runner (layout geometry + container queries):
 *   pnpm --dir ui test -- src/ui/views/pricing-v3/pricing-v3-layout.browser.test.ts
 *
 * Root vitest forks pool skips this suite (no document / no vitest browser API).
 */
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PricingPlanViewModel } from "../../capability/platform-pricing-catalog/index.ts";
import { renderPricingPage } from "./pricing-page.ts";

type ViewportApi = { viewport: (width: number, height: number) => Promise<void> };

const hasDom = typeof document !== "undefined";

async function loadBrowserPage(): Promise<ViewportApi | null> {
  if (!hasDom) {
    return null;
  }
  try {
    const mod = await import("vitest/browser");
    return mod.page as ViewportApi;
  } catch {
    return null;
  }
}

// Import shared styles when a DOM exists (vite injects them under ui browser mode).
if (hasDom) {
  void import("../../../styles/pricing-v3.css");
  void import("../../../styles/public-legal-page.css");
  void import("../../../styles/cost-budget-v2.css");
}

function makePlan(
  partial: Partial<PricingPlanViewModel> &
    Pick<PricingPlanViewModel, "id" | "slot" | "displayName">,
): PricingPlanViewModel {
  return {
    planVersionId: `pv-${partial.id}`,
    recommended: false,
    pricing: partial.pricing ?? { monthly: 99_900, quarterly: 94_905, annual: 84_915 },
    originalPricing: { monthly: partial.pricing?.monthly ?? 99_900 },
    cycleSavings: { quarterly: 14_985, annual: 179_880 },
    targetAudience: "受众",
    description: "说明",
    capabilities: ["能力 A"],
    metrics: {
      seats: 10,
      aiEmployees: 50,
      concurrentRuns: 10,
      creditsMonthly: 10_000,
      workflows: 20,
      knowledgeBases: 10,
      ...partial.metrics,
    },
    aiAuthorizationLabel: "20 基础 AI + 8 专业 AI + 2 高级 AI",
    cardFields: {
      overagePolicy: "超额阻断",
    },
    compare: {
      aiEmployees: 50,
      concurrentRuns: 10,
      creditsMonthly: 10_000,
      overagePolicy: "超额阻断",
    },
    cta: { label: "立即升级", type: "upgrade" },
    contactSales: false,
    freeTrial: false,
    ...partial,
  };
}

const FIVE_PLANS: PricingPlanViewModel[] = [
  makePlan({
    id: "trial",
    slot: "trial",
    displayName: "试用版",
    freeTrial: true,
    pricing: { monthly: 0 },
    metrics: { seats: 3, aiEmployees: 15, concurrentRuns: 2, creditsMonthly: 500 },
    aiAuthorizationLabel: "3 基础 AI",
    cta: { label: "免费试用", type: "trial" },
  }),
  makePlan({
    id: "starter",
    slot: "starter",
    displayName: "基础版",
    pricing: { monthly: 49_900, quarterly: 47_405, annual: 42_415 },
    metrics: { seats: 5, aiEmployees: 25, concurrentRuns: 5, creditsMonthly: 5_000 },
  }),
  makePlan({
    id: "pro",
    slot: "professional",
    displayName: "专业版",
    recommended: true,
    badge: "推荐",
    metrics: { seats: 20, aiEmployees: 100, concurrentRuns: 40, creditsMonthly: 120_000 },
  }),
  makePlan({
    id: "biz",
    slot: "business",
    displayName: "旗舰版",
    pricing: { monthly: 299_900, quarterly: 284_905, annual: 254_915 },
    metrics: { seats: 100, aiEmployees: 500, concurrentRuns: 250, creditsMonthly: 500_000 },
  }),
  makePlan({
    id: "ent",
    slot: "enterprise",
    displayName: "卓越版",
    contactSales: true,
    pricing: { monthly: 0 },
    metrics: {
      seats: "custom",
      aiEmployees: "custom",
      concurrentRuns: "custom",
      creditsMonthly: undefined,
    },
    aiAuthorizationLabel: "按需配置",
    cta: { label: "联系销售", type: "contact" },
  }),
];

type HostKind =
  | "bare"
  | "public-pricing" // real /pricing wrapper
  | "cost-budget-catalog" // cost-budget plan catalog panel
  | "auth-home"
  | "narrow-host"
  | "platform-shell";

function mountPage(
  hostWidth: number,
  opts?: {
    host?: HostKind;
    publicSurface?: boolean;
  },
) {
  const hostKind = opts?.host ?? "bare";
  const outer = document.createElement("div");
  outer.style.width = `${hostWidth}px`;
  outer.style.maxWidth = `${hostWidth}px`;
  outer.style.margin = "0 auto";
  outer.style.overflow = "hidden";
  outer.style.boxSizing = "border-box";

  // Real shared entry wrappers (must match production class names).
  if (hostKind === "public-pricing") {
    outer.className = "public-legal public-legal--wide";
  } else if (hostKind === "cost-budget-catalog") {
    outer.className = "cost-budget-v2 cost-budget-v2-catalog-panel";
  } else if (hostKind === "auth-home") {
    outer.className = "auth-home";
  } else if (hostKind === "narrow-host") {
    outer.className = "pricing-v3--narrow-host";
  } else if (hostKind === "platform-shell") {
    outer.className = "platform-pricing__compare-card-shell";
  }

  document.body.appendChild(outer);

  let mountRoot: HTMLElement = outer;
  if (hostKind === "public-pricing") {
    const frame = document.createElement("div");
    frame.className = "public-legal__pricing-frame";
    outer.appendChild(frame);
    mountRoot = frame;
  }

  const host = document.createElement("div");
  mountRoot.appendChild(host);
  render(
    renderPricingPage({
      catalog: {
        plans: FIVE_PLANS,
        compareRows: [
          {
            id: "audit",
            label: "审计日志",
            values: {
              starter: false,
              professional: true,
              business: true,
              enterprise: true,
            },
          },
        ],
        faq: [{ question: "如何升级？", answer: "在企业端选择套餐并确认。" }],
        billingHint: "按席位计费",
      },
      selectedCycle: "monthly",
      onSelectCycle: () => {},
      showCta: true,
      publicSurface: opts?.publicSurface ?? hostKind === "public-pricing",
      onSelectPlan: () => {},
      onContactSales: () => {},
    }),
    host,
  );
  return { outer, host, mountRoot };
}

function columnTrackCount(el: Element): number {
  const value = getComputedStyle(el).gridTemplateColumns;
  if (!value || value === "none") {
    return 0;
  }
  return value.split(/\s+/).filter(Boolean).length;
}

function noHorizontalOverflow(el: HTMLElement): boolean {
  return el.scrollWidth <= el.clientWidth + 1;
}

/** Assert every card has real spec items and none overflow. */
function assertSpecItemsNoOverflow(host: HTMLElement) {
  const items = [...host.querySelectorAll(".pricing-v3__spec-item")] as HTMLElement[];
  expect(items.length).toBeGreaterThan(0);
  // Five plans × ~5–6 specs each
  expect(items.length).toBeGreaterThanOrEqual(20);
  for (const item of items) {
    expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 2);
  }
}

const VIEWPORTS = [
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1280x900", width: 1280, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
] as const;

describe("pricing-v3 layout (chromium)", () => {
  let page: ViewportApi | null = null;

  beforeEach(async () => {
    page = await loadBrowserPage();
    if (!hasDom) {
      return;
    }
    document.body.style.margin = "0";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (!hasDom) {
      return;
    }
    document.body.innerHTML = "";
    document.body.style.margin = "";
  });

  it("is a no-op under root forks pool without browser APIs", async () => {
    if (!page || !hasDom) {
      expect(hasDom || page === null).toBe(true);
      return;
    }
    expect(page.viewport).toBeTypeOf("function");
  });

  it("does not force 5 columns or overflow when viewport is wide but host is 900px", async () => {
    if (!page || !hasDom) {
      return;
    }
    await page.viewport(1600, 1000);
    const { outer, host } = mountPage(900);

    const root = host.querySelector(".pricing-v3") as HTMLElement;
    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    expect(root).toBeTruthy();
    expect(grid).toBeTruthy();

    const cols = columnTrackCount(grid);
    expect(cols).toBeLessThanOrEqual(3);
    expect(cols).toBeGreaterThanOrEqual(1);

    expect(noHorizontalOverflow(outer)).toBe(true);
    expect(noHorizontalOverflow(root)).toBe(true);
    expect(noHorizontalOverflow(grid)).toBe(true);
    assertSpecItemsNoOverflow(host);
  });

  it("forces single column under pricing-v3--narrow-host even at 1200px host", async () => {
    if (!page || !hasDom) {
      return;
    }
    await page.viewport(1600, 1000);
    const { host } = mountPage(1200, { host: "narrow-host" });
    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    expect(columnTrackCount(grid)).toBe(1);
    expect(noHorizontalOverflow(host.querySelector(".pricing-v3") as HTMLElement)).toBe(true);
  });

  it("uses 5 columns only when the container itself is wide enough", async () => {
    if (!page || !hasDom) {
      return;
    }
    await page.viewport(1680, 1000);
    const { host } = mountPage(1600);
    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(columnTrackCount(grid)).toBe(5);
    expect(noHorizontalOverflow(host.querySelector(".pricing-v3") as HTMLElement)).toBe(true);
  });

  it("public /pricing frame at 1280px uses container query (≤3 cols), not viewport 5-col override", async () => {
    if (!page || !hasDom) {
      return;
    }
    // Historical bug: public-legal-page.css forced 5 cols at min-width 1180px.
    await page.viewport(1280, 900);
    const { outer, host, mountRoot } = mountPage(1280, { host: "public-pricing" });

    expect(outer.classList.contains("public-legal")).toBe(true);
    expect(mountRoot.classList.contains("public-legal__pricing-frame")).toBe(true);

    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const cols = columnTrackCount(grid);
    // Container ~1280 < 1480 → at most 3 columns (not 5).
    expect(cols).toBeLessThanOrEqual(3);
    expect(cols).toBeGreaterThanOrEqual(2);
    expect(noHorizontalOverflow(outer)).toBe(true);
    expect(noHorizontalOverflow(mountRoot)).toBe(true);
    assertSpecItemsNoOverflow(host);
  });

  it("public /pricing frame at 1600×900 host stays ≤3 cols (no 1180px viewport 5-col)", async () => {
    if (!page || !hasDom) {
      return;
    }
    // Wide browser chrome, content column 900px — must not use viewport 1180 rule.
    await page.viewport(1600, 1000);
    const { outer, host, mountRoot } = mountPage(900, { host: "public-pricing" });
    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(columnTrackCount(grid)).toBeLessThanOrEqual(3);
    expect(noHorizontalOverflow(outer)).toBe(true);
    expect(noHorizontalOverflow(mountRoot)).toBe(true);
  });

  it("cost-budget catalog panel uses container query without horizontal overflow", async () => {
    if (!page || !hasDom) {
      return;
    }
    await page.viewport(1600, 1000);
    const { outer, host } = mountPage(1000, { host: "cost-budget-catalog" });
    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    // 1000px host → 3 cols via container query (960+), not forced 1 or 5.
    const cols = columnTrackCount(grid);
    expect(cols).toBeLessThanOrEqual(3);
    expect(cols).toBeGreaterThanOrEqual(2);
    expect(noHorizontalOverflow(outer)).toBe(true);
    assertSpecItemsNoOverflow(host);
  });

  it("auth-home host forces single column (narrow marketing embed)", async () => {
    if (!page || !hasDom) {
      return;
    }
    await page.viewport(1440, 900);
    const { host } = mountPage(1100, { host: "auth-home" });
    const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;
    expect(columnTrackCount(grid)).toBe(1);
    expect(noHorizontalOverflow(host.querySelector(".pricing-v3") as HTMLElement)).toBe(true);
  });

  for (const vp of VIEWPORTS) {
    it(`${vp.name}: public-legal frame — no overflow, spec-items hit, CTA baseline, icons`, async () => {
      if (!page || !hasDom) {
        return;
      }
      await page.viewport(vp.width, vp.height);
      const { outer, host, mountRoot } = mountPage(vp.width, { host: "public-pricing" });

      const root = host.querySelector(".pricing-v3") as HTMLElement;
      const switcher = host.querySelector(
        "[data-testid='pricing-v3-cycle-switcher']",
      ) as HTMLElement;
      const cards = [...host.querySelectorAll("[data-testid='pricing-v3-card']")] as HTMLElement[];
      const grid = host.querySelector(".pricing-v3__grid") as HTMLElement;

      expect(cards.length).toBe(5);
      expect(switcher).toBeTruthy();
      const switcherRect = switcher.getBoundingClientRect();
      expect(switcherRect.width).toBeGreaterThan(0);
      expect(switcherRect.height).toBeGreaterThan(0);
      expect(switcherRect.right).toBeLessThanOrEqual(vp.width + 1);

      expect(noHorizontalOverflow(outer)).toBe(true);
      expect(noHorizontalOverflow(mountRoot)).toBe(true);
      expect(noHorizontalOverflow(root)).toBe(true);

      // Spec rows must be real .pricing-v3__spec-item nodes (not empty loop).
      assertSpecItemsNoOverflow(host);

      for (const card of cards) {
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      }

      // At 1280 and below, public frame must not be forced into 5 columns.
      if (vp.width < 1480) {
        expect(columnTrackCount(grid)).toBeLessThanOrEqual(3);
      }

      const byRow = new Map<number, number[]>();
      for (let i = 0; i < cards.length; i++) {
        const top = Math.round(cards[i].getBoundingClientRect().top);
        const list = byRow.get(top) ?? [];
        const cta = cards[i].querySelector("[data-testid='pricing-v3-cta']");
        if (cta) {
          list.push(cta.getBoundingClientRect().bottom);
        }
        byRow.set(top, list);
      }
      for (const bottomsInRow of byRow.values()) {
        if (bottomsInRow.length < 2) {
          continue;
        }
        expect(Math.max(...bottomsInRow) - Math.min(...bottomsInRow)).toBeLessThanOrEqual(4);
      }

      const icons = [
        ...host.querySelectorAll(
          ".pricing-v3__card-icon svg, .pricing-v3__compare-yes svg, .pricing-v3__spec-icon svg",
        ),
      ] as SVGElement[];
      expect(icons.length).toBeGreaterThan(0);
      for (const svg of icons) {
        const r = svg.getBoundingClientRect();
        expect(r.width).toBeGreaterThanOrEqual(12);
        expect(r.width).toBeLessThanOrEqual(40);
        expect(r.height).toBeGreaterThanOrEqual(12);
        expect(r.height).toBeLessThanOrEqual(40);
      }

      const entCard = host.querySelector('[data-plan-id="ent"]') as HTMLElement;
      expect(entCard?.textContent).not.toMatch(/Credits/);
    });
  }
});
