import { html, nothing } from "lit";
import { t, type Locale } from "../../i18n/index.ts";
import { pathForTab } from "../navigation.ts";
import { resolveEmployeePublicHomeHref } from "../public-home.ts";

export type PublicContentNavActive =
  | "features"
  | "pricing"
  | "skillMcp"
  | "partnerEcosystem"
  | "privacy"
  | "help";

export function navigateToPublicRoute(event: MouseEvent, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  if (href.includes("#")) {
    return;
  }
  event.preventDefault();
  if (typeof window === "undefined") {
    return;
  }
  try {
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.toString());
      return;
    }
    window.history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
  } catch {
    window.history.pushState({}, "", href);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function nextLocale(locale: Locale): Locale {
  return locale === "zh-CN" ? "en" : "zh-CN";
}

function localeBadge(locale: Locale) {
  return locale === "zh-CN" ? "中" : "EN";
}

export function resolvePublicLegalPaths(basePath = "") {
  const host = typeof window === "undefined" ? "" : window.location.host;
  const homeHref = resolveEmployeePublicHomeHref(host, basePath);
  return {
    homeHref,
    featuresHref: pathForTab("features", basePath),
    pricingHref: pathForTab("pricing", basePath),
    skillMcpHref: pathForTab("skillMcp", basePath),
    partnerEcosystemHref: pathForTab("partnerEcosystem", basePath),
    privacyHref: pathForTab("privacy", basePath),
    helpHref: pathForTab("help", basePath),
  };
}

export function renderPublicLegalHeader(params: {
  logoSrc: string;
  homeHref: string;
  featuresHref: string;
  pricingHref: string;
  skillMcpHref: string;
  partnerEcosystemHref: string;
  privacyHref: string;
  helpHref: string;
  currentLocale: Locale;
  active: PublicContentNavActive | null;
  onLocaleChange: (locale: Locale) => void;
}) {
  const navLink = (href: string, label: string, active: boolean, spa = true) => html`
    <a
      class="public-legal__nav-link ${active ? "is-active" : ""}"
      href=${href}
      aria-current=${active ? "page" : nothing}
      @click=${(event: MouseEvent) => {
        if (spa) {
          navigateToPublicRoute(event, href);
        }
      }}
      >${label}</a
    >
  `;

  return html`
    <header class="public-legal__header">
      <div class="public-legal__header-inner">
        <a
          class="public-legal__brand"
          href=${params.homeHref}
          aria-label="OpenBot"
          @click=${(event: MouseEvent) => navigateToPublicRoute(event, params.homeHref)}
        >
          <img class="public-legal__brand-logo" src=${params.logoSrc} alt="OpenBot" />
        </a>
        <nav class="public-legal__nav" aria-label="OpenBot">
          ${navLink(params.homeHref, t("authHome.nav.enterpriseCreate"), false)}
          <span class="public-legal__nav-group-label">${t("authHome.nav.product.title")}</span>
          ${navLink(
            params.featuresHref,
            t("authHome.nav.product.features"),
            params.active === "features",
          )}
          ${navLink(
            params.pricingHref,
            t("authHome.nav.product.pricing"),
            params.active === "pricing",
          )}
          <span class="public-legal__nav-group-label">${t("authHome.nav.resources.title")}</span>
          ${navLink(
            params.skillMcpHref,
            t("authHome.nav.resources.skillMcp"),
            params.active === "skillMcp",
          )}
          ${navLink(
            params.partnerEcosystemHref,
            t("authHome.nav.resources.partnerEcosystem"),
            params.active === "partnerEcosystem",
          )}
          <span class="public-legal__nav-group-label">${t("authHome.nav.legal.title")}</span>
          ${navLink(
            params.privacyHref,
            t("authHome.nav.legal.privacySecurity"),
            params.active === "privacy",
          )}
          ${navLink(params.helpHref, t("authHome.nav.legal.help"), params.active === "help")}
        </nav>
        <button
          class="public-legal__locale"
          type="button"
          @click=${() => params.onLocaleChange(nextLocale(params.currentLocale))}
          aria-label=${t("common.language")}
          title=${t("common.language")}
        >
          ${localeBadge(params.currentLocale)}
        </button>
      </div>
    </header>
  `;
}

export function renderPublicLegalFooter(params: { privacyHref: string; helpHref: string }) {
  return html`
    <footer class="public-legal__footer">
      <nav class="public-legal__footer-links" aria-label=${t("authHome.nav.legal.title")}>
        <a
          class="public-legal__footer-link"
          href=${params.privacyHref}
          @click=${(event: MouseEvent) => navigateToPublicRoute(event, params.privacyHref)}
        >
          ${t("authHome.nav.legal.privacySecurity")}
        </a>
        <span class="public-legal__footer-sep" aria-hidden="true">·</span>
        <a
          class="public-legal__footer-link"
          href=${params.helpHref}
          @click=${(event: MouseEvent) => navigateToPublicRoute(event, params.helpHref)}
        >
          ${t("authHome.nav.legal.help")}
        </a>
      </nav>
      <div class="public-legal__footer-meta">${t("authHome.footer.copyright")}</div>
    </footer>
  `;
}
