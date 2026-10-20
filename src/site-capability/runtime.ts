/**
 * Minimal site-capability runtime.
 *
 * site_list / site_describe / site_invoke are one tool surface. A tool allowlist
 * is not permission to run a capability. Each invoke checks the server principal,
 * the fixed version, the artifact digest, and the account binding.
 *
 * OI/grant, AccountBinding, and this catalog stay separate objects.
 * skill-capability-contract remains verb discovery only.
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../browser/constants.js";
import type { SkillLifecycleHint } from "../gateway/skill-capability-contract.js";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import type { SiteCapabilityManifest } from "./contract.js";
import { ensureAccountBrowserCoordinator } from "./coordinator.js";
import { SarExecutionAuthority } from "./execution-authority.js";
import { createAccountBrowserPort } from "./account-browser-port.js";
import { findSarScriptKey, type TrustedPagePort } from "./operations.js";
import {
  type SiteCompleteness,
  type SiteEvidence,
  type SiteRetryHint,
  type SiteRunError,
  type SiteRunResult,
  type SiteRunStatus,
  type SiteVerification,
} from "./result.js";
import {
  denialForForbiddenTarget,
  findForbiddenTargetKey,
  type ServerPrincipal,
} from "./session-handle.js";
import { resolveRunVerification, type SiteBusinessVerifier } from "./verification-gate.js";

export const SAR_SERVER_PAGE_TARGET = "sar-page";

/**
 * Candidates stay off the invoke path. `private` is a saved draft, not an
 * enabled capability. Human acceptance moves a catalog record to `approved`.
 * `approved` still needs verification `passed` before it is callable.
 */
const BLOCKED_LIFECYCLE = new Set<SkillLifecycleHint>([
  "draft",
  "private",
  "reviewing",
  "deprecated",
  "rejected",
  "retired",
]);

const IDENTITY_ARG_KEYS = new Set([
  "tenantId",
  "userId",
  "principal",
  "platformUserId",
  "enterpriseId",
  "subject",
]);

export type SiteAvailability = "available" | "unavailable";

export type SiteInputField = {
  name: string;
  required: boolean;
};

export type SitePlanStep =
  | { op: "navigate"; urlTemplate: string }
  | { op: "read_page"; fields: string[] }
  | { op: "request_context"; name: "session" | "page" | "search" | "detail" }
  | { op: "capture_result"; fields: string[] };

export type SiteCapabilityRecord = {
  manifest: SiteCapabilityManifest;
  inputFields: readonly SiteInputField[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  accountSummary: string;
  verification: "unverified" | "passed" | "failed" | "stale";
  artifactDigest: string;
  disabled: boolean;
  /** Internal distribution id. Never returned by list or describe. */
  packageId: string;
  plan: readonly SitePlanStep[];
  maxItems?: number;
  lifecycle: SkillLifecycleHint;
};

export type SiteCapabilityGrant = {
  tenantId: string;
  userId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  accountBindingIds: readonly string[];
};

export type SiteCapabilitySummary = {
  capabilityId: string;
  version: string;
  site: string;
  operation: string;
  description: string;
  effect: "read";
  availability: SiteAvailability;
};

export type SiteCapabilityDescription = {
  capabilityId: string;
  version: string;
  site: string;
  operation: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  accountRequirements: {
    authMode: SiteCapabilityManifest["authMode"];
    bindingRequired: boolean;
    summary: string;
  };
  effect: "read";
  availability: SiteAvailability;
  verification: SiteCapabilityRecord["verification"];
};

export type SiteListPage = {
  ok: true;
  items: SiteCapabilitySummary[];
  nextCursor: string | null;
};

type RuntimeDenial = {
  ok: false;
  code: string;
  message: string;
};

export type SiteRuntimeOptions = {
  authority: SarExecutionAuthority;
  portForScope: (scopeKey: string) => TrustedPagePort;
  now?: () => number;
  mintRunId?: () => string;
  mintEvidenceRef?: () => string;
  /**
   * Optional business verifier. Absence leaves a succeeded run at
   * `not_performed`. Completeness never fills this in.
   */
  verifier?: SiteBusinessVerifier;
};

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,32}$/;

