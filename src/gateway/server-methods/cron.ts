import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import { normalizeCronDataBindings } from "../../cron/personal-task-meta.js";
import {
  readCronRunLogEntriesPage,
  readCronRunLogEntriesPageAll,
  resolveCronRunLogPath,
} from "../../cron/run-log.js";
import {
  deleteTeamCronTaskTemplate,
  listTeamCronTaskTemplates,
  upsertTeamCronTaskTemplate,
} from "../../cron/task-templates-store.js";
import type { CronJobCreate, CronJobPatch } from "../../cron/types.js";
import { validateScheduleTimestamp } from "../../cron/validate-timestamp.js";
import { attachProgressToCronJobs } from "../../progress-ledger/read.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronTaskTemplatesDeleteParams,
  validateCronTaskTemplatesListParams,
  validateCronTaskTemplatesSaveParams,
  validateCronUpdateParams,
  validateWakeParams,
} from "../protocol/index.js";
import {
  isRecordVisibleToScope,
  resolveQueryScope,
  resolveTrustedAttribution,
  type QueryScope,
  type RecordOwnership,
} from "../scope-attribution.js";
import type {
  GatewayClient,
  GatewayRequestContext,
  GatewayRequestHandlers,
  RespondFn,
} from "./types.js";

/** Marker sent by personal surfaces; may only narrow the resolved scope. */
type CronOwnerScopeParam = "personal" | undefined;

/**
 * True when the connection carries a platform-auth session. Used to tell a real
 * but unattributable session (must fail closed) apart from a local
 * single-operator gateway that has no identity layer at all.
 */
function isAuthenticatedSession(client: GatewayClient | null): boolean {
  return Boolean(client?.sessionDomain) || Boolean(client?.user?.trim());
}

/**
 * Effective cron scope: the session scope plus an optional owner pin.
 *
 * `isVisible` is the authoritative predicate. A personal request intersects the
 * session scope with the caller's own ownerId instead of replacing it, so a
 * tenant-bound session stays tenant-bound: narrowing on the owner axis must not
 * widen the tenant axis for users who hold memberships in several enterprises.
 */
type CronScope = {
  /** Session scope, used to decide whether any filtering applies at all. */
  base: QueryScope;
  /** Owner pin from `ownerScope: "personal"`, resolved from the session only. */
  personalOwnerId?: string;
  isVisible: (ownership: RecordOwnership | undefined) => boolean;
  /** True when the caller may see every record (platform, no personal pin). */
  unrestricted: boolean;
};

/**
 * Resolve the effective scope for a cron call.
 *
 * `ownerScope: "personal"` is a *narrowing-only* request from a personal surface
 * ("我的定时任务"). The owner is taken from the authenticated session, never from
 * request params, so a high-privilege cookie (enterprise admin / platform admin)
 * browsing its own workbench is pinned to its own jobs instead of widening to the
 * whole tenant or platform. Without a resolvable owner the call fails closed
 * (`null`) rather than falling back to a broader scope.
 */
async function resolveCronScope(params: {
  client: GatewayClient | null;
  ownerScope: CronOwnerScopeParam;
  respond: RespondFn;
}): Promise<CronScope | null> {
  const base = await resolveQueryScope(params.client);
  // Employee workbench sessions already resolve to self via resolveQueryScope;
  // still force the personal narrowing path so ownership attribution is required
  // and a missing owner fails closed instead of silently widening.
  const effectiveOwnerScope: CronOwnerScopeParam =
    params.ownerScope === "personal" || params.client?.sessionDomain === "employee"
      ? "personal"
      : params.ownerScope;
  if (effectiveOwnerScope !== "personal") {
    return {
      base,
      isVisible: (ownership) => isRecordVisibleToScope(ownership, base),
      unrestricted: base.kind === "platform",
    };
  }
  const attribution = await resolveTrustedAttribution(params.client);
  const personalOwnerId = attribution.ownerId?.trim();
  if (!personalOwnerId) {
    // A real session that cannot be attributed must fail closed. A local
    // single-operator gateway has no platform-auth identity at all, and locking
    // it out of its own cron page would be a false positive, so it keeps the
    // resolved (platform) scope instead.
    if (!isAuthenticatedSession(params.client)) {
      return {
        base,
        isVisible: (ownership) => isRecordVisibleToScope(ownership, base),
        unrestricted: base.kind === "platform",
      };
    }
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "personal cron scope requires an identified user"),
    );
    return null;
  }
  const ownerScopeCheck: QueryScope = { kind: "self", ownerId: personalOwnerId };
  return {
    base,
    personalOwnerId,
    // Intersection: the record must satisfy the session scope AND be owned by
    // the caller. Never a plain replacement, which would drop the tenant bound.
    isVisible: (ownership) =>
      isRecordVisibleToScope(ownership, ownerScopeCheck) &&
      (base.kind === "platform" || isRecordVisibleToScope(ownership, base)),
    unrestricted: false,
  };
}

