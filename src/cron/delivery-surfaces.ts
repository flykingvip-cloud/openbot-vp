import { parsePersonalCronTaskMetaRecord } from "./personal-task-meta.js";
import { CRON_DELIVERY_SURFACES, type CronDeliverySurface, type CronJob } from "./types.js";

const PERSONAL_TASK_META_MARKER = "<!--openbot-task-meta:";

function isCronDeliverySurface(value: string): value is CronDeliverySurface {
  return (CRON_DELIVERY_SURFACES as readonly string[]).includes(value);
}

export function normalizeCronDeliverySurfaces(raw: unknown): CronDeliverySurface[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const seen = new Set<CronDeliverySurface>();
  const surfaces: CronDeliverySurface[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !isCronDeliverySurface(entry.trim())) {
      continue;
    }
    const normalized = entry.trim() as CronDeliverySurface;
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    surfaces.push(normalized);
  }
  return surfaces.length > 0 ? surfaces : undefined;
}

/**
 * Resolve where cron results should appear in the employee workbench.
 * Explicit `delivery.surfaces` wins; otherwise infer from embedded task meta.
 */
/** Personal cron tasks with any external notify channel enabled in embedded meta. */
export function hasPersonalCronExternalNotify(job: CronJob): boolean {
  const meta = parsePersonalCronTaskMetaRecord(job.description);
  const notify = meta?.notify;
  if (!notify) {
    return false;
  }
  return Boolean(notify.wecom || notify.dingtalk || notify.email || notify.webhook);
}

export function hasPersonalCronTaskMeta(job: Pick<CronJob, "description">): boolean {
  return typeof job.description === "string" && job.description.includes(PERSONAL_TASK_META_MARKER);
}

export function isWorkbenchOnlyLegacyCronDelivery(job: CronJob): boolean {
  if (!hasPersonalCronTaskMeta(job) || hasPersonalCronExternalNotify(job)) {
    return false;
  }
  const delivery = job.delivery;
  if (!delivery || delivery.mode === "webhook") {
    return false;
  }
  const channel = typeof delivery.channel === "string" ? delivery.channel.trim().toLowerCase() : "";
  const hasExplicitExternalTarget =
    Boolean(delivery.to?.trim()) ||
    Boolean(delivery.accountId?.trim()) ||
    Boolean(delivery.failureDestination);
  if (hasExplicitExternalTarget) {
    return false;
  }
  if (channel && channel !== "last") {
    return false;
  }
  return resolveCronDeliverySurfaces(job).length > 0;
}

/**
 * Legacy personal tasks stored `delivery.mode=announce` + `channel:last` while only
 * requesting in-app workbench surfacing. Downgrade to mode=none with explicit surfaces.
 */
export function reconcileWorkbenchOnlyCronDelivery(job: CronJob): boolean {
  if (job.sessionTarget !== "isolated") {
    return false;
  }
  if (hasPersonalCronExternalNotify(job)) {
    return false;
  }
  const surfaces = resolveCronDeliverySurfaces(job);
  if (surfaces.length === 0) {
    return false;
  }
  const delivery = job.delivery;
  if (!delivery) {
    return false;
  }
  const mode = delivery.mode ?? "announce";
  if (mode !== "announce") {
    return false;
  }
  const channel = typeof delivery.channel === "string" ? delivery.channel.trim().toLowerCase() : "";
  const to = typeof delivery.to === "string" ? delivery.to.trim() : "";
  const accountId = typeof delivery.accountId === "string" ? delivery.accountId.trim() : "";
  const hasFailureDestination = Boolean(delivery.failureDestination);
  const usesLegacyWorkbenchOnlyChannel = !channel || channel === "last";
  const hasExplicitExternalTarget = Boolean(to) || Boolean(accountId) || hasFailureDestination;
  if (!usesLegacyWorkbenchOnlyChannel || hasExplicitExternalTarget) {
    return false;
  }
  const needsModeDowngrade = mode === "announce";
  const needsSurfaces = !delivery.surfaces?.length;
  if (!needsModeDowngrade && !needsSurfaces) {
    return false;
  }
  job.delivery = {
    ...delivery,
    mode: "none",
    channel: undefined,
    surfaces: delivery.surfaces?.length ? delivery.surfaces : surfaces,
  };
  return true;
}

export function resolveCronDeliverySurfaces(job: CronJob): CronDeliverySurface[] {
  const explicit = normalizeCronDeliverySurfaces(job.delivery?.surfaces);
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const meta = parsePersonalCronTaskMetaRecord(job.description);
  const surfaces: CronDeliverySurface[] = [];
  const inApp = meta?.notify?.inApp !== false;
  if (inApp) {
    surfaces.push("workbench-agent-main");
  }
  if ((meta?.selectedGroups?.length ?? 0) > 0 || job.sessionKey?.includes(":")) {
    surfaces.push("workbench-collab-group");
  }

  if (surfaces.length === 0 && job.sessionTarget === "isolated" && job.agentId?.trim()) {
    return ["workbench-agent-main"];
  }

  return surfaces;
}
