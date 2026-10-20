import type { TemplateResult } from "lit";
import {
  createPlatformPricingCatalogGateway,
  type PricingCatalogViewModel,
} from "../../capability/platform-pricing-catalog/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { inferBasePathFromPathname, pathForTab } from "../../navigation.ts";
import {
  createGatewayLoadRetry,
  isTransientGatewayError,
  type GatewayLoadRetryController,
} from "../../ports/platform/pricing/gateway-load-retry.ts";
import type { BillingCycle } from "../../ports/platform/pricing/pricing-cycle.ts";
import { requestOpenBotAppRerender } from "../../request-app-rerender.ts";
import { renderPricingPage } from "./pricing-page.ts";

/** Resolve CTA href with deployment basePath (e.g. /ui). Exported for unit tests. */
export function resolvePublicPricingCtaHref(
  tab: "trialApply" | "enterpriseLogin",
  pathname?: string,
): string {
  const path = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const basePath = inferBasePathFromPathname(path) || "";
  return pathForTab(tab, basePath);
}

function navigatePublicTab(tab: "trialApply" | "enterpriseLogin"): void {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign(resolvePublicPricingCtaHref(tab));
}

let catalog: PricingCatalogViewModel | null = null;
let loading = false;
let error: string | null = null;
let selectedCycle: BillingCycle = "monthly";
let requestedClient: GatewayBrowserClient | null = null;
let loadInFlight: Promise<void> | null = null;
let loadRetry: GatewayLoadRetryController | null = null;

function rerender() {
  requestOpenBotAppRerender();
}

function cancelLoadRetry(): void {
  loadRetry?.cancel();
  loadRetry = null;
}

export function setPublicPricingCycle(cycle: BillingCycle): void {
  selectedCycle = cycle;
  rerender();
}

async function loadCatalog(client: GatewayBrowserClient): Promise<void> {
  if (loadInFlight) {
    return loadInFlight;
  }
  if (!client.connected) {
    loading = true;
    error = null;
    queueMicrotask(rerender);
    return;
  }
  loading = true;
  error = null;
  // `ensurePublicPricingCatalog()` is invoked synchronously inside Lit `render()`.
  // Calling `rerender()` (host.requestUpdate) synchronously here re-enters the
  // render pass; defer the "loading" repaint to a microtask.
  queueMicrotask(rerender);
  loadInFlight = (async () => {
    try {
      catalog = await createPlatformPricingCatalogGateway(client).catalog();
      cancelLoadRetry();
    } catch (err) {
      if (isTransientGatewayError(err)) {
        catalog = null;
        error = null;
        requestedClient = null;
        if (!loadRetry) {
          loadRetry = createGatewayLoadRetry(
            () => {
              if (client.connected) {
                void loadCatalog(client);
              }
            },
            {
              onExhausted: () => {
                error = "套餐加载失败，请刷新页面后重试";
                loading = false;
                rerender();
              },
            },
          );
        }
        return;
      }
      cancelLoadRetry();
      error = err instanceof Error ? err.message : "加载套餐失败";
      catalog = null;
    } finally {
      if (!loadRetry) {
        loading = false;
      }
      loadInFlight = null;
      rerender();
    }
  })();
  return loadInFlight;
}

export function ensurePublicPricingCatalog(client: GatewayBrowserClient | null): void {
  if (!client) {
    loading = false;
    return;
  }
  if (requestedClient === client && (catalog || loadInFlight || loadRetry)) {
    return;
  }
  if (requestedClient === client && error) {
    return;
  }
  requestedClient = client;
  void loadCatalog(client);
}

/** Gateway hello / reconnect 后刷新公共定价页套餐数据。 */
export function refreshPublicPricingAfterGatewayConnect(client: GatewayBrowserClient | null): void {
  if (!client?.connected) {
    return;
  }
  cancelLoadRetry();
  requestedClient = null;
  error = null;
  void loadCatalog(client);
}

export function renderPublicPricingSurface(client: GatewayBrowserClient | null): TemplateResult {
  ensurePublicPricingCatalog(client);
  const waitingForGateway = Boolean(client && !client.connected && !catalog && !error);
  const showLoading = loading || waitingForGateway || Boolean(loadRetry);
  return renderPricingPage({
    catalog,
    loading: showLoading,
    error: showLoading ? null : error,
    selectedCycle,
    onSelectCycle: setPublicPricingCycle,
    // Public catalog: show purchase CTAs (trial / upgrade / contact sales).
    // Not an admin editor surface — do not use readOnly to hide CTAs.
    showCta: true,
    publicSurface: true,
    onSelectPlan: (plan) => {
      // Deep-link via pathForTab so /ui (and other basePath) deployments stay correct.
      if (plan.freeTrial || plan.cta.type === "trial") {
        navigatePublicTab("trialApply");
        return;
      }
      navigatePublicTab("enterpriseLogin");
    },
    onContactSales: () => {
      navigatePublicTab("enterpriseLogin");
    },
  });
}

export function __resetPublicPricingSurfaceForTest(): void {
  cancelLoadRetry();
  catalog = null;
  loading = false;
  error = null;
  selectedCycle = "monthly";
  requestedClient = null;
  loadInFlight = null;
}