/**
 * Authorize a cron operation on a single job (update/remove/run/runs) against the
 * caller's effective scope. Platform scope may operate on any job; tenant/self
 * scopes may only touch jobs they own. Missing jobs pass through so the
 * underlying op reports "not found" instead of leaking existence.
 */
async function authorizeCronJobMutation(params: {
  jobId: string;
  context: GatewayRequestContext;
  client: GatewayClient | null;
  respond: RespondFn;
  ownerScope?: CronOwnerScopeParam;
  /**
   * Deny instead of passing through when the job no longer exists. Reads of
   * per-job history use this: run logs outlive the job (`deleteAfterRun`), so a
   * missing job must not become an unauthenticated window into that history.
   */
  requireExistingJob?: boolean;
  /** Already-resolved scope, to avoid a second identity/store resolution. */
  resolvedScope?: CronScope;
}): Promise<boolean> {
  const scope =
    params.resolvedScope ??
    (await resolveCronScope({
      client: params.client,
      ownerScope: params.ownerScope,
      respond: params.respond,
    }));
  if (!scope) {
    return false;
  }
  if (scope.unrestricted) {
    return true;
  }
  const job = params.context.cron.getJob(params.jobId);
  const denied = job ? !scope.isVisible(job.ownership) : params.requireExistingJob === true;
  if (denied) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "not authorized for this cron job"),
    );
    return false;
  }
  return true;
}

