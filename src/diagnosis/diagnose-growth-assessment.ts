/**
 * Read-only growth facts for a diagnose target.
 * File existence, template state, mtimes, skill ids, and cron names only.
 * Never copies chat bodies, tool output, or file text into the assessment.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  readWorkspaceIdentityGapLabels,
  resolveWorkspaceIdentityBootstrapState,
} from "../agents/identity-file.js";
import { resolveDefaultSessionStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { readSkillInvocationEvents } from "../gateway/skill-invocation/event-store.js";
import type { SkillInvocationEvent } from "../gateway/skill-invocation/types.js";
import { extractDiagnoseSpaceGroupId } from "./diagnose-policy.js";
import { memoryMayBeJudgedMissing } from "./diagnose-professional-protocol.js";

export const DIAGNOSE_GROWTH_UNOBSERVED = "本窗未观察到";

export type DiagnoseGrowthIdentity = {
  readable: boolean;
  bootstrapPending: boolean;
  identityInitialized: boolean;
  userInitialized: boolean;
};

export type DiagnoseGrowthMemory = {
  present: boolean;
  fresh: boolean;
};

export type DiagnoseGrowthJobRef = {
  id: string;
  name: string;
  agentId?: string;
  tenantId?: string;
  ownerId?: string;
};

export type DiagnoseGrowthAssessment = {
  agentId: string;
  tenantId: string | null;
  agentAssetId: string | null;
  targetOwnerId: string | null;
  groupId: string | null;
  objectLabel: string;
  displayName: string | null;
  identity: DiagnoseGrowthIdentity;
  memory: DiagnoseGrowthMemory;
  hadTaskActivity: boolean;
  /** True only when this window had task activity and memory files are stale. */
  memoryJudgedMissing: boolean;
  /** Skill ids with at least one success and no failure. Not "已会". */
  capable: string[];
  /** Skill ids with failure or timeout evidence. Not a free-form gap. */
  unstable: string[];
  /** Installed skills with no invocation in this window. Not "缺失". */
  unused: string[];
  /** Role baseline minus installed skills. Never inferred by the model. */
  baselineGapCandidates: string[];
  existingJobNames: string[];
  identityMissingFields: string[];
  userMissingFields: string[];
  installedSkillIds: string[];
  memoryFileCount: number;
  reportFileCount: number;
  freshArtifactCount: number;
  sessionRoster: DiagnoseSessionRoster;
  activitySources: DiagnoseGrowthActivitySource[];
  roleBaselineInjected: boolean;
  /** Last invocation time per skill id, including outside this window. */
  skillLastSeenMs: Record<string, number>;
};

export type DiagnoseGrowthActivitySource =
  | "skill_invocation"
  | "memory_file"
  | "report_file"
  | "cron_session";

export type DiagnoseSessionRoster = {
  main: number;
  cron: number;
  other: number;
  freshCron: number;
  freshMain: number;
};

export type DiagnoseGrowthFacts = {
  identity: DiagnoseGrowthIdentity | null;
  identityMissingFields: string[];
  userMissingFields: string[];
  memoryFiles: Array<{ name: string; mtimeMs: number }>;
  reportFiles: Array<{ name: string; mtimeMs: number }>;
  installedSkillIds: string[];
};

const EMPTY_IDENTITY: DiagnoseGrowthIdentity = {
  readable: false,
  bootstrapPending: false,
  identityInitialized: false,
  userInitialized: false,
};

export function diagnoseGrowthObjectLabel(agentId: string, sessionKey: string): string {
  const groupId = extractDiagnoseSpaceGroupId(sessionKey);
  if (groupId) {
    return `协作小组 ${groupId}`;
  }
  return agentId.trim() || "当前对象";
}

const EMPTY_FACTS: DiagnoseGrowthFacts = {
  identity: null,
  identityMissingFields: [],
  userMissingFields: [],
  memoryFiles: [],
  reportFiles: [],
  installedSkillIds: [],
};

