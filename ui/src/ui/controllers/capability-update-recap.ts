import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import { scanText } from "../capability/employee-capability/terminology-filter.ts";
import type { CapabilityUpdateRecap } from "../capability/employee-capability/types.ts";

export type CapabilityUpdateRecapState = {
  gateway: EmployeeCapabilityGateway | null;
  capabilityId: string | null;
  loading: boolean;
  error: string | null;
  recaps: CapabilityUpdateRecap[];
};

const DEFAULT_HEADLINE = "最近更新 · 完成了能力整理";
const VERSION_TOKEN_PATTERN = /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b|\bv\d+\b/giu;

export function createInitialCapabilityUpdateRecapState(): CapabilityUpdateRecapState {
  return {
    gateway: null,
    capabilityId: null,
    loading: false,
    error: null,
    recaps: [],
  };
}

export function hasVersionMarker(text: string): boolean {
  VERSION_TOKEN_PATTERN.lastIndex = 0;
  return VERSION_TOKEN_PATTERN.test(text);
}

export function normalizeUpdateHeadline(headline: string): string {
  const withoutVersionTokens = headline
    .replace(VERSION_TOKEN_PATTERN, "")
    .replace(/\s+/gu, " ")
    .replace(/\s*·\s*$/u, "")
    .trim();

  if (!withoutVersionTokens) {
    return DEFAULT_HEADLINE;
  }

  const employeeHeadline = withoutVersionTokens.startsWith("最近更新")
    ? withoutVersionTokens
    : `最近更新 · ${withoutVersionTokens}`;

  try {
    scanText(employeeHeadline);
    return employeeHeadline;
  } catch {
    return DEFAULT_HEADLINE;
  }
}

export function normalizeUpdateRecap(recap: CapabilityUpdateRecap): CapabilityUpdateRecap {
  return {
    id: recap.id,
    at: Number.isFinite(recap.at) ? recap.at : 0,
    headline: normalizeUpdateHeadline(recap.headline),
  };
}

export function isEmployeeLanguageUpdateRecap(recap: CapabilityUpdateRecap): boolean {
  if (hasVersionMarker(recap.headline)) {
    return false;
  }
  try {
    scanText(recap.headline);
    return true;
  } catch {
    return false;
  }
}

export async function loadUpdateRecap(
  state: CapabilityUpdateRecapState,
  capabilityId: string,
): Promise<CapabilityUpdateRecap[]> {
  state.capabilityId = capabilityId;

  if (!state.gateway) {
    state.error = "暂时无法加载最近更新，请稍后再试";
    state.recaps = [];
    return [];
  }

  state.loading = true;
  state.error = null;

  try {
    const response = await state.gateway.updateRecap({ capabilityId });
    const recaps = response.recaps.filter(isEmployeeLanguageUpdateRecap).map(normalizeUpdateRecap);
    state.recaps = recaps;
    return recaps;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = `加载最近更新失败：${message}`;
    state.recaps = [];
    return [];
  } finally {
    state.loading = false;
  }
}
