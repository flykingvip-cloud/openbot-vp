import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { CONSOLE_TABS, pathForTab, titleForTab, type Tab } from "../navigation.ts";

export type ConsoleSubnavProps = {
  tabs?: readonly Tab[];
  activeTab: Tab;
  basePath: string;
  enterpriseTenantId?: string | null;
  ariaLabel?: string;
  onOpenConsoleTab: (tab: Tab) => void;
};

export function renderConsoleSubnav(props: ConsoleSubnavProps) {
  const tabs = props.tabs ?? CONSOLE_TABS;
  return html`
    <nav class="console-subnav" aria-label=${props.ariaLabel ?? t("tabs.control")}>
      ${tabs.map((tab) => {
        const active = props.activeTab === tab;
        const href = pathForTab(tab, props.basePath, {
          tenantId: props.enterpriseTenantId,
        });
        return html`
          <a
            href=${href}
            class="console-subnav__item ${active ? "active" : ""}"
            @click=${(event: MouseEvent) => {
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
              event.preventDefault();
              props.onOpenConsoleTab(tab);
            }}
          >
            ${titleForTab(tab)}
          </a>
        `;
      })}
    </nav>
  `;
}