function grantKey(tenantId: string, userId: string, capabilityId: string, version: string): string {
  return `${tenantId}\n${userId}\n${capabilityId}\n${version}`;
}

function recordKey(capabilityId: string, version: string): string {
  return `${capabilityId}@${version}`;
}

function availabilityOf(record: SiteCapabilityRecord): SiteAvailability {
  if (
    record.disabled ||
    record.verification !== "passed" ||
    BLOCKED_LIFECYCLE.has(record.lifecycle)
  ) {
    return "unavailable";
  }
  return "available";
}

function projectSummary(record: SiteCapabilityRecord): SiteCapabilitySummary {
  return {
    capabilityId: record.manifest.id,
    version: record.manifest.version,
    site: record.manifest.site,
    operation: record.manifest.operation,
    description: record.manifest.description,
    effect: "read",
    availability: availabilityOf(record),
  };
}

function projectDescription(record: SiteCapabilityRecord): SiteCapabilityDescription {
  return {
    capabilityId: record.manifest.id,
    version: record.manifest.version,
    site: record.manifest.site,
    operation: record.manifest.operation,
    description: record.manifest.description,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    accountRequirements: {
      authMode: record.manifest.authMode,
      bindingRequired: record.manifest.authMode === "browser_session",
      summary: record.accountSummary,
    },
    effect: "read",
    availability: availabilityOf(record),
    verification: record.verification,
  };
}

function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number | null {
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    if (!text.startsWith("o:")) {
      return null;
    }
    const offset = Number(text.slice(2));
    if (!Number.isInteger(offset) || offset < 0) {
      return null;
    }
    return offset;
  } catch {
    return null;
  }
}

