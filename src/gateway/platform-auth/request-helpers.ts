/**
 * Pure request-parsing / validation / normalization helpers for platform auth
 * HTTP handlers. Extracted from the platform-auth monolith (decomposition Task 5.13).
 *
 * Framework-free and side-effect-free: no store mutation, no IO. Behavior is
 * preserved verbatim from the monolith (same regexes, limits, and defaults).
 */

import type { PlatformAuthPlatformPolicy, PlatformTrialApplyMode } from "./store-types.js";
import { createDefaultPolicy, MAX_CUSTOM_TRIAL_SEATS } from "./trial-policy.js";

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeTenantName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  return name.slice(0, 120);
}

export function cleanUrl(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return raw.slice(0, 2000);
    }
  } catch {
    // fallthrough
  }
  return undefined;
}

export function normalizePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

export function toTrialDays(policy: PlatformAuthPlatformPolicy, value: unknown): number {
  const requested = normalizePositiveInt(value);
  if (!requested) {
    return policy.defaultTrialDays;
  }
  if (policy.allowedTrialDays.includes(requested)) {
    return requested;
  }
  return policy.defaultTrialDays;
}

export function toTrialSeats(policy: PlatformAuthPlatformPolicy, value: unknown): number {
  const requested = normalizePositiveInt(value);
  if (!requested) {
    return policy.defaultTrialSeatCount;
  }
  if (policy.trialSeatOptions.includes(requested)) {
    return requested;
  }
  // 平台可为不同试用租户个性化席位数；选项表只是常用档，不是上限。
  if (policy.allowCustomTrialSeatCount) {
    return Math.min(requested, MAX_CUSTOM_TRIAL_SEATS);
  }
  return policy.defaultTrialSeatCount;
}

export function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function requiredStringList(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .join(" / ")
      .slice(0, 400);
  }
  return requiredString(value);
}

function isObjectRecord(body: unknown): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.getPrototypeOf(body) === Object.prototype
  );
}

export function parseRequestBody(body: unknown): Record<string, unknown> | null {
  return isObjectRecord(body) ? body : null;
}

export function normalizePassword(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDisplayName(value: unknown, emailFallback: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name && !isValidEmail(name) && !name.includes("@")) {
    return name.slice(0, 80);
  }
  const fallback = isValidEmail(name) ? name : emailFallback;
  return (fallback.split("@")[0] || "User").slice(0, 80);
}

export function normalizeOptionalText(value: unknown, maxLength = 160): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : undefined;
}

export function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function parseExpectedUsers(value: unknown): number | null {
  const direct = normalizePositiveInt(value);
  if (direct) {
    return direct;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const plusMatch = normalized.match(/^(\d+)\s*\+$/);
  if (plusMatch) {
    return Number.parseInt(plusMatch[1] ?? "0", 10) + 1;
  }
  const rangeMatch = normalized.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
  if (rangeMatch) {
    return Number.parseInt(rangeMatch[2] ?? "0", 10);
  }
  return null;
}

function getEmailDomain(email: string): string {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "126.com",
  "163.com",
  "aol.com",
  "foxmail.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "outlook.com",
  "qq.com",
  "sina.com",
  "sohu.com",
  "yahoo.com",
]);

const LARGE_ACCOUNT_KEYWORDS = [
  "bank",
  "government",
  "group",
  "holding",
  "insurance",
  "ministry",
  "telecom",
  "university",
  "证券",
  "保险",
  "医院",
  "大学",
  "政府",
  "控股",
  "航空",
  "集团",
  "银行",
] as const;

export function isEnterpriseEmail(email: string): boolean {
  const domain = getEmailDomain(email);
  return Boolean(domain) && !PERSONAL_EMAIL_DOMAINS.has(domain);
}

function isLikelyLargeEnterpriseName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return LARGE_ACCOUNT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function decideTrialApplyMode(params: {
  companyName: string;
  workEmail: string;
  expectedUsers: number;
  needsDemo: boolean;
}): { mode: PlatformTrialApplyMode; highIntentLead: boolean; reviewReasons: string[] } {
  const reasons: string[] = [];
  if (!isEnterpriseEmail(params.workEmail)) {
    reasons.push("free_email");
  }
  if (params.expectedUsers > 50) {
    reasons.push("large_team");
  }
  if (isLikelyLargeEnterpriseName(params.companyName)) {
    reasons.push("large_account_name");
  }
  if (reasons.length > 0) {
    return { mode: "manual", highIntentLead: true, reviewReasons: reasons };
  }
  if (isEnterpriseEmail(params.workEmail) && params.expectedUsers <= 20 && !params.needsDemo) {
    return { mode: "auto", highIntentLead: false, reviewReasons: [] };
  }
  return {
    mode: "auto_with_sales",
    highIntentLead: true,
    reviewReasons: params.needsDemo ? ["needs_demo"] : ["mid_market_team"],
  };
}

export function normalizePolicy(
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
    trialExpiryHandling:
      policy?.trialExpiryHandling === "auto_stop" ||
      policy?.trialExpiryHandling === "read_only" ||
      policy?.trialExpiryHandling === "grace_period"
        ? policy.trialExpiryHandling
        : fallback.trialExpiryHandling,
    trialGraceDays:
      typeof policy?.trialGraceDays === "number" &&
      Number.isFinite(policy.trialGraceDays) &&
      policy.trialGraceDays >= 0
        ? Math.floor(policy.trialGraceDays)
        : fallback.trialGraceDays,
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

export function assertStrongPassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}