export const cronHandlers: GatewayRequestHandlers = {
  wake: ({ params, respond, context }) => {
    if (!validateWakeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      mode: "now" | "next-heartbeat";
      text: string;
    };
    const result = context.cron.wake({ mode: p.mode, text: p.text });
    respond(true, result, undefined);
  },
  "cron.list": async ({ params, respond, context, client }) => {
    if (!validateCronListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      includeDisabled?: boolean;
      limit?: number;
      offset?: number;
      query?: string;
      enabled?: "all" | "enabled" | "disabled";
      sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
      sortDir?: "asc" | "desc";
      ownerScope?: CronOwnerScopeParam;
    };
    // Tenant/owner scope (task 2.6): platform sees all; enterprise/employee
    // sessions see only their own jobs (server-enforced, never trusts params).
    // `ownerScope: "personal"` narrows any session to its own jobs.
    const cronScope = await resolveCronScope({ client, ownerScope: p.ownerScope, respond });
    if (!cronScope) {
      return;
    }
    const page = await context.cron.listPage({
      includeDisabled: p.includeDisabled,
      limit: p.limit,
      offset: p.offset,
      query: p.query,
      enabled: p.enabled,
      sortBy: p.sortBy,
      sortDir: p.sortDir,
      scopeVisible: cronScope.unrestricted ? undefined : cronScope.isVisible,
    });
    const jobs = await attachProgressToCronJobs(page.jobs, {
      cronStorePath: context.cronStorePath,
    });
    respond(true, { ...page, jobs }, undefined);
  },
  "cron.status": async ({ params, respond, context }) => {
    if (!validateCronStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
        ),
      );
      return;
    }
    const status = await context.cron.status();
    respond(true, status, undefined);
  },
  "cron.add": async ({ params, respond, context, client }) => {
    const normalized = normalizeCronJobCreate(params) ?? params;
    if (!validateCronAddParams(normalized)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
        ),
      );
      return;
    }
    const jobCreate = normalized as unknown as CronJobCreate;
    // Stamp tenant/owner attribution from the authenticated session (task 2.6).
    // Never accepted from the client; absent attribution = platform-global job.
    const attribution = await resolveTrustedAttribution(client);
    if (attribution.tenantId || attribution.ownerId) {
      jobCreate.ownership = attribution;
    }
    const timestampValidation = validateScheduleTimestamp(jobCreate.schedule);
    if (!timestampValidation.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
      );
      return;
    }
    const job = await context.cron.add(jobCreate);
    context.logGateway.info("cron: job created", { jobId: job.id, schedule: jobCreate.schedule });
    respond(true, job, undefined);
  },
  "cron.update": async ({ params, respond, context, client }) => {
    const normalizedPatch = normalizeCronJobPatch((params as { patch?: unknown } | null)?.patch);
    const candidate =
      normalizedPatch && typeof params === "object" && params !== null
        ? { ...params, patch: normalizedPatch }
        : params;
    if (!validateCronUpdateParams(candidate)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = candidate as {
      id?: string;
      jobId?: string;
      patch: Record<string, unknown>;
      ownerScope?: CronOwnerScopeParam;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.update params: missing id"),
      );
      return;
    }
    if (
      !(await authorizeCronJobMutation({
        jobId,
        context,
        client,
        respond,
        ownerScope: p.ownerScope,
      }))
    ) {
      return;
    }
    const patch = p.patch as unknown as CronJobPatch;
    if (patch.schedule) {
      const timestampValidation = validateScheduleTimestamp(patch.schedule);
      if (!timestampValidation.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
        );
        return;
      }
    }
    const job = await context.cron.update(jobId, patch);
    context.logGateway.info("cron: job updated", { jobId });
    respond(true, job, undefined);
  },
  "cron.remove": async ({ params, respond, context, client }) => {
    if (!validateCronRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; ownerScope?: CronOwnerScopeParam };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.remove params: missing id"),
      );
      return;
    }
    if (
      !(await authorizeCronJobMutation({
        jobId,
        context,
        client,
        respond,
        ownerScope: p.ownerScope,
      }))
    ) {
      return;
    }
    const result = await context.cron.remove(jobId);
    if (result.removed) {
      context.logGateway.info("cron: job removed", { jobId });
    }
    respond(true, result, undefined);
  },
  "cron.run": async ({ params, respond, context, client }) => {
    if (!validateCronRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      id?: string;
      jobId?: string;
      mode?: "due" | "force";
      ownerScope?: CronOwnerScopeParam;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.run params: missing id"),
      );
      return;
    }
    // Triggering someone else's job is a mutation of their schedule, so it takes
    // the same owner authorization as update/remove.
    if (
      !(await authorizeCronJobMutation({
        jobId,
        context,
        client,
        respond,
        ownerScope: p.ownerScope,
      }))
    ) {
      return;
    }
    const result = await context.cron.enqueueRun(jobId, p.mode ?? "force");
    respond(true, result, undefined);
  },
  "cron.runs": async ({ params, respond, context, client }) => {
    if (!validateCronRunsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      scope?: "job" | "all";
      ownerScope?: CronOwnerScopeParam;
      id?: string;
      jobId?: string;
      limit?: number;
      offset?: number;
      statuses?: Array<"ok" | "error" | "skipped">;
      status?: "all" | "ok" | "error" | "skipped";
      deliveryStatuses?: Array<"delivered" | "not-delivered" | "unknown" | "not-requested">;
      deliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
      query?: string;
      sortDir?: "asc" | "desc";
    };
    const explicitScope = p.scope;
    const jobId = p.id ?? p.jobId;
    const scope: "job" | "all" = explicitScope ?? (jobId ? "job" : "all");
    if (scope === "job" && !jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: missing id"),
      );
      return;
    }
    const queryScope = await resolveCronScope({ client, ownerScope: p.ownerScope, respond });
    if (!queryScope) {
      return;
    }
    if (scope === "all") {
      const jobs = await context.cron.list({ includeDisabled: true });
      const visibleJobs = queryScope.unrestricted
        ? jobs
        : jobs.filter((job) => queryScope.isVisible(job.ownership));
      const jobNameById = Object.fromEntries(
        visibleJobs
          .filter((job) => typeof job.id === "string" && typeof job.name === "string")
          .map((job) => [job.id, job.name]),
      );
      const page = await readCronRunLogEntriesPageAll({
        storePath: context.cronStorePath,
        limit: p.limit,
        offset: p.offset,
        statuses: p.statuses,
        status: p.status,
        deliveryStatuses: p.deliveryStatuses,
        deliveryStatus: p.deliveryStatus,
        query: p.query,
        sortDir: p.sortDir,
        jobNameById,
        // Scoped callers must not read other owners' run history. Platform stays
        // unrestricted so it still sees history whose job was already deleted.
        ...(queryScope.unrestricted ? {} : { allowedJobIds: visibleJobs.map((job) => job.id) }),
      });
      respond(true, page, undefined);
      return;
    }
    if (
      !(await authorizeCronJobMutation({
        jobId: jobId as string,
        context,
        client,
        respond,
        ownerScope: p.ownerScope,
        // Run logs outlive their job (`deleteAfterRun`), so an unknown id must be
        // refused rather than treated as "not found yet readable".
        requireExistingJob: true,
        resolvedScope: queryScope,
      }))
    ) {
      return;
    }
    let logPath: string;
    try {
      logPath = resolveCronRunLogPath({
        storePath: context.cronStorePath,
        jobId: jobId as string,
      });
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: invalid id"),
      );
      return;
    }
    const page = await readCronRunLogEntriesPage(logPath, {
      limit: p.limit,
      offset: p.offset,
      jobId: jobId as string,
      statuses: p.statuses,
      status: p.status,
      deliveryStatuses: p.deliveryStatuses,
      deliveryStatus: p.deliveryStatus,
      query: p.query,
      sortDir: p.sortDir,
    });
    respond(true, page, undefined);
  },
  "cron.taskTemplates.list": async ({ params, respond, client }) => {
    if (!validateCronTaskTemplatesListParams(params ?? {})) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.taskTemplates.list params: ${formatValidationErrors(validateCronTaskTemplatesListParams.errors)}`,
        ),
      );
      return;
    }
    const scope = await resolveQueryScope(client);
    if (scope.kind !== "tenant") {
      respond(true, { templates: [] }, undefined);
      return;
    }
    const templates = await listTeamCronTaskTemplates(scope.tenantId);
    respond(true, { templates }, undefined);
  },
  "cron.taskTemplates.save": async ({ params, respond, client }) => {
    if (!validateCronTaskTemplatesSaveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.taskTemplates.save params: ${formatValidationErrors(validateCronTaskTemplatesSaveParams.errors)}`,
        ),
      );
      return;
    }
    const scope = await resolveQueryScope(client);
    if (scope.kind !== "tenant") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "team templates require tenant scope"),
      );
      return;
    }
    const template = params.template;
    if (!template || typeof template.id !== "string" || typeof template.name !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid template payload"));
      return;
    }
    const saved = await upsertTeamCronTaskTemplate({
      tenantId: scope.tenantId,
      template: {
        id: template.id,
        name: template.name,
        summary: typeof template.summary === "string" ? template.summary : "",
        category: typeof template.category === "string" ? template.category : "other",
        intentText: typeof template.intentText === "string" ? template.intentText : "",
        goal: typeof template.goal === "string" ? template.goal : "",
        acceptanceRules: Array.isArray(template.acceptanceRules)
          ? template.acceptanceRules.filter((entry): entry is string => typeof entry === "string")
          : [],
        schedulePreset:
          typeof template.schedulePreset === "string" ? template.schedulePreset : "daily",
        dailyTime: typeof template.dailyTime === "string" ? template.dailyTime : "09:00",
        weeklyDay: typeof template.weeklyDay === "string" ? template.weeklyDay : undefined,
        monthlyDay: typeof template.monthlyDay === "string" ? template.monthlyDay : undefined,
        suggestedAgents: Array.isArray(template.suggestedAgents)
          ? template.suggestedAgents.filter((entry): entry is string => typeof entry === "string")
          : [],
        suggestedGroups: Array.isArray(template.suggestedGroups)
          ? template.suggestedGroups.filter((entry): entry is string => typeof entry === "string")
          : [],
        priority: typeof template.priority === "string" ? template.priority : undefined,
        dataBindings: normalizeCronDataBindings(template.dataBindings),
      },
    });
    respond(true, { template: saved }, undefined);
  },
  "cron.taskTemplates.delete": async ({ params, respond, client }) => {
    if (!validateCronTaskTemplatesDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.taskTemplates.delete params: ${formatValidationErrors(validateCronTaskTemplatesDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const scope = await resolveQueryScope(client);
    if (scope.kind !== "tenant") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "team templates require tenant scope"),
      );
      return;
    }
    const id = params.id;
    if (typeof id !== "string" || !id.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "template id required"));
      return;
    }
    const deleted = await deleteTeamCronTaskTemplate({
      tenantId: scope.tenantId,
      templateId: id.trim(),
    });
    respond(true, { deleted }, undefined);
  },
};
