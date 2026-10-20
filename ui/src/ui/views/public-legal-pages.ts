import { html, nothing } from "lit";
import { t, type Locale } from "../../i18n/index.ts";
import { resolveBundledBrandWordmarkSrc } from "../brand-assets.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { renderPublicPricingSurface } from "./pricing-v3/public-pricing-surface.ts";
import {
  getPublicFeaturesDocument,
  type FeaturesSection,
  type FeaturesSubsection,
} from "./public-features-document.ts";
import {
  getPublicHelpDocument,
  getPublicHelpGuideDocument,
  resolvePublicHelpTarget,
} from "./public-help-document.ts";
import { getWorkbenchHelpDocument } from "./public-help-workbench-document.ts";
import {
  navigateToPublicRoute,
  renderPublicLegalFooter,
  renderPublicLegalHeader,
  resolvePublicLegalPaths,
  type PublicContentNavActive,
} from "./public-legal-nav.ts";
import { getPublicPartnerEcosystemDocument } from "./public-partner-ecosystem-document.ts";
import { getPublicPrivacyDocument, type PrivacySection } from "./public-privacy-document.ts";
import { getPublicSkillsMcpDocument } from "./public-skills-mcp-document.ts";

function renderDocTable(table: NonNullable<PrivacySection["table"]>) {
  return html`
    <div class="public-legal__table-wrap">
      <table class="public-legal__table">
        <thead>
          <tr>
            ${table.headers.map((header) => html`<th scope="col">${header}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${table.rows.map(
            (row) => html`
              <tr>
                ${row.map((cell) => html`<td>${cell}</td>`)}
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function renderFeaturesAssetCards(cards: NonNullable<FeaturesSubsection["assetCards"]>) {
  return html`
    <div class="public-legal__asset-grid">
      ${cards.map(
        (card) => html`
          <article class="public-legal__asset-card" id=${card.id}>
            <h4 class="public-legal__asset-title">${card.title}</h4>
            <p class="public-legal__asset-subtitle">${card.subtitle}</p>
            <ul class="public-legal__list public-legal__list--compact">
              ${card.bullets.map((item) => html`<li>${item}</li>`)}
            </ul>
          </article>
        `,
      )}
    </div>
  `;
}

function renderFeaturesSubsection(subsection: FeaturesSubsection) {
  return html`
    <div class="public-legal__subsection" id=${subsection.id ?? nothing}>
      <h3>${subsection.title}</h3>
      ${subsection.paragraphs?.map((paragraph) => html`<p>${paragraph}</p>`) ?? nothing}
      ${
        subsection.bullets && subsection.bullets.length > 0
          ? html`
              <ul class="public-legal__list">
                ${subsection.bullets.map((item) => html`<li>${item}</li>`)}
              </ul>
            `
          : nothing
      }
      ${subsection.assetCards ? renderFeaturesAssetCards(subsection.assetCards) : nothing}
    </div>
  `;
}

function renderFeaturesSection(section: FeaturesSection) {
  return html`
    <section class="public-legal__section public-legal__section--feature" id=${section.id}>
      <h2>${section.title}</h2>
      ${section.tagline ? html`<p class="public-legal__section-tagline">${section.tagline}</p>` : nothing}
      ${section.paragraphs?.map((paragraph) => html`<p>${paragraph}</p>`) ?? nothing}
      ${
        section.bullets && section.bullets.length > 0
          ? html`
            <ul class="public-legal__list">
              ${section.bullets.map((item) => html`<li>${item}</li>`)}
            </ul>
          `
          : nothing
      }
      ${section.subsections?.map((subsection) => renderFeaturesSubsection(subsection)) ?? nothing}
      ${
        section.valueTitle && section.valueText
          ? html`
              <div class="public-legal__value-box">
                <p class="public-legal__value-label">${section.valueTitle}</p>
                <p class="public-legal__value-text">${section.valueText}</p>
              </div>
            `
          : nothing
      }
    </section>
  `;
}

function renderDocSection(section: PrivacySection) {
  return html`
    <section class="public-legal__section" id=${section.id}>
      <h2>${section.title}</h2>
      ${section.paragraphs.map((paragraph) => html`<p>${paragraph}</p>`)}
      ${section.table ? renderDocTable(section.table) : nothing}
      ${
        section.bullets && section.bullets.length > 0
          ? html`
              <ul class="public-legal__list">
                ${section.bullets.map((item) => html`<li>${item}</li>`)}
              </ul>
            `
          : nothing
      }
    </section>
  `;
}

type LegalPageParams = {
  brandLogoSrc?: string | null;
  basePath?: string;
  currentLocale: Locale;
  onLocaleChange: (locale: Locale) => void;
};

function renderLegalPageShell(
  params: LegalPageParams & {
    active: PublicContentNavActive;
    body: unknown;
    wide?: boolean;
  },
) {
  const logoSrc = params.brandLogoSrc || resolveBundledBrandWordmarkSrc(params.basePath ?? "");
  const {
    homeHref,
    featuresHref,
    pricingHref,
    skillMcpHref,
    partnerEcosystemHref,
    privacyHref,
    helpHref,
  } = resolvePublicLegalPaths(params.basePath ?? "");

  return html`
    <div class="public-legal ${params.wide ? "public-legal--wide" : ""}">
      ${renderPublicLegalHeader({
        logoSrc,
        homeHref,
        featuresHref,
        pricingHref,
        skillMcpHref,
        partnerEcosystemHref,
        privacyHref,
        helpHref,
        currentLocale: params.currentLocale,
        active: params.active,
        onLocaleChange: params.onLocaleChange,
      })}
      <main class="public-legal__main ${params.wide ? "public-legal__main--wide" : ""}">
        ${params.body}
      </main>
      ${renderPublicLegalFooter({ privacyHref, helpHref })}
    </div>
  `;
}

export function renderPublicFeaturesPage(params: LegalPageParams) {
  const doc = getPublicFeaturesDocument(params.currentLocale);

  return renderLegalPageShell({
    ...params,
    active: "features",
    wide: true,
    body: html`
      <article class="public-legal__article public-legal__article--features">
        <header class="public-legal__article-head">
          <p class="public-legal__kicker">${doc.kicker}</p>
          <h1>${doc.title}</h1>
          <p class="public-legal__lead">${doc.subtitle}</p>
        </header>
        <div class="public-legal__body">
          ${doc.intro.map((paragraph) => html`<p class="public-legal__intro">${paragraph}</p>`)}
          ${doc.sections.map((section) => renderFeaturesSection(section))}
          <section class="public-legal__section" id="summary">
            <h2>${doc.summaryTitle}</h2>
            ${renderDocTable(doc.summaryTable)}
          </section>
          <p class="public-legal__closing">${doc.closing}</p>
        </div>
      </article>
    `,
  });
}

export function renderPublicSkillsMcpPage(params: LegalPageParams) {
  const doc = getPublicSkillsMcpDocument(params.currentLocale);

  return renderLegalPageShell({
    ...params,
    active: "skillMcp",
    wide: true,
    body: html`
      <article class="public-legal__article public-legal__article--features">
        <header class="public-legal__article-head">
          <p class="public-legal__kicker">${doc.kicker}</p>
          <h1>${doc.title}</h1>
          <p class="public-legal__lead">${doc.subtitle}</p>
        </header>
        <div class="public-legal__body">
          ${doc.intro.map((paragraph) => html`<p class="public-legal__intro">${paragraph}</p>`)}
          ${doc.sections.map((section) => renderFeaturesSection(section))}
          <section class="public-legal__section" id="summary">
            <h2>${doc.summaryTitle}</h2>
            ${renderDocTable(doc.summaryTable)}
          </section>
          <p class="public-legal__closing">${doc.closing}</p>
        </div>
      </article>
    `,
  });
}

export function renderPublicPartnerEcosystemPage(params: LegalPageParams) {
  const doc = getPublicPartnerEcosystemDocument(params.currentLocale);

  return renderLegalPageShell({
    ...params,
    active: "partnerEcosystem",
    wide: true,
    body: html`
      <article class="public-legal__article public-legal__article--features">
        <header class="public-legal__article-head">
          <p class="public-legal__kicker">${doc.kicker}</p>
          <h1>${doc.title}</h1>
          <p class="public-legal__lead">${doc.subtitle}</p>
        </header>
        <div class="public-legal__body">
          ${doc.intro.map((paragraph) => html`<p class="public-legal__intro">${paragraph}</p>`)}
          ${doc.sections.map((section) => renderFeaturesSection(section))}
          <section class="public-legal__section" id="summary">
            <h2>${doc.summaryTitle}</h2>
            ${renderDocTable(doc.summaryTable)}
          </section>
          <p class="public-legal__closing">${doc.closing}</p>
        </div>
      </article>
    `,
  });
}

export function renderPublicPrivacyPage(params: LegalPageParams) {
  const doc = getPublicPrivacyDocument(params.currentLocale);

  return renderLegalPageShell({
    ...params,
    active: "privacy",
    body: html`
      <article class="public-legal__article">
        <header class="public-legal__article-head">
          <p class="public-legal__kicker">${doc.kicker}</p>
          <h1>${doc.title}</h1>
          <p class="public-legal__lead">${doc.subtitle}</p>
          <p class="public-legal__meta">${doc.updated}</p>
        </header>
        <div class="public-legal__body">
          ${doc.sections.map((section) => renderDocSection(section))}
          <section class="public-legal__section" id="contact">
            <h2>${doc.contactTitle}</h2>
            <p>
              <a class="public-legal__mailto" href="mailto:${doc.contactEmail}">${doc.contactEmail}</a>
            </p>
          </section>
        </div>
      </article>
    `,
  });
}

function renderGuideCards(
  guides: Array<{ href: string; slug: string; label: string; summary: string }>,
) {
  return html`
    <div class="public-legal__guide-grid">
      ${guides.map(
        (guide) => html`
          <a
            class="public-legal__guide-card"
            href=${guide.href}
            data-guide-slug=${guide.slug}
            @click=${(event: MouseEvent) => navigateToPublicRoute(event, guide.href)}
          >
            <span class="public-legal__guide-title">${guide.label}</span>
            <span class="public-legal__guide-summary">${guide.summary}</span>
          </a>
        `,
      )}
    </div>
  `;
}

export function renderPublicHelpPage(params: LegalPageParams) {
  const basePath = params.basePath ?? "";
  const paths = resolvePublicLegalPaths(basePath);
  const target =
    typeof window !== "undefined"
      ? resolvePublicHelpTarget(window.location.pathname, basePath)
      : null;

  if (target?.kind === "im") {
    const guide = getPublicHelpGuideDocument(params.currentLocale, target.slug);
    return renderLegalPageShell({
      ...params,
      active: "help",
      body: html`
        <article
          class="public-legal__article"
          data-testid="public-help-guide"
          data-guide-slug=${guide.slug}
        >
          <header class="public-legal__article-head">
            <p class="public-legal__kicker">${guide.kicker}</p>
            <p class="public-legal__meta">
              <a
                class="public-legal__mailto"
                href=${paths.helpHref}
                @click=${(event: MouseEvent) => navigateToPublicRoute(event, paths.helpHref)}
                >${guide.backLabel}</a
              >
            </p>
            <h1>${guide.title}</h1>
            <p class="public-legal__lead">${guide.subtitle}</p>
          </header>
          <div class="public-legal__body">
            ${guide.sections.map((section) => renderDocSection(section))}
          </div>
        </article>
      `,
    });
  }

  if (target?.kind === "workbench") {
    const guide = getWorkbenchHelpDocument(params.currentLocale, target.page, basePath);
    return renderLegalPageShell({
      ...params,
      active: "help",
      body: html`
        <article
          class="public-legal__article"
          data-testid="public-help-workbench"
          data-page=${guide.page}
        >
          <header class="public-legal__article-head">
            <p class="public-legal__kicker">${guide.kicker}</p>
            <p class="public-legal__meta">
              <a
                class="public-legal__mailto"
                href=${paths.helpHref}
                @click=${(event: MouseEvent) => navigateToPublicRoute(event, paths.helpHref)}
                >${guide.backLabel}</a
              >
              ${
                guide.mapHref && guide.mapLabel
                  ? html`
                      <span class="public-legal__footer-sep" aria-hidden="true">·</span>
                      <a
                        class="public-legal__mailto"
                        href=${guide.mapHref}
                        data-testid="public-help-workbench-map"
                        @click=${(event: MouseEvent) =>
                          navigateToPublicRoute(event, guide.mapHref ?? paths.helpHref)}
                        >${guide.mapLabel}</a
                      >
                    `
                  : nothing
              }
            </p>
            <h1>${guide.title}</h1>
            <p class="public-legal__lead">${guide.subtitle}</p>
          </header>
          <div class="public-legal__body">
            ${
              guide.childLinks && guide.childLinks.length > 0
                ? html`
                    <section class="public-legal__section public-legal__section--guides">
                      ${renderGuideCards(guide.childLinks)}
                    </section>
                  `
                : nothing
            }
            ${guide.sections.map((section) => renderDocSection(section))}
          </div>
        </article>
      `,
    });
  }

  const doc = getPublicHelpDocument(params.currentLocale, basePath);

  return renderLegalPageShell({
    ...params,
    active: "help",
    body: html`
      <article class="public-legal__article">
        <header class="public-legal__article-head">
          <p class="public-legal__kicker">${doc.kicker}</p>
          <h1>${doc.title}</h1>
          <p class="public-legal__lead">${doc.subtitle}</p>
        </header>
        <div class="public-legal__body">
          ${doc.intro.map((paragraph) => html`<p>${paragraph}</p>`)}
          <section
            class="public-legal__section public-legal__section--guides"
            id="workbench-guides"
            data-testid="public-help-workbench-guides"
          >
            <h2>${doc.workbenchGuidesTitle}</h2>
            <p class="public-legal__guides-intro">${doc.workbenchGuidesIntro}</p>
            ${renderGuideCards(doc.workbenchGuides)}
          </section>
          <section
            class="public-legal__section public-legal__section--guides"
            id="enterprise-im-guides"
            data-testid="public-help-enterprise-im-guides"
          >
            <h2>${doc.guidesTitle}</h2>
            <p class="public-legal__guides-intro">${doc.guidesIntro}</p>
            ${renderGuideCards(doc.guides)}
          </section>
          <section class="public-legal__section" id="faq">
            <h2>${doc.faqTitle}</h2>
            <dl class="public-legal__faq">
              ${doc.faq.map(
                (item) => html`
                  <div class="public-legal__faq-item">
                    <dt>${item.question}</dt>
                    <dd>${item.answer}</dd>
                  </div>
                `,
              )}
            </dl>
          </section>
          <section class="public-legal__section" id="contact">
            <h2>${doc.contactTitle}</h2>
            <p>${doc.contactIntro}</p>
            <p>
              <a class="public-legal__mailto" href="mailto:${doc.contactEmail}">${doc.contactEmail}</a>
            </p>
          </section>
        </div>
      </article>
    `,
  });
}

export function renderPublicPricingPage(
  params: LegalPageParams & { client?: GatewayBrowserClient | null },
) {
  return renderLegalPageShell({
    ...params,
    active: "pricing",
    wide: true,
    body: html`
      <article class="public-legal__article public-legal__article--pricing">
        <header class="public-legal__article-head">
          <p class="public-legal__kicker">${t("authHome.pricingPage.kicker")}</p>
          <h1>${t("authHome.pricingPage.title")}</h1>
          <p class="public-legal__lead">${t("authHome.pricingPage.subtitle")}</p>
        </header>
        <div class="public-legal__pricing-frame">${renderPublicPricingSurface(params.client ?? null)}</div>
      </article>
    `,
  });
}
