export type OpenBotSurface = "full";
export type UiPortId = "employee" | "enterprise" | "platform" | "diagnosis";

export const OPENBOT_SURFACES: readonly OpenBotSurface[];
export const FULL_UI_PORTS: readonly UiPortId[];

export function resolveOpenBotSurface(raw: string | null | undefined): OpenBotSurface;

export function selectPortsForSurface(surface: string | null | undefined): UiPortId[];

export function assertP1BundlesFullPorts(
  surface: string | null | undefined,
  ports?: readonly string[],
): UiPortId[];

export function formatOpenBotSurfaceSelection(
  surface: OpenBotSurface,
  ports: readonly string[],
): string;
