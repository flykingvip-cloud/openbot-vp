import { html, nothing } from "lit";
import { followPortHref, requestPlatformSurfaceRerender } from "../shared/surface.ts";
import { readKeyAccountNotice } from "./state.ts";

export function rerenderKeyAccountPage(): void {
  requestPlatformSurfaceRerender();
}

export function keyAccountRouteAnchor(href: string, label: string, className = "btn btn--sm") {
  return html`
    <a
      class=${className}
      href=${href}
      @click=${(event: MouseEvent) => followPortHref(event, href)}
      >${label}</a
    >
  `;
}

export function renderKeyAccountNotice() {
  const current = readKeyAccountNotice();
  if (!current) {
    return nothing;
  }
  return html`<p class="ka-note" data-ka-notice=${current.tone}>${current.text}</p>`;
}
