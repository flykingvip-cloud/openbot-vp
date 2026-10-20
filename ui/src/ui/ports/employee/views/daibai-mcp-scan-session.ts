/**
 * In-memory Stage C MCP scan state for the 大白 create-success panel.
 * Survives re-renders; reset with onboarding test helpers.
 */

import type { DaibaiMcpDiscoverySnapshot, DaibaiMcpScanResult } from "./daibai-mcp-scan.ts";
import { rankOrFilterMcpDiscoveryForDaibaiRole } from "./daibai-mcp-scan.ts";

export type DaibaiMcpScanPhase = "idle" | "loading" | "ready" | "error";

export type DaibaiMcpScanSubmitRecord = {
  approvalId: string;
  mcpServer: string;
  mcpTool: string;
  catalogId: string;
};

export type DaibaiMcpScanUiState = {
  phase: DaibaiMcpScanPhase;
  error: string | null;
  /** Raw snapshot from enterprise-data.mcp-discovery.for-seat (last successful or empty). */
  snapshot: DaibaiMcpDiscoverySnapshot | null;
  /** Permission failures hide static hints so they are not shown as discovery rows. */
  suppressStaticFallback: boolean;
  /** Per catalogId filtered result after a successful scan (or empty filters). */
  byCatalogId: Record<string, DaibaiMcpScanResult>;
  /** Key = `${catalogId}\\0${server}\\0${tool}` → last successful submit. */
  submittedByKey: Record<string, DaibaiMcpScanSubmitRecord>;
  /** Per-candidate submit error message. */
  submitErrorByKey: Record<string, string>;
  /** Candidate key currently submitting, if any. */
  submittingKey: string | null;
};

let state: DaibaiMcpScanUiState = {
  phase: "idle",
  error: null,
  snapshot: null,
  suppressStaticFallback: false,
  byCatalogId: {},
  submittedByKey: {},
  submitErrorByKey: {},
  submittingKey: null,
};

export function daibaiMcpScanCandidateKey(
  catalogId: string,
  mcpServer: string,
  mcpTool: string,
): string {
  return `${catalogId.trim()}\0${mcpServer.trim()}\0${mcpTool.trim()}`;
}

export function getDaibaiMcpScanUiState(): DaibaiMcpScanUiState {
  return state;
}

export function resetDaibaiMcpScanUiForTests(): void {
  state = {
    phase: "idle",
    error: null,
    snapshot: null,
    suppressStaticFallback: false,
    byCatalogId: {},
    submittedByKey: {},
    submitErrorByKey: {},
    submittingKey: null,
  };
}

export function beginDaibaiMcpScan(): void {
  state = { ...state, phase: "loading", error: null, suppressStaticFallback: false };
}

export function failDaibaiMcpScan(
  message: string,
  options?: { suppressStaticFallback?: boolean },
): void {
  const suppressStaticFallback = options?.suppressStaticFallback === true;
  state = {
    ...state,
    phase: "error",
    error: message,
    suppressStaticFallback,
    ...(suppressStaticFallback ? { snapshot: null, byCatalogId: {} } : {}),
  };
}

export function completeDaibaiMcpScan(
  snapshot: DaibaiMcpDiscoverySnapshot,
  catalogIds: readonly string[],
): void {
  const byCatalogId: Record<string, DaibaiMcpScanResult> = {};
  for (const catalogId of catalogIds) {
    byCatalogId[catalogId] = rankOrFilterMcpDiscoveryForDaibaiRole(snapshot, catalogId);
  }
  state = {
    ...state,
    phase: "ready",
    error: null,
    suppressStaticFallback: false,
    snapshot,
    byCatalogId,
    // Keep prior submits across re-scan so UI can still show「已提交申请 #…」.
    submittingKey: null,
  };
}

/** One server snapshot per catalog so a template prefilter cannot empty another role. */
export function completeDaibaiMcpScanByCatalog(
  entries: readonly { catalogId: string; snapshot: DaibaiMcpDiscoverySnapshot }[],
): void {
  const byCatalogId: Record<string, DaibaiMcpScanResult> = {};
  for (const entry of entries) {
    byCatalogId[entry.catalogId] = rankOrFilterMcpDiscoveryForDaibaiRole(
      entry.snapshot,
      entry.catalogId,
    );
  }
  state = {
    ...state,
    phase: "ready",
    error: null,
    suppressStaticFallback: false,
    snapshot: entries[0]?.snapshot ?? null,
    byCatalogId,
    submittingKey: null,
  };
}

export function beginDaibaiMcpScanSubmit(key: string): void {
  const nextErrors = { ...state.submitErrorByKey };
  delete nextErrors[key];
  state = {
    ...state,
    submittingKey: key,
    submitErrorByKey: nextErrors,
  };
}

export function completeDaibaiMcpScanSubmit(key: string, record: DaibaiMcpScanSubmitRecord): void {
  const nextErrors = { ...state.submitErrorByKey };
  delete nextErrors[key];
  state = {
    ...state,
    submittingKey: state.submittingKey === key ? null : state.submittingKey,
    submittedByKey: { ...state.submittedByKey, [key]: record },
    submitErrorByKey: nextErrors,
  };
}

export function failDaibaiMcpScanSubmit(key: string, message: string): void {
  state = {
    ...state,
    submittingKey: state.submittingKey === key ? null : state.submittingKey,
    submitErrorByKey: { ...state.submitErrorByKey, [key]: message },
  };
}