const EMPTY_ROSTER: DiagnoseSessionRoster = {
  main: 0,
  cron: 0,
  other: 0,
  freshCron: 0,
  freshMain: 0,
};

export function readWorkspaceGrowthFacts(workspaceDir: string): DiagnoseGrowthFacts {
  if (!isCanonicalWorkspaceDir(workspaceDir)) {
    return EMPTY_FACTS;
  }
  const identity = resolveWorkspaceIdentityBootstrapState(workspaceDir);
  const gaps = readWorkspaceIdentityGapLabels(workspaceDir);
  return {
    identity: {
      readable: true,
      bootstrapPending: identity.bootstrapPending,
      identityInitialized: identity.identityInitialized,
      userInitialized: identity.userInitialized,
    },
    identityMissingFields: gaps.identity,
    userMissingFields: gaps.user,
    memoryFiles: listNamedFileStats(workspaceDir, "memory", [".md"]),
    reportFiles: listNamedFileStats(workspaceDir, "reports", [".md", ".json"]),
    installedSkillIds: listInstalledSkillIds(workspaceDir),
  };
}

export function readDiagnoseSessionRoster(input: {
  agentId: string;
  windowMs: number;
  nowMs: number;
}): DiagnoseSessionRoster {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return EMPTY_ROSTER;
  }
  try {
    const store = loadSessionStore(resolveDefaultSessionStorePath(agentId), { skipCache: true });
    const since = input.nowMs - Math.max(0, input.windowMs);
    const roster: DiagnoseSessionRoster = { ...EMPTY_ROSTER };
    for (const [key, entry] of Object.entries(store)) {
      const kind = classifySessionKey(agentId, key);
      roster[kind] += 1;
      const updatedAt = typeof entry?.updatedAt === "number" ? entry.updatedAt : 0;
      if (updatedAt < since) {
        continue;
      }
      if (kind === "cron") {
        roster.freshCron += 1;
      }
      if (kind === "main") {
        roster.freshMain += 1;
      }
    }
    return roster;
  } catch {
    return EMPTY_ROSTER;
  }
}

