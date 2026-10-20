/**
 * SaaS full Control UI port gate.
 *
 * Orthogonal to OPENCLAW_VARIANT (default|slim). The only shipping surface is
 * `full`: employee, enterprise, platform, and diagnosis. Unset matches full.
 * Any other value fails `pnpm ui:build` and the image build. There is no
 * second shell and no port-exclusion switch on this path.
 */

/** @typedef {"full"} OpenBotSurface */
/** @typedef {"employee" | "enterprise" | "platform" | "diagnosis"} UiPortId */

/** @type {readonly OpenBotSurface[]} */
export const OPENBOT_SURFACES = Object.freeze(["full"]);

/** Ports bundled for the SaaS full surface. */
/** @type {readonly UiPortId[]} */
export const FULL_UI_PORTS = Object.freeze(["employee", "enterprise", "platform", "diagnosis"]);

/**
 * @param {string | null | undefined} raw
 * @returns {OpenBotSurface}
 */
export function resolveOpenBotSurface(raw) {
  if (raw == null || raw === "" || raw === "full") {
    return "full";
  }
  throw new Error(
    `OPENBOT_SURFACE must be empty or "full" (got ${JSON.stringify(raw)}). No other surface ships.`,
  );
}

/**
 * @param {string | null | undefined} surface
 * @returns {UiPortId[]}
 */
export function selectPortsForSurface(surface) {
  resolveOpenBotSurface(surface);
  return [...FULL_UI_PORTS];
}

/**
 * Build gate: the shipping surface bundles the full port set, including platform.
 * @param {string | null | undefined} surface
 * @param {readonly string[]} [ports]
 * @returns {UiPortId[]}
 */
export function assertP1BundlesFullPorts(surface, ports = selectPortsForSurface(surface)) {
  const resolved = resolveOpenBotSurface(surface);
  for (const id of FULL_UI_PORTS) {
    if (!ports.includes(id)) {
      throw new Error(`OPENBOT_SURFACE=${resolved} must bundle UI port "${id}".`);
    }
  }
  return [...FULL_UI_PORTS];
}

/**
 * @param {OpenBotSurface} surface
 * @param {readonly string[]} ports
 */
export function formatOpenBotSurfaceSelection(surface, ports) {
  return `OPENBOT_SURFACE=${surface} UI ports: ${ports.join(", ")}`;
}