function templateOrigin(template: string): string | null {
  const query = template.indexOf("?");
  const path = query === -1 ? template : template.slice(0, query);
  if (path.includes("{") || path.includes("}")) {
    return null;
  }
  const concrete = template.replace(/\{[A-Za-z][A-Za-z0-9_]{0,32}\}/g, "x");
  try {
    const url = new URL(concrete);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function applyItemBudget(
  data: unknown,
  maxItems: number | undefined,
): { data: unknown; completeness: SiteCompleteness } {
  if (maxItems === undefined || !data || typeof data !== "object" || Array.isArray(data)) {
    return { data, completeness: "complete" };
  }
  const next: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  let partial = false;
  for (const key of ["items", "orders"] as const) {
    const value = next[key];
    if (Array.isArray(value) && value.length > maxItems) {
      next[key] = value.slice(0, maxItems);
      partial = true;
    }
  }
  return { data: next, completeness: partial ? "partial" : "complete" };
}

let defaultRuntime: SiteCapabilityRuntime | null = null;

/** Production catalog. Empty until a capability is registered on this process. */
export function getDefaultSiteCapabilityRuntime(): SiteCapabilityRuntime {
  const authority = ensureAccountBrowserCoordinator();
  if (!defaultRuntime) {
    defaultRuntime = new SiteCapabilityRuntime({
      authority,
      portForScope: (scopeKey) => createAccountBrowserPort(scopeKey),
    });
  }
  return defaultRuntime;
}

export function resetDefaultSiteCapabilityRuntimeForTests(): void {
  defaultRuntime = null;
}

export class SiteCapabilityRuntime {
  private readonly records = new Map<string, SiteCapabilityRecord>();
  private readonly grants = new Map<string, SiteCapabilityGrant>();
  private readonly evidence = new Map<string, SiteEvidence>();

  constructor(private readonly options: SiteRuntimeOptions) {}

  register(record: SiteCapabilityRecord): { ok: true } | SarDenial {
    const originError = this.validatePlan(record);
    if (originError) {
      return originError;
    }
    const registered = this.options.authority.registerCapability(record.manifest);
    if (!registered.ok) {
      return registered;
    }
    this.records.set(recordKey(record.manifest.id, record.manifest.version), record);
    return { ok: true };
  }

  grant(input: SiteCapabilityGrant): { ok: true } | SarDenial {
    const record = this.records.get(recordKey(input.capabilityId, input.version));
    if (!record) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "capability version is not registered");
    }
    if (record.artifactDigest !== input.artifactDigest) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "artifact digest does not match");
    }
    this.grants.set(grantKey(input.tenantId, input.userId, input.capabilityId, input.version), {
      ...input,
      accountBindingIds: [...input.accountBindingIds],
    });
    return { ok: true };
  }

  readEvidence(evidenceRef: string): SiteEvidence | undefined {
    const found = this.evidence.get(evidenceRef);
    return found ? { ...found } : undefined;
  }

  list(
    principal: ServerPrincipal,
    opts?: { cursor?: string; limit?: number },
  ): SiteListPage | RuntimeDenial {
    const limit = clampLimit(opts?.limit);
    let offset = 0;
    if (opts?.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded === null) {
        return { ok: false, code: "INVALID_CURSOR", message: "cursor is not valid" };
      }
      offset = decoded;
    }
    const rows = this.grantedRecords(principal);
    const slice = rows.slice(offset, offset + limit);
    const next = offset + limit < rows.length ? encodeCursor(offset + limit) : null;
    return { ok: true, items: slice.map(projectSummary), nextCursor: next };
  }

  describe(
    principal: ServerPrincipal,
    capabilityId: string,
    version?: string,
  ): { ok: true; capability: SiteCapabilityDescription } | RuntimeDenial {
    const match = this.grantedRecords(principal).find((record) => {
      if (record.manifest.id !== capabilityId) {
        return false;
      }
      if (version && record.manifest.version !== version) {
        return false;
      }
      return true;
    });
    if (!match) {
      return { ok: false, code: "NOT_AUTHORIZED", message: "capability is not available" };
    }
    return { ok: true, capability: projectDescription(match) };
  }

  async invoke(
    principal: ServerPrincipal,
    input: {
      capabilityId?: string;
      version?: string;
      args?: unknown;
      accountBindingId?: string;
    },
  ): Promise<SiteRunResult> {
    const started = this.now();
    const capabilityId = input.capabilityId?.trim() ?? "";
    const version = input.version?.trim() ?? "";
    if (!capabilityId || !version) {
      return this.finish({
        started,
        capabilityId: capabilityId || "unknown",
        version: version || "unknown",
        artifactDigest: "",
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure("VERSION_REQUIRED", "invoke requires a fixed capability version", "none"),
      });
    }
    const scriptKey = findSarScriptKey(input.args);
    if (scriptKey) {
      return this.finish({
        started,
        capabilityId,
        version,
        artifactDigest: "",
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure(
          SAR_DENIAL_CODE.evaluate,
          `SAR rejects page script payload (${scriptKey}) even when browser evaluate is enabled`,
          "none",
        ),
      });
    }
    const forbidden = findForbiddenTargetKey(input.args);
    if (forbidden) {
      const denial = denialForForbiddenTarget(forbidden);
      return this.failedDenial(started, capabilityId, version, "", denial);
    }
    const granted = this.grants.get(
      grantKey(principal.tenantId, principal.userId, capabilityId, version),
    );
    const record = this.records.get(recordKey(capabilityId, version));
    if (!granted || !record || granted.artifactDigest !== record.artifactDigest) {
      return this.finish({
        started,
        capabilityId,
        version,
        artifactDigest: "",
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure("NOT_AUTHORIZED", "capability is not available", "none"),
      });
    }
    if (availabilityOf(record) !== "available") {
      return this.finish({
        started,
        capabilityId,
        version,
        artifactDigest: record.artifactDigest,
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure("NOT_AUTHORIZED", "capability is not available", "none"),
      });
    }
    const parsedArgs = parseInvokeArgs(record, input.args);
    if (!parsedArgs.ok) {
      return this.failedDenial(started, capabilityId, version, record.artifactDigest, parsedArgs);
    }
    const bindingId = selectBinding(granted, input.accountBindingId);
    if (!bindingId.ok) {
      return this.failedDenial(started, capabilityId, version, record.artifactDigest, bindingId);
    }
    return this.executePlan({
      principal,
      record,
      args: parsedArgs.args,
      bindingId: bindingId.bindingId,
      started,
    });
  }

  /**
   * Run a declarative candidate through the trusted runtime.
   * Does not grant, enable, or publish. Product tools must keep using invoke.
   */
  async runCandidate(
    principal: ServerPrincipal,
    input: {
      record: SiteCapabilityRecord;
      args?: unknown;
      accountBindingId: string;
    },
  ): Promise<SiteRunResult> {
    const started = this.now();
    const capabilityId = input.record.manifest.id;
    const version = input.record.manifest.version;
    const scriptKey = findSarScriptKey(input.args) ?? findSarScriptKey(input.record.plan);
    if (scriptKey) {
      return this.finish({
        started,
        capabilityId,
        version,
        artifactDigest: input.record.artifactDigest,
        status: "failed",
        verification: "failed",
        data: null,
        completeness: "complete",
        error: failure(
          SAR_DENIAL_CODE.evaluate,
          `SAR rejects page script payload (${scriptKey}) even when browser evaluate is enabled`,
          "none",
        ),
      });
    }
    const forbidden =
      findForbiddenTargetKey(input.args) ?? findForbiddenTargetKey(input.record.plan);
    if (forbidden) {
      return this.failedDenial(
        started,
        capabilityId,
        version,
        input.record.artifactDigest,
        denialForForbiddenTarget(forbidden),
      );
    }
    const registered = this.options.authority.registerCapability(input.record.manifest);
    if (!registered.ok) {
      return this.failedDenial(
        started,
        capabilityId,
        version,
        input.record.artifactDigest,
        registered,
      );
    }
    const originError = this.validatePlan(input.record);
    if (originError) {
      return this.failedDenial(
        started,
        capabilityId,
        version,
        input.record.artifactDigest,
        originError,
      );
    }
    const parsedArgs = parseInvokeArgs(input.record, input.args);
    if (!parsedArgs.ok) {
      return this.failedDenial(
        started,
        capabilityId,
        version,
        input.record.artifactDigest,
        parsedArgs,
      );
    }
    const bindingId = input.accountBindingId.trim();
    if (!bindingId) {
      return this.failedDenial(
        started,
        capabilityId,
        version,
        input.record.artifactDigest,
        sarDeny(SAR_DENIAL_CODE.bindingNotFound, "accountBindingId is required"),
      );
    }
    return this.executePlan({
      principal,
      record: input.record,
      args: parsedArgs.args,
      bindingId,
      started,
    });
  }

  private async executePlan(input: {
    principal: ServerPrincipal;
    record: SiteCapabilityRecord;
    args: Record<string, string>;
    bindingId: string;
    started: number;
  }): Promise<SiteRunResult> {
    const { principal, record, args, bindingId, started } = input;
    const capabilityId = record.manifest.id;
    const version = record.manifest.version;
    const handle = this.options.authority.resolveSessionHandle({
      principal,
      bindingId,
      pageTargetId: SAR_SERVER_PAGE_TARGET,
    });
    if (!handle.ok) {
      return this.failedDenial(started, capabilityId, version, record.artifactDigest, handle);
    }
    const runId = this.options.mintRunId?.() ?? `sarun_${randomUUID()}`;
    const bound = this.options.authority.bindRun({
      handleToken: handle.handle.token,
      runId,
      capabilityId,
      version,
    });
    if (!bound.ok) {
      return this.failedDenial(started, capabilityId, version, record.artifactDigest, bound);
    }
    const port = this.options.portForScope(bound.scopeKey);
    try {
      let data: unknown = {};
      for (const step of record.plan) {
        const rawOp = materializeStep(step, args);
        if (!rawOp.ok) {
          return this.failedDenial(
            started,
            capabilityId,
            version,
            record.artifactDigest,
            rawOp,
            runId,
          );
        }
        const dispatched = await this.options.authority.dispatch({
          runId,
          handleToken: handle.handle.token,
          rawOp: rawOp.op,
          port,
          productEvaluateEnabled: DEFAULT_BROWSER_EVALUATE_ENABLED,
        });
        if (!dispatched.ok) {
          return this.finish(
            outcomeFromDenial(
              started,
              capabilityId,
              version,
              record.artifactDigest,
              dispatched,
              runId,
            ),
          );
        }
        if (dispatched.value.kind === "capture_result") {
          data = dispatched.value.data;
        }
      }
      const budgeted = applyItemBudget(data, record.maxItems);
      return this.finish({
        started,
        runId,
        capabilityId,
        version,
        artifactDigest: record.artifactDigest,
        status: "succeeded",
        verification: resolveRunVerification({
          status: "succeeded",
          completeness: budgeted.completeness,
          verifier: this.options.verifier,
          capabilityId,
          version,
          artifactDigest: record.artifactDigest,
          data: budgeted.data,
        }),
        data: budgeted.data,
        completeness: budgeted.completeness,
      });
    } finally {
      this.options.authority.releaseRun(runId);
    }
  }

  private grantedRecords(principal: ServerPrincipal): SiteCapabilityRecord[] {
    const rows: SiteCapabilityRecord[] = [];
    for (const grant of this.grants.values()) {
      if (grant.tenantId !== principal.tenantId || grant.userId !== principal.userId) {
        continue;
      }
      const record = this.records.get(recordKey(grant.capabilityId, grant.version));
      if (!record || record.artifactDigest !== grant.artifactDigest) {
        continue;
      }
      rows.push(record);
    }
    rows.sort((a, b) => {
      const id = a.manifest.id.localeCompare(b.manifest.id);
      if (id !== 0) {
        return id;
      }
      return a.manifest.version.localeCompare(b.manifest.version);
    });
    return rows;
  }

  private validatePlan(record: SiteCapabilityRecord): SarDenial | null {
    if (record.plan.length === 0) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "declarative plan is required");
    }
    for (const step of record.plan) {
      if (step.op !== "navigate") {
        continue;
      }
      const origin = templateOrigin(step.urlTemplate);
      if (!origin || !record.manifest.allowedOrigins.includes(origin)) {
        return sarDeny(
          SAR_DENIAL_CODE.invalidManifest,
          "plan navigation origin is not allowlisted",
        );
      }
    }
    return null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private failedDenial(
    started: number,
    capabilityId: string,
    version: string,
    artifactDigest: string,
    denial: { code: string; message: string },
    runId?: string,
  ): SiteRunResult {
    return this.finish(
      outcomeFromDenial(started, capabilityId, version, artifactDigest, denial, runId),
    );
  }

  private finish(input: {
    started: number;
    runId?: string;
    capabilityId: string;
    version: string;
    artifactDigest: string;
    status: SiteRunStatus;
    verification: SiteVerification;
    data: unknown;
    completeness: SiteCompleteness;
    error?: SiteRunError;
  }): SiteRunResult {
    const runId = input.runId ?? this.options.mintRunId?.() ?? `sarun_${randomUUID()}`;
    const evidenceRef = this.options.mintEvidenceRef?.() ?? `ev_${randomUUID()}`;
    const result: SiteRunResult = {
      runId,
      capabilityId: input.capabilityId,
      version: input.version,
      status: input.status,
      verification: input.verification,
      data: input.data,
      completeness: input.completeness,
      ...(input.error ? { error: input.error } : {}),
      evidenceRef,
      durationMs: Math.max(0, this.now() - input.started),
      repair: "none",
    };
    this.evidence.set(evidenceRef, {
      evidenceRef,
      runId,
      capabilityId: input.capabilityId,
      version: input.version,
      artifactDigest: input.artifactDigest,
      status: input.status,
      verification: input.verification,
      completeness: input.completeness,
    });
    return result;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 20;
  }
  return Math.min(50, Math.max(1, Math.floor(limit)));
}

