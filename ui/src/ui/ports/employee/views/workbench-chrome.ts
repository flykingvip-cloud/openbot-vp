import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../../../icons.ts";
import type { GrowthStatusView } from "../semantic/view-controller-facade.ts";
import { formatWorkbenchSidebarDisplayName } from "./workbench-display-name.ts";
import { renderGrowthBadge } from "./workbench-growth-badge.ts";
import type { WorkbenchNavIconKey, WorkbenchNavTone } from "./workbench-nav-model.ts";

const FLOATING_NAV_TOOLTIP_ID = "employee-workbench-nav-tooltip-floating";

export type WorkbenchNavItemRenderProps = {
  title: string;
  rawTitle?: string;
  subtitle?: string;
  iconKey?: WorkbenchNavIconKey;
  tone?: WorkbenchNavTone;
  active?: boolean;
  count?: number | null;
  growthStatus?: GrowthStatusView | null;
  onClick: () => void;
};

export type WorkbenchModuleItemRenderProps = {
  title: string;
  iconKey?: WorkbenchNavIconKey;
  tone?: WorkbenchNavTone;
  active?: boolean;
  onClick: () => void;
};

export type WorkbenchSidebarGroupHeaderProps = {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: (() => void) | null;
};

export type WorkbenchBrandRenderProps = {
  brandLogoSrc?: string | null;
  bundledBrandLogoSrc?: string | null;
  customBrandLogoEnabled?: boolean;
  brandLogoError?: string | null;
  uploadLabel: string;
  resetLabel: string;
  logoAlt: string;
  defaultTitle: string;
  defaultSubtitle: string;
  onBrandLogoFileChange?: ((file: File | null) => void | Promise<void>) | null;
  onResetBrandLogo?: (() => void) | null;
  actionSlot?: TemplateResult | null;
};

function getFloatingNavTooltip() {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = document.getElementById(FLOATING_NAV_TOOLTIP_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }
  const tooltip = document.createElement("div");
  tooltip.id = FLOATING_NAV_TOOLTIP_ID;
  tooltip.className = "employee-workbench__nav-tooltip-floating";
  document.body.append(tooltip);
  return tooltip;
}

function showFloatingNavTooltip(target: EventTarget | null, title: string) {
  const button = target instanceof HTMLElement ? target : null;
  if (!button?.closest(".employee-workbench.collapsed")) {
    return;
  }
  const tooltip = getFloatingNavTooltip();
  if (!tooltip) {
    return;
  }
  const rect = button.getBoundingClientRect();
  tooltip.textContent = title;
  tooltip.dataset.navTone = button.dataset.navTone?.trim() || "violet";
  tooltip.dataset.active = button.classList.contains("active") ? "true" : "false";
  tooltip.style.left = `${rect.right + 10}px`;
  tooltip.style.top = `${rect.top + rect.height / 2}px`;
  tooltip.classList.add("visible");
}

function hideFloatingNavTooltip() {
  const tooltip = getFloatingNavTooltip();
  tooltip?.classList.remove("visible");
}

function resolveNavIcon(iconKey: WorkbenchNavIconKey = "clipboardCheck"): TemplateResult {
  if (iconKey === "mic") {
    return html`
      <svg viewBox="0 0 24 24">
        <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
        <path d="M19 10a7 7 0 0 1-14 0" />
        <path d="M12 17v4" />
        <path d="M8 21h8" />
      </svg>
    `;
  }
  if (iconKey === "sparkles") {
    return icons.sparkles;
  }
  if (iconKey === "brain") {
    return icons.brain;
  }
  if (iconKey === "messageSquare") {
    return icons.messageSquare;
  }
  if (iconKey === "zap") {
    return icons.zap;
  }
  if (iconKey === "star") {
    return icons.star;
  }
  if (iconKey === "radio") {
    return icons.radio;
  }
  if (iconKey === "users") {
    return icons.users;
  }
  if (iconKey === "messagesSquare") {
    return icons.messagesSquare;
  }
  if (iconKey === "calendar") {
    return icons.calendar;
  }
  if (iconKey === "book") {
    return icons.book;
  }
  if (iconKey === "settings") {
    return icons.settings;
  }
  return icons.clipboardCheck;
}

