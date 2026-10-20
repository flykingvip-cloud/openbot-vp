import {
  listAdminRecommendedCapabilities,
  summarizeAdoptionEvidence,
} from "./asset-incubation-adoption-store.js";
import {
  clusterSessionEventsForReview,
  listSessionEvents,
} from "./asset-incubation-session-store.js";
import { listPersonalSkillAssets } from "./skill-lifecycle-store.js";

export type WeeklyDigestEntryKind = "review" | "admin_recommend" | "organizational";

export type WeeklyDigestEntry = {
  id: string;
  kind: WeeklyDigestEntryKind;
  label: string;
  summary: string;
  capabilityId?: string;
  fingerprint?: string;
  recurrenceCount?: number;
};

export type WeeklyDigestResult = {
  weekKey: string;
  builtAt: number;
  headline: string;
  entries: WeeklyDigestEntry[];
};

export function weekStartMs(now: number): number {
  const date = new Date(now);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

export function buildWeeklyDigest(params: {
  ownerKey: string;
  now?: number;
  topLimit?: number;
  minRecurrence?: number;
}): WeeklyDigestResult {
  const now = params.now ?? Date.now();
  const ownerKey = params.ownerKey.trim().toLowerCase() || "local";
  const topLimit = params.topLimit ?? 8;
  const minRecurrence = params.minRecurrence ?? 3;
  const entries: WeeklyDigestEntry[] = [];

  const events = listSessionEvents(ownerKey);
  const clusters = clusterSessionEventsForReview(events).slice(0, topLimit);
  for (const cluster of clusters) {
    if (cluster.recurrenceCount < minRecurrence) {
      continue;
    }
    entries.push({
      id: `review:${cluster.fingerprint}`,
      kind: "review",
      label: cluster.label,
      summary: `「${cluster.label}」近期共出现 ${cluster.recurrenceCount} 次，值得沉淀为标准流程。`,
      fingerprint: cluster.fingerprint,
      recurrenceCount: cluster.recurrenceCount,
    });
  }

  for (const admin of listAdminRecommendedCapabilities({ ownerKey, now }).slice(0, 5)) {
    entries.push({
      id: `admin:${admin.capabilityId}`,
      kind: "admin_recommend",
      label: admin.capabilityName ?? admin.capabilityId,
      summary: "平台管理员已推荐为组织可用能力，建议完善并推广。",
      capabilityId: admin.capabilityId,
    });
  }

  for (const skill of listPersonalSkillAssets()) {
    const adoption = summarizeAdoptionEvidence({
      ownerKey,
      capabilityId: skill.id,
      now,
    });
    const meetsOrganizational =
      adoption.distinctMemberCount >= 3 ||
      adoption.sharedToGroup ||
      adoption.adminRecommended ||
      adoption.enterpriseSubmitted;
    if (!meetsOrganizational) {
      continue;
    }
    entries.push({
      id: `org:${skill.id}`,
      kind: "organizational",
      label: skill.profile.name,
      summary: "已具备组织级沉淀条件，可考虑提交企业资产库或继续推广复用。",
      capabilityId: skill.id,
    });
  }

  const deduped: WeeklyDigestEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    deduped.push(entry);
    if (deduped.length >= topLimit) {
      break;
    }
  }

  const headline =
    deduped.length === 0 ? "本周暂无新的资产回顾项" : `本周有 ${deduped.length} 项资产值得回顾`;

  return {
    weekKey: `week-${weekStartMs(now)}`,
    builtAt: now,
    headline,
    entries: deduped,
  };
}