function failure(
  code: string,
  message: string,
  retry: SiteRetryHint,
  ordinaryFailure = true,
): SiteRunError {
  return { code, message, retry, ordinaryFailure };
}

function outcomeFromDenial(
  started: number,
  capabilityId: string,
  version: string,
  artifactDigest: string,
  denial: { code: string; message: string },
  runId?: string,
): {
  started: number;
  runId?: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  status: SiteRunStatus;
  verification: SiteVerification;
  data: unknown;
  completeness: SiteCompleteness;
  error: SiteRunError;
} {
  if (denial.code === SAR_DENIAL_CODE.operationFault && denial.message === "RESULT_UNKNOWN") {
    return {
      started,
      runId,
      capabilityId,
      version,
      artifactDigest,
      status: "unknown",
      verification: "not_performed",
      data: null,
      completeness: "partial",
      error: failure(
        "RESULT_UNKNOWN",
        "result is unknown and must not be retried as an ordinary failure",
        "not_ordinary",
        false,
      ),
    };
  }
  if (denial.code === SAR_DENIAL_CODE.operationFault && denial.message === "AUTH_REQUIRED") {
    return {
      started,
      runId,
      capabilityId,
      version,
      artifactDigest,
      status: "failed",
      verification: "failed",
      data: null,
      completeness: "complete",
      error: failure("AUTH_REQUIRED", "account login is required", "after_reauth"),
    };
  }
  return {
    started,
    runId,
    capabilityId,
    version,
    artifactDigest,
    status: "failed",
    verification: "failed",
    data: null,
    completeness: "complete",
    error: failure(denial.code, denial.message, "none"),
  };
}