export function assessDiagnoseGrowth(input: {
  agentId: string;
  sessionKey: string;
  windowMs: number;
  nowMs?: number;
  tenantId?: string | null;
  agentAssetId?: string | null;
  targetOwnerId?: string | null;
  displayName?: string | null;
  hadTaskActivity?: boolean;
  roleBaselineSkillIds?: string[];
  identity?: DiagnoseGrowthIdentity | null;
  identityMissingFields?: string[];
  userMissingFields?: string[];
  memoryFiles?: Array<{ name: string; mtimeMs: number }>;
  reportFiles?: Array<{ name: string; mtimeMs: number }>;
  installedSkillIds?: string[];
  skillEvents?: readonly SkillInvocationEvent[];
  existingJobs?: readonly DiagnoseGrowthJobRef[];
  sessionRoster?: DiagnoseSessionRoster;
  roleBaselineInjected?: boolean;
  skillLastSeenMs?: Record<string, number>;
}): DiagnoseGrowthAssessment {
  const nowMs = input.nowMs ?? Date.now();
  const since = nowMs - Math.max(0, input.windowMs);
  const agentId = input.agentId.trim();
  const tenantId = input.tenantId?.trim() || null;
  const groupId = extractDiagnoseSpaceGroupId(input.sessionKey);
  const installed = unique(input.installedSkillIds ?? []);
  const counts = new Map<string, { success: number; failure: number }>();
  const lastSeen = new Map<string, number>(
    Object.entries(input.skillLastSeenMs ?? {}).map(([id, at]) => [id, at]),
  );
  let observed = 0;
  for (const event of input.skillEvents ?? []) {
    if (event.agentId !== agentId) {
      continue;
    }
    if (tenantId && event.tenantId && event.tenantId !== tenantId) {
      continue;
    }
    const at = event.type === "skill_invocation_completed" ? event.completedAt : event.startedAt;
    const prev = lastSeen.get(event.skillId) ?? 0;
    if (at > prev) {
      lastSeen.set(event.skillId, at);
    }
    if (at < since) {
      continue;
    }
    observed += 1;
    if (event.type !== "skill_invocation_completed") {
      continue;
    }
    const row = counts.get(event.skillId) ?? { success: 0, failure: 0 };
    if (event.outcome === "success") {
      row.success += 1;
    } else if (event.outcome === "failure") {
      row.failure += 1;
    }
    counts.set(event.skillId, row);
  }
  const capable: string[] = [];
  const unstable: string[] = [];
  for (const [skillId, row] of counts) {
    if (row.failure > 0) {
      unstable.push(skillId);
    } else if (row.success > 0) {
      capable.push(skillId);
    }
  }
  const seen = new Set([...capable, ...unstable]);
  const unused = installed.filter((id) => !seen.has(id));
  const baselineGapCandidates = unique(input.roleBaselineSkillIds ?? []).filter(
    (id) => !installed.includes(id),
  );
  const memoryFiles = input.memoryFiles ?? [];
  const reportFiles = input.reportFiles ?? [];
  const freshMemory = memoryFiles.filter((file) => file.mtimeMs >= since);
  const freshReports = reportFiles.filter((file) => file.mtimeMs >= since);
  const sessionRoster = input.sessionRoster ?? EMPTY_ROSTER;
  const activitySources: DiagnoseGrowthActivitySource[] = [];
  if (observed > 0) {
    activitySources.push("skill_invocation");
  }
  if (freshMemory.length > 0) {
    activitySources.push("memory_file");
  }
  if (freshReports.length > 0) {
    activitySources.push("report_file");
  }
  if (sessionRoster.freshCron > 0) {
    activitySources.push("cron_session");
  }
  const fresh = freshMemory.length > 0;
  const hadTaskActivity = input.hadTaskActivity ?? activitySources.length > 0;
  const existingJobNames = (input.existingJobs ?? [])
    .filter((job) => !job.agentId || job.agentId === agentId)
    .filter((job) => !tenantId || !job.tenantId || job.tenantId === tenantId)
    .map((job) => job.name);
  const displayName = input.displayName?.trim() || null;
  return {
    agentId,
    tenantId,
    agentAssetId: input.agentAssetId?.trim() || null,
    targetOwnerId: input.targetOwnerId?.trim() || null,
    groupId,
    objectLabel: displayName ?? diagnoseGrowthObjectLabel(agentId, input.sessionKey),
    displayName,
    identity: input.identity ?? EMPTY_IDENTITY,
    memory: { present: memoryFiles.length > 0, fresh },
    hadTaskActivity,
    memoryJudgedMissing: memoryMayBeJudgedMissing({ hadTaskActivity, fresh }),
    capable: unique(capable),
    unstable: unique(unstable),
    unused,
    baselineGapCandidates,
    existingJobNames: unique(existingJobNames),
    identityMissingFields: unique(input.identityMissingFields ?? []),
    userMissingFields: unique(input.userMissingFields ?? []),
    installedSkillIds: installed,
    memoryFileCount: memoryFiles.length,
    reportFileCount: reportFiles.length,
    freshArtifactCount: freshMemory.length + freshReports.length,
    sessionRoster,
    activitySources,
    roleBaselineInjected: input.roleBaselineInjected === true,
    skillLastSeenMs: Object.fromEntries(lastSeen),
  };
}

