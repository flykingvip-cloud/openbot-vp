/**
 * Process-injected controlled SAR provider for the governance website_session path.
 *
 * Uses SiteCapabilityRuntime + account-browser serial (Auth⊥Exec). Does not
 * open a bridge daemon, export cookies, fork OpenCLI, or fall back to mock
 * handlers. Clients cannot supply this provider over RPC; product handlers inject it.
 *
 * Missing capability / grant / binding / browser port → clear failure from the
 * runtime. Field-level appliedFilters that this provider cannot enforce before
 * read → scopeEnforcedBeforeRead false (no silent over-read success).
 */

import { randomUUID } from "node:crypto";
import {
  getDefaultSiteCapabilityRuntime,
  type SiteCapabilityRuntime,
} from "../../site-capability/runtime.js";
import type { SiteRunResult } from "../../site-capability/result.js";
import type {
  SarGovernanceProvider,
  SarGovernanceProviderInput,
} from "./sar-governance-bridge.js";
import type { ScopeEvaluationResult } from "./types.js";

export type ControlledSarProviderOptions = {
  /** Override runtime (tests: ControllableTestSite harness). Production omits. */
  runtime?: SiteCapabilityRuntime;
};

/** Process override so production-entry tests can back the real provider with ControllableTestSite. */
let processRuntimeOverride: SiteCapabilityRuntime | null = null;

function resolveProcessRuntime(): SiteCapabilityRuntime {
  return processRuntimeOverride ?? getDefaultSiteCapabilityRuntime();
}

/**
 * Empty appliedFilters: private AccountBinding + account-browser serial already
 * confine the session to the authorized principal before any capture.
 * Non-empty field filters need plan-level pre-read enforcement this provider
 * does not rewrite; refuse to claim enforcement (do not lie).
 */
export function canEnforceScopeBeforeRead(scope: ScopeEvaluationResult): boolean {
  return scope.appliedFilters.length === 0;
}

function toInvokeArgs(input?: Record<string, unknown>): Record<string, string> | undefined {
  if (!input) {
    return undefined;
  }
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      args[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      args[key] = String(value);
    }
  }
  return Object.keys(args).length > 0 ? args : undefined;
}

function scopeUnsupportedResult(input: SarGovernanceProviderInput): SiteRunResult {
  return {
    runId: `sarun_${randomUUID()}`,
    capabilityId: input.capabilityId,
    version: input.version,
    status: "failed",
    verification: "failed",
    data: null,
    completeness: "complete",
    evidenceRef: "",
    durationMs: 0,
    repair: "none",
    error: {
      code: "SAR_SCOPE_UNSUPPORTED",
      message: "Controlled SAR provider cannot enforce appliedFilters before read.",
      retry: "none",
      ordinaryFailure: true,
    },
  };
}

/**
 * Build a controlled SarGovernanceProvider.
 * Production: omit options (uses process default runtime / override).
 * Tests: pass a ControllableTestSite-backed SiteCapabilityRuntime.
 */
export function createControlledSarProvider(
  options?: ControlledSarProviderOptions,
): SarGovernanceProvider {
  return {
    async execute(input) {
      if (!canEnforceScopeBeforeRead(input.scope)) {
        return {
          result: scopeUnsupportedResult(input),
          scopeEnforcedBeforeRead: false,
        };
      }
      const runtime = options?.runtime ?? resolveProcessRuntime();
      const result = await runtime.invoke(
        { tenantId: input.tenantId, userId: input.userId },
        {
          capabilityId: input.capabilityId,
          version: input.version,
          accountBindingId: input.bindingId,
          args: toInvokeArgs(input.input),
        },
      );
      return {
        result,
        scopeEnforcedBeforeRead: true,
      };
    },
  };
}

/** Shared factory for enterprise-data.invoke and E4 materialization entry points. */
export function getProcessControlledSarProvider(): SarGovernanceProvider {
  return createControlledSarProvider({
    runtime: processRuntimeOverride ?? undefined,
  });
}

/** Test-only: back the process provider with a ControllableTestSite runtime. */
export function setProcessControlledSarRuntimeForTests(
  runtime: SiteCapabilityRuntime | null,
): void {
  processRuntimeOverride = runtime;
}

export function resetProcessControlledSarProviderForTests(): void {
  processRuntimeOverride = null;
}