export function parseInvokeArgs(
  record: SiteCapabilityRecord,
  raw: unknown,
): { ok: true; args: Record<string, string> } | SarDenial {
  if (raw === undefined) {
    raw = {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return sarDeny(SAR_DENIAL_CODE.opNotInSet, "args must be an object");
  }
  const recordArgs = raw as Record<string, unknown>;
  const allowed = new Set(record.inputFields.map((field) => field.name));
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(recordArgs)) {
    if (IDENTITY_ARG_KEYS.has(key)) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "identity fields are not invoke arguments");
    }
    if (!allowed.has(key)) {
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, `unexpected argument ${key}`);
    }
    if (typeof value !== "string" || !FIELD_NAME.test(key) || value.length > 200) {
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, `argument ${key} is not a bounded string`);
    }
    args[key] = value;
  }
  for (const field of record.inputFields) {
    if (field.required && args[field.name] === undefined) {
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, `missing argument ${field.name}`);
    }
  }
  return { ok: true, args };
}

function selectBinding(
  grant: SiteCapabilityGrant,
  requested: string | undefined,
): { ok: true; bindingId: string } | SarDenial {
  const allowed = grant.accountBindingIds.map((id) => id.trim()).filter((id) => id.length > 0);
  const bindingId = requested?.trim() ?? "";
  if (bindingId) {
    if (!allowed.includes(bindingId)) {
      return sarDeny(
        SAR_DENIAL_CODE.policyDenied,
        "account binding is not authorized for this capability",
      );
    }
    return { ok: true, bindingId };
  }
  const only = allowed[0];
  if (allowed.length === 1 && only) {
    return { ok: true, bindingId: only };
  }
  return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "accountBindingId is required");
}

function materializeStep(
  step: SitePlanStep,
  args: Record<string, string>,
): { ok: true; op: Record<string, unknown> } | SarDenial {
  if (step.op === "navigate") {
    const filled = fillTemplate(step.urlTemplate, args);
    if (!filled.ok) {
      return filled;
    }
    return { ok: true, op: { op: "navigate", url: filled.url } };
  }
  if (step.op === "request_context") {
    return { ok: true, op: { op: "request_context", name: step.name } };
  }
  return { ok: true, op: { op: step.op, fields: [...step.fields] } };
}

function fillTemplate(
  template: string,
  args: Record<string, string>,
): { ok: true; url: string } | SarDenial {
  const missing: string[] = [];
  const url = template.replace(/\{([A-Za-z][A-Za-z0-9_]{0,32})\}/g, (_all, name: string) => {
    const value = args[name];
    if (value === undefined) {
      missing.push(name);
      return "";
    }
    return encodeURIComponent(value);
  });
  const missingName = missing[0];
  if (missingName) {
    return sarDeny(SAR_DENIAL_CODE.opNotInSet, `url template is missing ${missingName}`);
  }
  return { ok: true, url };
}
