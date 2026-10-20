#!/usr/bin/env node
/**
 * Capture pricing-v3 visual acceptance screenshots at five viewports.
 *
 * Renders the real Lit pricing page (fixture catalog + production CSS) so layout
 * matches shared component code without requiring a live gateway.
 *
 * Usage (repo root):
 *   node --import tsx scripts/pricing-v3-viewport-shots.mjs
 *   # or
 *   pnpm exec tsx scripts/pricing-v3-viewport-shots.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "ui/src/ui/views/pricing-v3/shots");

const VIEWPORTS = [
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1280x900", width: 1280, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
];

function makePlan(partial) {
  const contactSales = Boolean(partial.contactSales);
  const metricsIn = partial.metrics ?? {};
  // Align with pricing-view-model: enterprise / contactSales omit creditsMonthly.
  const creditsMonthly = Object.prototype.hasOwnProperty.call(metricsIn, "creditsMonthly")
    ? metricsIn.creditsMonthly
    : contactSales
      ? undefined
      : 10_000;
  return {
    id: partial.id,
    planVersionId: partial.planVersionId ?? `pv-${partial.id}`,
    slot: partial.slot,
    displayName: partial.displayName,
    recommended: Boolean(partial.recommended),
    pricing: partial.pricing ?? { monthly: 99_900, quarterly: 94_905, annual: 84_915 },
    originalPricing: partial.originalPricing ?? { monthly: partial.pricing?.monthly ?? 99_900 },
    cycleSavings: partial.cycleSavings ?? { quarterly: 14_985, annual: 179_880 },
    badge: partial.badge,
    targetAudience: partial.targetAudience ?? "受众",
    description: partial.description ?? "说明",
    capabilities: partial.capabilities ?? ["能力 A", "能力 B"],
    metrics: {
      seats: metricsIn.seats ?? (contactSales ? "custom" : 10),
      aiEmployees: metricsIn.aiEmployees ?? (contactSales ? "custom" : 50),
      concurrentRuns: metricsIn.concurrentRuns ?? (contactSales ? "custom" : 10),
      creditsMonthly,
      workflows: metricsIn.workflows ?? (contactSales ? "custom" : 20),
      knowledgeBases: metricsIn.knowledgeBases ?? (contactSales ? "custom" : 10),
    },
    aiAuthorizationLabel:
      partial.aiAuthorizationLabel ?? (contactSales ? "按需配置" : "基础 AI · 专业 AI"),
    tierLabel: partial.tierLabel ?? "Tier B",
    cardFields: {
      governance: partial.cardFields?.governance ?? "高级治理",
      sla: partial.cardFields?.sla ?? "99.5%",
      dataIsolation: partial.cardFields?.dataIsolation ?? "逻辑隔离",
    },
    compare: partial.compare ?? {},
    cta: partial.cta ?? { label: "立即升级", type: "upgrade" },
    contactSales,
    freeTrial: Boolean(partial.freeTrial),
  };
}

const FIXTURE_PLANS = [
  makePlan({
    id: "trial",
    slot: "trial",
    displayName: "试用版",
    freeTrial: true,
    pricing: { monthly: 0 },
    metrics: { seats: 3, aiEmployees: 15, concurrentRuns: 2, creditsMonthly: 500 },
    aiAuthorizationLabel: "基础 AI",
    cta: { label: "免费试用", type: "trial" },
    cardFields: { governance: "无", sla: "无", dataIsolation: "共享环境" },
  }),
  makePlan({
    id: "starter",
    slot: "starter",
    displayName: "基础版",
    pricing: { monthly: 49_900, quarterly: 47_405, annual: 42_415 },
    metrics: { seats: 5, aiEmployees: 25, concurrentRuns: 5, creditsMonthly: 5_000 },
    aiAuthorizationLabel: "基础 AI · 专业 AI",
    cta: { label: "立即升级", type: "upgrade" },
  }),
  makePlan({
    id: "pro",
    slot: "professional",
    displayName: "专业版",
    recommended: true,
    badge: "推荐",
    metrics: { seats: 20, aiEmployees: 100, concurrentRuns: 40, creditsMonthly: 120_000 },
    aiAuthorizationLabel: "基础 AI · 专业 AI",
    cta: { label: "立即升级", type: "upgrade" },
  }),
  makePlan({
    id: "biz",
    slot: "business",
    displayName: "旗舰版",
    pricing: { monthly: 299_900, quarterly: 284_905, annual: 254_915 },
    metrics: { seats: 100, aiEmployees: 500, concurrentRuns: 250, creditsMonthly: 500_000 },
    aiAuthorizationLabel: "基础 AI · 专业 AI · 高级 AI",
    cta: { label: "立即升级", type: "upgrade" },
    cardFields: { governance: "企业级治理", sla: "99.9%", dataIsolation: "独立租户" },
  }),
  makePlan({
    id: "ent",
    slot: "enterprise",
    displayName: "卓越版",
    contactSales: true,
    pricing: { monthly: 0 },
    // creditsMonthly intentionally omitted (production view-model contract)
    metrics: {
      seats: "custom",
      aiEmployees: "custom",
      concurrentRuns: "custom",
      creditsMonthly: undefined,
    },
    aiAuthorizationLabel: "按需配置",
    cta: { label: "联系销售", type: "contact" },
    cardFields: { governance: "集团治理", sla: "定制 SLA", dataIsolation: "专属隔离" },
  }),
];

async function buildPageHtml() {
  // Dynamic import after ensuring we're in a DOM-capable environment via playwright only for shots;
  // HTML is built here with lit-html SSR-like stringify is hard — use playwright evaluate with injected module instead.
  // Fallback: inline structural HTML is brittle; better: use jsdom + lit render.
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost/pricing",
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.customElements = dom.window.customElements;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;

  const { render } = await import("lit");
  const { renderPricingPage } = await import(
    pathToFileURL(path.join(repoRoot, "ui/src/ui/views/pricing-v3/pricing-page.ts")).href
  );

  const root = document.getElementById("root");
  render(
    renderPricingPage({
      catalog: {
        plans: FIXTURE_PLANS,
        compareRows: [
          {
            id: "aiEmployees",
            label: "AI 员工",
            values: {
              starter: "25",
              professional: "100",
              business: "500",
              enterprise: "custom",
            },
          },
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
        billingHint: "按席位与 AI 授权计费。",
      },
      selectedCycle: "monthly",
      onSelectCycle: () => {},
      showCta: true,
      publicSurface: false,
      onSelectPlan: () => {},
      onContactSales: () => {},
    }),
    root,
  );

  const cssPath = path.join(repoRoot, "ui/src/styles/pricing-v3.css");
  const publicCssPath = path.join(repoRoot, "ui/src/styles/public-legal-page.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const publicCss = fs.readFileSync(publicCssPath, "utf8");
  // Minimal design tokens so cards look close to control UI
  const tokens = `
    :root {
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --primary: #2563eb;
      --ok: #16a34a;
      --radius-md: 10px;
      --radius-lg: 14px;
      --duration-fast: 120ms;
      --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--text);
      background: #f5f7fb;
    }
    .btn { font: inherit; }
  `;

  // Mount under the real public /pricing wrapper so viewport overrides (if reintroduced)
  // would show up in screenshots the same way production does.
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pricing v3 visual capture</title>
  <style>${tokens}\n${css}\n${publicCss}</style>
</head>
<body>
  <div class="public-legal public-legal--wide">
    <div class="public-legal__pricing-frame">
      ${root.innerHTML}
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("Building pricing page HTML from Lit components…");
  const html = await buildPageHtml();
  const htmlPath = path.join(outDir, "_fixture.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  const browser = await chromium.launch({ headless: true });
  const manifest = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    // Allow layout/fonts/container queries to settle
    await page.waitForTimeout(200);

    // Layout guardrails (same as browser tests)
    const layout = await page.evaluate(() => {
      const root = document.querySelector(".pricing-v3");
      const ent = document.querySelector('[data-plan-id="ent"]');
      const icons = [...document.querySelectorAll(".pricing-v3__card-icon svg")];
      return {
        overflow: root ? root.scrollWidth <= root.clientWidth + 1 : false,
        entCredits: ent?.textContent?.includes("Credits") ?? false,
        iconWidths: icons.map((svg) => svg.getBoundingClientRect().width),
      };
    });
    if (!layout.overflow) {
      console.warn(`⚠ ${vp.name}: root horizontal overflow detected`);
    }
    if (layout.entCredits) {
      console.warn(`⚠ ${vp.name}: enterprise card still shows Credits`);
    }
    if (layout.iconWidths.some((w) => w < 8 || w > 48)) {
      console.warn(`⚠ ${vp.name}: icon size anomaly`, layout.iconWidths);
    }

    const file = path.join(outDir, `pricing-v3-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await page.close();
    const rel = path.relative(repoRoot, file);
    manifest.push({ viewport: vp.name, path: rel, checks: layout });
    console.log(`✓ ${vp.name} → ${rel}`);
  }

  // Wide viewport + narrow host regression (container query must not use viewport width)
  {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    const narrowHtml = html
      .replace(
        "<body>",
        '<body><div class="sim-narrow-host" style="width:900px;max-width:900px;margin:0 auto;overflow:hidden">',
      )
      .replace("</body>", "</div></body>");
    await page.setContent(narrowHtml, { waitUntil: "load" });
    await page.waitForTimeout(200);
    const narrowCheck = await page.evaluate(() => {
      const host = document.querySelector(".sim-narrow-host");
      const grid = document.querySelector(".pricing-v3__grid");
      const cols = grid
        ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length
        : 0;
      return {
        overflow: host ? host.scrollWidth <= host.clientWidth + 1 : false,
        cols,
      };
    });
    const file = path.join(outDir, "pricing-v3-wide-viewport-narrow-900.png");
    await page.screenshot({ path: file, fullPage: true });
    await page.close();
    manifest.push({
      viewport: "1600x1000 host=900",
      path: path.relative(repoRoot, file),
      checks: narrowCheck,
    });
    console.log(
      `✓ wide+narrow900 → ${path.relative(repoRoot, file)} (cols=${narrowCheck.cols}, overflowOk=${narrowCheck.overflow})`,
    );
    if (narrowCheck.cols > 3) {
      console.warn("⚠ narrow host still has >3 columns — container query may be broken");
    }
  }

  await browser.close();

  const indexPath = path.join(outDir, "README.md");
  fs.writeFileSync(
    indexPath,
    [
      "# Pricing v3 viewport shots",
      "",
      "Generated by `scripts/pricing-v3-viewport-shots.mjs` from real `renderPricingPage` + `pricing-v3.css` (fixture catalog aligned with production view-model).",
      "",
      "Also captures **wide viewport + 900px host** to prove container-query grid (not viewport media).",
      "",
      "| Viewport | File |",
      "|----------|------|",
      ...manifest.map((m) => `| ${m.viewport} | \`${m.path}\` |`),
      "",
      "## What to check",
      "",
      "- Icons render as stroked Lucide marks (not empty white blocks)",
      "- Compare-table check icons are small (~1rem), not huge black triangles",
      "- Enterprise (卓越版) has **no** Credits row",
      "- CTA buttons share a baseline across cards in the same row",
      "- Cycle switcher does not overflow",
      "- Wide viewport + narrow host: no horizontal overflow, ≤3 columns",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`\nManifest: ${path.relative(repoRoot, indexPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
