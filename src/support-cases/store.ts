import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type {
  SupportCase,
  SupportCaseCategory,
  SupportCaseContextBundle,
  SupportCaseRelatedEntities,
  SupportCaseResolutionProposal,
  SupportCaseStatus,
  SupportCaseSummary,
} from "../shared/daibai-types.js";

const SUPPORT_CASES_DIR = "support-cases";
const SUPPORT_CASES_FILE = "cases.json";

type SupportCaseStore = {
  cases: Record<string, SupportCase>;
};

function resolveSupportCasesFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), SUPPORT_CASES_DIR, SUPPORT_CASES_FILE);
}

async function loadStore(env: NodeJS.ProcessEnv = process.env): Promise<SupportCaseStore> {
  const filePath = resolveSupportCasesFilePath(env);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SupportCaseStore>;
    return {
      cases: parsed.cases ?? {},
    };
  } catch {
    return { cases: {} };
  }
}

async function saveStore(store: SupportCaseStore, env: NodeJS.ProcessEnv = process.env) {
  const filePath = resolveSupportCasesFilePath(env);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

function summarizeCase(input: SupportCase): SupportCaseSummary {
  return {
    caseId: input.caseId,
    category: input.category,
    status: input.status,
    userProblem: input.userProblem,
    userId: input.userId,
    tenantId: input.tenantId,
    updatedAtMs: input.updatedAtMs,
    currentProposalVersion: input.currentProposalVersion,
    proposalSeenByUserVersion: input.proposalSeenByUserVersion,
  };
}

function matchesSupportCaseFilters(
  entry: SupportCase,
  params?: {
    userId?: string;
    tenantId?: string;
    status?: SupportCaseStatus;
  },
) {
  if (params?.userId && entry.userId !== params.userId) {
    return false;
  }
  if (params?.tenantId && entry.tenantId !== params.tenantId) {
    return false;
  }
  if (params?.status && entry.status !== params.status) {
    return false;
  }
  return true;
}

function sortSupportCasesDescendingByUpdatedAt(cases: SupportCase[]) {
  return cases.toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function createSupportCase(params: {
  userId: string;
  tenantId?: string;
  sourceSessionKey?: string;
  category?: SupportCaseCategory;
  userProblem: string;
  daibaiSummary?: string;
  relatedEntities?: SupportCaseRelatedEntities;
  contextBundle: SupportCaseContextBundle;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCase> {
  const store = await loadStore(params.env);
  const now = Date.now();
  const caseId = `sc_${randomUUID()}`;
  const created: SupportCase = {
    caseId,
    userId: params.userId,
    tenantId: params.tenantId,
    sourceSessionKey: params.sourceSessionKey,
    category: params.category ?? "unknown",
    status: "open",
    userProblem: params.userProblem,
    daibaiSummary: params.daibaiSummary?.trim() || params.userProblem.trim(),
    contextBundle: params.contextBundle,
    relatedEntities: params.relatedEntities,
    createdAtMs: now,
    updatedAtMs: now,
  };
  store.cases[caseId] = created;
  await saveStore(store, params.env);
  return created;
}

export async function listSupportCases(params?: {
  userId?: string;
  tenantId?: string;
  status?: SupportCaseStatus;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCaseSummary[]> {
  const records = await listSupportCaseRecords(params);
  return records.map(summarizeCase);
}

export async function listSupportCaseRecords(params?: {
  userId?: string;
  tenantId?: string;
  status?: SupportCaseStatus;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCase[]> {
  const store = await loadStore(params?.env);
  return sortSupportCasesDescendingByUpdatedAt(
    Object.values(store.cases).filter((entry) => matchesSupportCaseFilters(entry, params)),
  );
}

export async function getSupportCase(
  caseId: string,
  env?: NodeJS.ProcessEnv,
): Promise<SupportCase | null> {
  const store = await loadStore(env);
  return store.cases[caseId] ?? null;
}

export async function resolveSupportCase(params: {
  caseId: string;
  platformAssignee?: string;
  platformNotes?: string;
  proposal: SupportCaseResolutionProposal;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCase | null> {
  const store = await loadStore(params.env);
  const current = store.cases[params.caseId];
  if (!current) {
    return null;
  }
  const updated: SupportCase = {
    ...current,
    status: "resolved",
    platformAssignee: params.platformAssignee ?? current.platformAssignee,
    platformNotes: params.platformNotes ?? current.platformNotes,
    resolutionProposal: params.proposal,
    currentProposalVersion: params.proposal.proposalVersion,
    updatedAtMs: Date.now(),
  };
  store.cases[params.caseId] = updated;
  await saveStore(store, params.env);
  return updated;
}

export async function closeSupportCase(params: {
  caseId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCase | null> {
  const store = await loadStore(params.env);
  const current = store.cases[params.caseId];
  if (!current) {
    return null;
  }
  const updated: SupportCase = {
    ...current,
    status: "closed",
    updatedAtMs: Date.now(),
  };
  store.cases[params.caseId] = updated;
  await saveStore(store, params.env);
  return updated;
}

export async function markSupportCaseReplySeen(params: {
  caseId: string;
  proposalVersion: number;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCase | null> {
  const store = await loadStore(params.env);
  const current = store.cases[params.caseId];
  if (!current) {
    return null;
  }
  if (
    !current.currentProposalVersion ||
    current.currentProposalVersion !== params.proposalVersion
  ) {
    return current;
  }
  const updated: SupportCase = {
    ...current,
    proposalSeenByUserVersion: params.proposalVersion,
    status: current.status === "resolved" ? "waiting_user" : current.status,
    updatedAtMs: Date.now(),
  };
  store.cases[params.caseId] = updated;
  await saveStore(store, params.env);
  return updated;
}

export async function applySupportCaseResolution(params: {
  caseId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SupportCase | null> {
  const store = await loadStore(params.env);
  const current = store.cases[params.caseId];
  if (!current) {
    return null;
  }
  const updated: SupportCase = {
    ...current,
    status: "closed",
    updatedAtMs: Date.now(),
  };
  store.cases[params.caseId] = updated;
  await saveStore(store, params.env);
  return updated;
}