export async function readDiagnoseGrowthAssessment(input: {
  agentId: string;
  sessionKey: string;
  windowMs: number;
  nowMs?: number;
  tenantId?: string | null;
  agentAssetId?: string | null;
  targetOwnerId?: string | null;
  displayName?: string | null;
  hadTaskActivity?: boolean;
  roleBaselineSkillIds?: string[];
  skillConfigDir?: string;
  workspaceDir?: string | null;
  skillEvents?: readonly SkillInvocationEvent[];
  scopedJobs?: readonly DiagnoseGrowthJobRef[];
}): Promise<DiagnoseGrowthAssessment> {
  const facts = input.workspaceDir
    ? safeWorkspaceFacts(input.workspaceDir)
    : { ...EMPTY_FACTS, identity: EMPTY_IDENTITY };
  let skillEvents = input.skillEvents ? [...input.skillEvents] : [];
  if (!input.skillEvents) {
    try {
      skillEvents = readSkillInvocationEvents({
        configDir: input.skillConfigDir,
        agentId: input.agentId,
        limit: 400,
      });
    } catch {
      skillEvents = [];
    }
  }
  const nowMs = input.nowMs ?? Date.now();
  return assessDiagnoseGrowth({
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    windowMs: input.windowMs,
    nowMs,
    tenantId: input.tenantId,
    agentAssetId: input.agentAssetId,
    targetOwnerId: input.targetOwnerId,
    displayName: input.displayName,
    hadTaskActivity: input.hadTaskActivity,
    roleBaselineSkillIds: input.roleBaselineSkillIds,
    roleBaselineInjected: input.roleBaselineSkillIds !== undefined,
    identity: facts.identity,
    identityMissingFields: facts.identityMissingFields,
    userMissingFields: facts.userMissingFields,
    memoryFiles: facts.memoryFiles,
    reportFiles: facts.reportFiles,
    installedSkillIds: facts.installedSkillIds,
    skillEvents,
    existingJobs: input.scopedJobs ?? [],
    sessionRoster: readDiagnoseSessionRoster({
      agentId: input.agentId,
      windowMs: input.windowMs,
      nowMs,
    }),
  });
}

export function growthContentFingerprint(assessment: DiagnoseGrowthAssessment): string {
  return createHash("sha256").update(JSON.stringify(assessment)).digest("hex").slice(0, 12);
}

function isCanonicalWorkspaceDir(workspaceDir: string): boolean {
  if (!workspaceDir.trim() || workspaceDir.includes("\0")) {
    return false;
  }
  if (workspaceDir.split(/[/\\]/).includes("..")) {
    return false;
  }
  try {
    const stat = fs.lstatSync(workspaceDir);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function safeWorkspaceFacts(workspaceDir: string): DiagnoseGrowthFacts {
  try {
    return readWorkspaceGrowthFacts(workspaceDir);
  } catch {
    return { ...EMPTY_FACTS, identity: EMPTY_IDENTITY };
  }
}

function classifySessionKey(agentId: string, sessionKey: string): "main" | "cron" | "other" {
  const key = sessionKey.toLowerCase();
  const prefix = `agent:${agentId.toLowerCase()}:`;
  if (key.includes(":cron:")) {
    return "cron";
  }
  if (key === `${prefix}main` || key.startsWith(`${prefix}main:`)) {
    return "main";
  }
  return "other";
}

function listNamedFileStats(
  workspaceDir: string,
  folder: string,
  suffixes: readonly string[],
): Array<{ name: string; mtimeMs: number }> {
  const root = path.join(workspaceDir, folder);
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(root);
  } catch {
    return [];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [];
  }
  const out: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of fs.readdirSync(root)) {
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      continue;
    }
    if (!suffixes.some((suffix) => name.endsWith(suffix))) {
      continue;
    }
    try {
      const stat = fs.lstatSync(path.join(root, name));
      if (stat.isSymbolicLink() || !stat.isFile()) {
        continue;
      }
      out.push({ name, mtimeMs: stat.mtimeMs });
    } catch {
      // skip unreadable names; never read file text
    }
  }
  return out;
}

function listInstalledSkillIds(workspaceDir: string): string[] {
  const root = path.join(workspaceDir, "skills");
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(root);
  } catch {
    return [];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      continue;
    }
    if (entry.name.includes("..") || entry.name.includes("/") || entry.name.includes("\\")) {
      continue;
    }
    const skillFile = path.join(root, entry.name, "SKILL.md");
    try {
      const stat = fs.lstatSync(skillFile);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        continue;
      }
      ids.push(entry.name);
    } catch {
      // missing skill file
    }
  }
  return unique(ids);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();
}
