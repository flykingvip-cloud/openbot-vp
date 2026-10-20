/**
 * Tri-Platform Employee Shell — workbench embed routing (Phase 1 wiring).
 *
 * Maps an `/embed/employee/<surface>` route onto the employee workbench's tab
 * ("me") + primary module, and reflects chrome-less state onto the document root
 * so CSS can hide the workbench sidebar/header. The employee workbench already
 * renders for tab "me", so this needs no change to the (large, shared) render
 * pipeline — only the router (app-settings) calls in here.
 *
 * The pure resolver/mapping are dependency-light and node-testable; only
 * `applyEmployeeEmbedRootClass` touches the DOM.
 */

import type { WorkbenchPrimaryModule } from "../ports/employee/views/workbench-types.ts";
import { parseEmployeeEmbedPath, type EmployeeEmbedSurface } from "./embed-routes.ts";

/**
 * Best-effort mapping from embed surface to today's workbench primary module.
 *
 * IA note: the target-IA surfaces do NOT map 1:1 to current modules — there is
 * no dedicated `overview` or `growth` module (modules are assistant /
 * collaboration / knowledge / settings / tasks). Both `overview` and `growth`
 * therefore fall back to the workbench home ("assistant"), where overview signal
 * cards and growth surfaces render. Resolving this is an open IA decision
 * tracked in the design doc; encode the approximation here in one place.
 */
const SURFACE_TO_MODULE: Record<EmployeeEmbedSurface, WorkbenchPrimaryModule> = {
  overview: "assistant",
  workspace: "collaboration",
  knowledge: "knowledge",
  growth: "assistant",
  me: "settings",
};

export function mapEmbedSurfaceToWorkbenchModule(
  surface: EmployeeEmbedSurface,
): WorkbenchPrimaryModule {
  return SURFACE_TO_MODULE[surface];
}

export type EmployeeEmbedRouting = {
  surface: EmployeeEmbedSurface;
  /** Employee workbench tab (the workbench renders under tab "me"). */
  tab: "me";
  primaryModule: WorkbenchPrimaryModule;
  /** True only for the PHONE embed (iOS/Android carry `?shell=mobile`); macOS embed is false. */
  mobile: boolean;
  /**
   * PHONE-ONLY: for the "me" surface, pin the settings module to the PERSONAL
   * view. Set only when `mobile` is true, so the macOS embed (full web parity)
   * and desktop web keep system settings. Only applied for "me".
   */
  settingsView?: "personal";
  chromeless: true;
};

/** Strip a leading base path (e.g. `/app`) so embed matching sees `/embed/...`. */
function stripBasePath(pathname: string, basePath: string): string {
  const base = basePath.replace(/\/+$/, "");
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return pathname;
}

/**
 * Resolve embed routing for a pathname (base-path aware), or `null` when the
 * path is not a canonical employee embed route. `search` (e.g. `window.location.search`)
 * carries the phone marker (`?shell=mobile`) that opts into phone-only trims.
 */
export function resolveEmployeeEmbedRouting(
  pathname: string,
  basePath = "",
  search = "",
): EmployeeEmbedRouting | null {
  const surface = parseEmployeeEmbedPath(stripBasePath(pathname, basePath));
  if (surface === null) {
    return null;
  }
  const mobile = isMobileEmbedSearch(search);
  const routing: EmployeeEmbedRouting = {
    surface,
    tab: "me",
    primaryModule: mapEmbedSurfaceToWorkbenchModule(surface),
    mobile,
    chromeless: true,
  };
  // PHONE-ONLY: "me" pins the settings module to personal. macOS embed (no
  // `shell=mobile` marker) keeps the default system/personal choice → full parity.
  if (mobile && surface === "me") {
    routing.settingsView = "personal";
  }
  return routing;
}

/** CSS hooks toggled on the document root to drive chrome-less embed styling. */
export const EMPLOYEE_EMBED_ROOT_CLASS = "employee-embed";

/** Extra root class present ONLY for the phone embed (iOS/Android), never macOS. */
export const EMPLOYEE_EMBED_MOBILE_CLASS = "employee-embed--mobile";

/** Query param the phone native shells set to opt into phone-only trims. */
export const EMPLOYEE_EMBED_MOBILE_PARAM = "shell";
const EMPLOYEE_EMBED_MOBILE_VALUE = "mobile";

/** True when the embed URL carries the phone marker (`?shell=mobile`); macOS embed omits it. */
export function isMobileEmbedSearch(search: string | undefined): boolean {
  if (!search) {
    return false;
  }
  try {
    return (
      new URLSearchParams(search).get(EMPLOYEE_EMBED_MOBILE_PARAM) === EMPLOYEE_EMBED_MOBILE_VALUE
    );
  } catch {
    return false;
  }
}

type ClassListLike = { toggle: (token: string, force?: boolean) => void };
type RootLike = { classList: ClassListLike };

/**
 * Idempotently reflect embed chrome state onto a document root element:
 *   - `employee-embed`         — chrome-less embed (all platforms)
 *   - `employee-embed--mobile` — phone embed only (drives phone-only trims)
 * Falls back to `document.documentElement`; no-op when no DOM is available.
 */
export function applyEmployeeEmbedRootClass(
  chromeless: boolean,
  mobile: boolean,
  root?: RootLike,
): void {
  const el = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!el) {
    return;
  }
  el.classList.toggle(EMPLOYEE_EMBED_ROOT_CLASS, chromeless);
  el.classList.toggle(EMPLOYEE_EMBED_MOBILE_CLASS, chromeless && mobile);
}