export function renderBrandMark() {
  return html`
    <svg viewBox="0 0 96 96" class="employee-workbench__brand-mark-svg" aria-hidden="true">
      <defs>
        <radialGradient id="employee-workbench-brand-core" cx="50%" cy="36%" r="62%">
          <stop offset="0%" stop-color="#fff5cf" />
          <stop offset="38%" stop-color="#fbbf24" />
          <stop offset="72%" stop-color="#b45309" />
          <stop offset="100%" stop-color="#6b2c07" />
        </radialGradient>
        <linearGradient id="employee-workbench-brand-shell" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#ffe9bb" />
          <stop offset="42%" stop-color="#f59e0b" />
          <stop offset="100%" stop-color="#7c2d12" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="44" r="28" fill="url(#employee-workbench-brand-core)" opacity="0.94" />
      <path
        d="M48 10 65 18l8 18-4 28-21 18-21-18-4-28 8-18Z"
        fill="url(#employee-workbench-brand-shell)"
        stroke="#4a1d0b"
        stroke-width="2.4"
        stroke-linejoin="round"
      />
      <path
        d="M34 35c4-8 10-12 14-12s10 4 14 12v15c0 8-6 14-14 14s-14-6-14-14Z"
        fill="#2b170d"
        opacity="0.88"
      />
      <path d="M35 45h26" stroke="#ffdd74" stroke-width="2.4" stroke-linecap="round" opacity="0.8" />
      <path d="M30 30 22 46l6 16" stroke="#b45309" stroke-width="2.8" stroke-linecap="round" />
      <path d="M66 30 74 46l-6 16" stroke="#b45309" stroke-width="2.8" stroke-linecap="round" />
      <circle cx="41" cy="42" r="5" fill="#fef3c7" />
      <circle cx="55" cy="42" r="5" fill="#fef3c7" />
      <path d="M40 54c5 4 11 4 16 0" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />
      <path d="M38 24h20" stroke="#fef3c7" stroke-width="3.2" stroke-linecap="round" opacity="0.92" />
    </svg>
  `;
}

function hideBrokenBrandLogo(event: Event) {
  const img = event.currentTarget;
  if (!(img instanceof HTMLImageElement)) {
    return;
  }
  img.hidden = true;
  const frame = img.closest(".employee-workbench__brand-logo-frame");
  if (frame instanceof HTMLElement) {
    frame.hidden = true;
  }
  const siblingHost = frame instanceof HTMLElement ? frame : img;
  const fallback = siblingHost.parentElement?.querySelector(
    ":scope > .employee-workbench__brand-fallback",
  );
  if (fallback instanceof HTMLElement) {
    fallback.hidden = false;
  }
}

function renderBrandFallback(defaultTitle: string) {
  return html`
    <div class="employee-workbench__brand-fallback" hidden>
      <div class="employee-workbench__brand-mark">${renderBrandMark()}</div>
      <div class="employee-workbench__brand-copy">
        <div class="employee-workbench__brand-title">${defaultTitle}</div>
      </div>
    </div>
  `;
}

export function renderWorkbenchBrand(props: WorkbenchBrandRenderProps) {
  const brandActions = [
    props.customBrandLogoEnabled && props.onResetBrandLogo
      ? html`
        <button
          type="button"
          class="btn btn--sm btn--icon employee-workbench__icon-btn employee-workbench__brand-action"
          aria-label=${props.resetLabel}
          title=${props.resetLabel}
          @click=${props.onResetBrandLogo}
        >
          ${icons.refreshCw}
        </button>
      `
      : nothing,
    props.actionSlot ?? nothing,
  ].filter((value) => value !== nothing);

  return html`
    <div class="employee-workbench__brand">
      <div class="employee-workbench__brand-slot ${props.customBrandLogoEnabled ? "is-custom" : ""}">
        <div class="employee-workbench__brand-main">
          ${
            props.customBrandLogoEnabled && props.brandLogoSrc
              ? html`
                <div class="employee-workbench__brand-logo-frame">
                  <img
                    class="employee-workbench__brand-logo"
                    src=${props.brandLogoSrc}
                    alt=${props.logoAlt}
                    @error=${hideBrokenBrandLogo}
                  />
                </div>
                ${renderBrandFallback(props.defaultTitle)}
              `
              : props.bundledBrandLogoSrc
                ? html`
                  <img
                    class="employee-workbench__brand-logo employee-workbench__brand-logo--bundled"
                    src=${props.bundledBrandLogoSrc}
                    alt=${props.logoAlt}
                    @error=${hideBrokenBrandLogo}
                  />
                  ${renderBrandFallback(props.defaultTitle)}
                `
                : html`
                <div class="employee-workbench__brand-mark">${renderBrandMark()}</div>
                <div class="employee-workbench__brand-copy">
                  <div class="employee-workbench__brand-title">${props.defaultTitle}</div>
                </div>
              `
          }
        </div>
        ${
          brandActions.length > 0
            ? html`<div class="employee-workbench__brand-actions">${brandActions}</div>`
            : nothing
        }
      </div>
      ${
        props.brandLogoError
          ? html`<div class="employee-workbench__brand-feedback is-error">${props.brandLogoError}</div>`
          : nothing
      }
    </div>
  `;
}

