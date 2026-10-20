import type { ControlUiPlatformTrialApplicationSummary } from "../control-ui-contract.js";
import type {
  PlatformAuthPlatformPolicy,
  PlatformAuthStore,
  PlatformAuthTrialApplication,
  PlatformTrialApplicationStatus,
} from "./store-types.js";

export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_TRIAL_DAY_OPTIONS = [5, 10, 14, 30];
export const DEFAULT_TRIAL_SEATS = 5;
export const DEFAULT_TRIAL_SEAT_OPTIONS = [1, 3, 5, 10];
/** 平台为单个试用租户定制席位数时的上限（含和君咨询 500 档）。 */
export const MAX_CUSTOM_TRIAL_SEATS = 10_000;
export const DEFAULT_SEAT_ASSIGNMENT_OFFER_TTL_DAYS = 7;
export const TRIAL_APPLICATION_HISTORY_LIMIT = 50;

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // invalid URL
  }
  return undefined;
}

export function createDefaultPolicy(nowIso = new Date().toISOString()): PlatformAuthPlatformPolicy {
  return {
    defaultTrialDays: DEFAULT_TRIAL_DAYS,
    allowedTrialDays: [...DEFAULT_TRIAL_DAY_OPTIONS],
    defaultTrialSeatCount: DEFAULT_TRIAL_SEATS,
    trialSeatOptions: [...DEFAULT_TRIAL_SEAT_OPTIONS],
    allowCustomTrialSeatCount: true,
    trialExpiryPolicy: "choose",
    trialExpiryHandling: "auto_stop",
    trialGraceDays: 0,
    updatedAt: nowIso,
  };
}

function normalizeTrialExpiryHandling(
  value: unknown,
  fallback: PlatformAuthPlatformPolicy["trialExpiryHandling"],
): PlatformAuthPlatformPolicy["trialExpiryHandling"] {
  return value === "auto_stop" || value === "read_only" || value === "grace_period"
    ? value
    : fallback;
}

function normalizeGraceDays(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

function normalizePolicy(
  policy: PlatformAuthPlatformPolicy | undefined,
): PlatformAuthPlatformPolicy {
  const fallback = createDefaultPolicy();
  const allowedTrialDays = Array.from(
    new Set(
      (policy?.allowedTrialDays ?? fallback.allowedTrialDays)
        .map((value) => normalizePositiveInt(value) ?? 0)
        .filter((value) => value > 0),
    ),
  ).toSorted((left, right) => left - right);
  const trialSeatOptions = Array.from(
    new Set(
      (policy?.trialSeatOptions ?? fallback.trialSeatOptions)
        .map((value) => normalizePositiveInt(value) ?? 0)
        .filter((value) => value > 0),
    ),
  ).toSorted((left, right) => left - right);
  const defaultTrialDays =
    normalizePositiveInt(policy?.defaultTrialDays) ??
    allowedTrialDays[0] ??
    fallback.defaultTrialDays;
  const defaultTrialSeatCount =
    normalizePositiveInt(policy?.defaultTrialSeatCount) ??
    trialSeatOptions[0] ??
    fallback.defaultTrialSeatCount;
  return {
    defaultTrialDays,
    allowedTrialDays: allowedTrialDays.length > 0 ? allowedTrialDays : fallback.allowedTrialDays,
    defaultTrialSeatCount,
    trialSeatOptions: trialSeatOptions.length > 0 ? trialSeatOptions : fallback.trialSeatOptions,
    allowCustomTrialSeatCount: policy?.allowCustomTrialSeatCount !== false,
    trialExpiryPolicy:
      policy?.trialExpiryPolicy === "redirect_to_upgrade" ||
      policy?.trialExpiryPolicy === "redirect_to_sales" ||
      policy?.trialExpiryPolicy === "choose"
        ? policy.trialExpiryPolicy
        : fallback.trialExpiryPolicy,
    trialExpiryHandling: normalizeTrialExpiryHandling(
      policy?.trialExpiryHandling,
      fallback.trialExpiryHandling,
    ),
    trialGraceDays: normalizeGraceDays(policy?.trialGraceDays, fallback.trialGraceDays),
    ...(cleanUrl(policy?.upgradeUrl) ? { upgradeUrl: cleanUrl(policy?.upgradeUrl) } : {}),
    ...(cleanUrl(policy?.contactAdvisorUrl)
      ? { contactAdvisorUrl: cleanUrl(policy?.contactAdvisorUrl) }
      : {}),
    updatedAt:
      typeof policy?.updatedAt === "string" && policy.updatedAt.trim()
        ? policy.updatedAt
        : fallback.updatedAt,
  };
}

function inferTrialApplicationStatus(
  application: PlatformAuthTrialApplication,
): PlatformTrialApplicationStatus {
  if (application.status === "pending" || application.status === "rejected") {
    return application.status;
  }
  if (application.status === "approved" || application.status === "converted") {
    return application.status;
  }
  if (application.mode === "manual" && !application.enterpriseId) {
    return "pending";
  }
  return "converted";
}

function toTrialApplicationSummary(
  store: PlatformAuthStore,
  application: PlatformAuthTrialApplication,
): ControlUiPlatformTrialApplicationSummary {
  const reviewer = application.reviewedByPlatformUserId
    ? store.users[application.reviewedByPlatformUserId]
    : undefined;
  return {
    id: application.id,
    companyName: application.companyName,
    contactName: application.contactName,
    workEmail: application.workEmail,
    expectedUsers: application.expectedUsers,
    useCase: application.useCase,
    ...(application.companySize ? { companySize: application.companySize } : {}),
    ...(application.industry ? { industry: application.industry } : {}),
    needsDemo: application.needsDemo,
    mode: application.mode,
    highIntentLead: application.highIntentLead,
    reviewReasons: [...application.reviewReasons],
    status: application.status,
    ...(application.reviewedAt ? { reviewedAt: application.reviewedAt } : {}),
    ...(reviewer?.email ? { reviewedBy: reviewer.email } : {}),
    ...(application.reviewNote ? { reviewNote: application.reviewNote } : {}),
    ...(application.rejectionReason ? { rejectionReason: application.rejectionReason } : {}),
    ...(application.enterpriseId ? { enterpriseId: application.enterpriseId } : {}),
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

export function buildPlatformTrialApplicationsView(
  store: PlatformAuthStore,
): ControlUiPlatformTrialApplicationSummary[] {
  const applications = Object.values(store.trialApplications);
  const pending = applications
    .filter((entry) => entry.status === "pending")
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const history = applications
    .filter((entry) => entry.status !== "pending")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, TRIAL_APPLICATION_HISTORY_LIMIT);
  return [...pending, ...history].map((application) =>
    toTrialApplicationSummary(store, application),
  );
}

export { normalizePolicy, inferTrialApplicationStatus };