export function renderNavItem(props: WorkbenchNavItemRenderProps) {
  const fullTitle = props.rawTitle?.trim() || props.title;
  const displayTitle = formatWorkbenchSidebarDisplayName(fullTitle, "未命名");

  return html`
    <button
      type="button"
      class="employee-workbench__nav-item ${props.active ? "active" : ""}"
      data-nav-title=${displayTitle}
      data-nav-tone=${props.tone ?? "violet"}
      aria-label=${fullTitle}
      @mouseenter=${(event: Event) => showFloatingNavTooltip(event.currentTarget, displayTitle)}
      @mouseleave=${() => hideFloatingNavTooltip()}
      @focus=${(event: Event) => showFloatingNavTooltip(event.currentTarget, displayTitle)}
      @blur=${() => hideFloatingNavTooltip()}
      @click=${() => {
        hideFloatingNavTooltip();
        props.onClick();
      }}
    >
      <span class="employee-workbench__nav-icon tone-${props.tone ?? "violet"}">
        ${resolveNavIcon(props.iconKey)}
      </span>
      <span class="employee-workbench__nav-copy">
        <span class="employee-workbench__nav-title-row">
          <span class="employee-workbench__nav-title">${displayTitle}</span>
          ${renderGrowthBadge(props.growthStatus ?? null)}
        </span>
        ${
          props.subtitle
            ? html`<span class="employee-workbench__nav-subtitle">${props.subtitle}</span>`
            : nothing
        }
      </span>
      <span class="employee-workbench__nav-sr">${fullTitle}</span>
      ${
        props.count && props.count > 0
          ? html`<span class="employee-workbench__nav-badge">${Math.min(props.count, 9)}</span>`
          : nothing
      }
    </button>
  `;
}

export function renderModuleItem(props: WorkbenchModuleItemRenderProps) {
  const displayTitle = formatWorkbenchSidebarDisplayName(props.title, "未命名");

  return html`
    <button
      type="button"
      class="employee-workbench__module-item ${props.active ? "active" : ""}"
      data-nav-title=${displayTitle}
      data-nav-tone=${props.tone ?? "blue"}
      aria-label=${props.title}
      @mouseenter=${(event: Event) => showFloatingNavTooltip(event.currentTarget, displayTitle)}
      @mouseleave=${() => hideFloatingNavTooltip()}
      @focus=${(event: Event) => showFloatingNavTooltip(event.currentTarget, displayTitle)}
      @blur=${() => hideFloatingNavTooltip()}
      @click=${() => {
        hideFloatingNavTooltip();
        props.onClick();
      }}
    >
      <span class="employee-workbench__module-icon tone-${props.tone ?? "blue"}">
        ${resolveNavIcon(props.iconKey ?? "clipboardCheck")}
      </span>
      <span class="employee-workbench__module-copy">${props.title}</span>
    </button>
  `;
}

export function renderSidebarGroupHeader(props: WorkbenchSidebarGroupHeaderProps) {
  return html`
    <div class="employee-workbench__group-header">
      <button
        type="button"
        class="employee-workbench__group-toggle"
        @click=${props.onToggle}
        aria-expanded=${props.collapsed ? "false" : "true"}
      >
        <span class="employee-workbench__group-title-wrap">
          <span class="employee-workbench__group-caret ${props.collapsed ? "collapsed" : ""}">
            ${icons.arrowDown}
          </span>
          <span class="employee-workbench__group-title">${props.title}</span>
        </span>
      </button>
      ${
        props.onAdd
          ? html`
            <button
              type="button"
              class="employee-workbench__group-add"
              @click=${props.onAdd}
              aria-label=${`add ${props.title}`}
            >
              +
            </button>
          `
          : nothing
      }
    </div>
  `;
}
