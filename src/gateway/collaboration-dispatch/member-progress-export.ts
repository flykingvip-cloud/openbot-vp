/**
 * C0 — Read-only member progress export from GroupBoardClaim jsonl (+ optional operating-state).
 *
 * Answers: for each claimant, what is their latest board status
 * (published / claimed / applied / in_progress / submitted_for_review / accepted / returned / …)?
 *
 * Does not write, does not invent ui.* RPC, does not enable Floor live.
 * Chat drafts are never board facts — only board-claims rows count.
 *
 * Field evidence (2026-10-13 tip 数字人战队): after apply, no in_progress/submitted
 * was visible; operating-state only had currentTaskId; no listBoard/getProgress.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** AS-IS (P4b) + C1 progress statuses (forward-compatible for export). */
/** Forward-compatible: AS-IS P4b + C1 progress + any future status string. */
export type ExportedBoardClaimStatus = string;

export type ExportedBoardClaimItem = {
  itemId: string;
  groupId: string;
  taskId: string;
  title: string;
  status: ExportedBoardClaimStatus;
  /**
   * Board template Goal / remainingWork / acceptanceCriteria.
   * Self-advance loads via this export then builds ExecutionTaskBag; dropping these
   * yields exec_bag_incomplete (empty goal) even when Todolist is confirmed.
   */
  remainingWork?: string;
  acceptanceCriteria?: readonly string[];
  goal?: string;
  constraints?: readonly string[];
  dueAtMs?: number;
  publishedBy?: string;
  /** Publish timestamp (ms); needed for Mode B inventory ranking / activity. */
  publishedAt?: number;
  /**
   * Claim allow-list from board_claim jsonl. Mode B claim-first / lead selection
   * read this loader — must round-trip or lead falls back to publishedBy (e.g. cli).
   */
  intendedClaimantIds?: readonly string[];
  claimantId?: string;
  claimedAt?: number;
  appliedAt?: number;
  inProgressAt?: number;
  submissionId?: string;
  submittedAt?: number;
  acceptedAt?: number;
  acceptedBy?: string;
  returnedAt?: number;
  returnedBy?: string;
  returnReason?: string;
  blockedAt?: number;
  blockedReason?: string;
};

export type MemberProgressRow = {
  memberId: string;
  itemId: string;
  taskId: string;
  title: string;
  status: ExportedBoardClaimStatus;
  submissionId?: string;
  /** True when status is a submitted-or-later authoritative交卷态 (not draft chat). */
  isSubmitted: boolean;
  /** True when still pre-submit work (claimed/applied/in_progress/returned/blocked). */
  isActiveWork: boolean;
  timestamps: {
    claimedAt?: number;
    appliedAt?: number;
    inProgressAt?: number;
    submittedAt?: number;
    acceptedAt?: number;
    returnedAt?: number;
    blockedAt?: number;
  };
};

export type MemberProgressReport = {
  generatedAt: string;
  claimsDir: string;
  groupIdHint?: string;
  itemCount: number;
  memberCount: number;
  members: MemberProgressRow[];
  /** Items with no claimant yet (still published / unclaimed). */
  unclaimed: Array<{ itemId: string; taskId: string; title: string; status: string }>;
  gaps: string[];
  operatingState?: {
    path?: string;
    currentTaskId?: string | null;
    note: string;
  };
};

const SUBMITTED_OR_LATER = new Set(["submitted_for_review", "accepted"]);

const ACTIVE_WORK = new Set(["claimed", "applied", "in_progress", "returned", "blocked"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** Non-empty trimmed string ids from a jsonl array field (intendedClaimantIds, …). */
function parseStringIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const id = entry.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Non-empty trimmed string (goal / remainingWork). */
function parseOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Non-empty trimmed string list (acceptanceCriteria / constraints). */
function parseOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      out.push(trimmed);
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Parse one board-claims jsonl file into latest item per itemId. */
export function latestItemsFromBoardClaimJsonl(raw: string): ExportedBoardClaimItem[] {
  const byId = new Map<string, ExportedBoardClaimItem>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed.kind !== "board_claim" || !isRecord(parsed.item)) {
      continue;
    }
    const item = parsed.item;
    const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
    const taskId = typeof item.taskId === "string" ? item.taskId.trim() : "";
    const groupId = typeof item.groupId === "string" ? item.groupId.trim() : "";
    const status = typeof item.status === "string" ? item.status.trim() : "";
    if (!itemId || !taskId || !status) {
      continue;
    }
    const intendedClaimantIds = parseStringIdList(item.intendedClaimantIds);
    const remainingWork = parseOptionalNonEmptyString(item.remainingWork);
    const goal = parseOptionalNonEmptyString(item.goal);
    const acceptanceCriteria = parseOptionalStringList(item.acceptanceCriteria);
    const constraints = parseOptionalStringList(item.constraints);
    const dueAtMs = typeof item.dueAtMs === "number" ? item.dueAtMs : undefined;
    byId.set(itemId, {
      itemId,
      groupId,
      taskId,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : taskId,
      status,
      ...(remainingWork !== undefined ? { remainingWork } : {}),
      ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
      ...(goal !== undefined ? { goal } : {}),
      ...(constraints !== undefined ? { constraints } : {}),
      ...(dueAtMs !== undefined ? { dueAtMs } : {}),
      publishedBy: typeof item.publishedBy === "string" ? item.publishedBy : undefined,
      publishedAt: typeof item.publishedAt === "number" ? item.publishedAt : undefined,
      ...(intendedClaimantIds !== undefined ? { intendedClaimantIds } : {}),
      claimantId: typeof item.claimantId === "string" ? item.claimantId : undefined,
      claimedAt: typeof item.claimedAt === "number" ? item.claimedAt : undefined,
      appliedAt: typeof item.appliedAt === "number" ? item.appliedAt : undefined,
      inProgressAt: typeof item.inProgressAt === "number" ? item.inProgressAt : undefined,
      submissionId: typeof item.submissionId === "string" ? item.submissionId : undefined,
      submittedAt: typeof item.submittedAt === "number" ? item.submittedAt : undefined,
      acceptedAt: typeof item.acceptedAt === "number" ? item.acceptedAt : undefined,
      acceptedBy: typeof item.acceptedBy === "string" ? item.acceptedBy : undefined,
      returnedAt: typeof item.returnedAt === "number" ? item.returnedAt : undefined,
      returnedBy: typeof item.returnedBy === "string" ? item.returnedBy : undefined,
      returnReason: typeof item.returnReason === "string" ? item.returnReason : undefined,
      blockedAt: typeof item.blockedAt === "number" ? item.blockedAt : undefined,
      blockedReason: typeof item.blockedReason === "string" ? item.blockedReason : undefined,
    });
  }
  return [...byId.values()];
}

export function aggregateMemberProgress(params: {
  items: readonly ExportedBoardClaimItem[];
  claimsDir: string;
  groupIdHint?: string;
  operatingStatePath?: string;
  currentTaskId?: string | null;
}): MemberProgressReport {
  const members: MemberProgressRow[] = [];
  const unclaimed: MemberProgressReport["unclaimed"] = [];
  const gaps: string[] = [];

  for (const item of params.items) {
    const claimant = item.claimantId?.trim();
    if (!claimant) {
      unclaimed.push({
        itemId: item.itemId,
        taskId: item.taskId,
        title: item.title,
        status: item.status,
      });
      continue;
    }
    members.push({
      memberId: claimant,
      itemId: item.itemId,
      taskId: item.taskId,
      title: item.title,
      status: item.status,
      submissionId: item.submissionId,
      isSubmitted: SUBMITTED_OR_LATER.has(item.status),
      isActiveWork: ACTIVE_WORK.has(item.status),
      timestamps: {
        claimedAt: item.claimedAt,
        appliedAt: item.appliedAt,
        inProgressAt: item.inProgressAt,
        submittedAt: item.submittedAt,
        acceptedAt: item.acceptedAt,
        returnedAt: item.returnedAt,
        blockedAt: item.blockedAt,
      },
    });
  }

  members.sort((a, b) => a.memberId.localeCompare(b.memberId) || a.taskId.localeCompare(b.taskId));

  if (members.length === 0 && unclaimed.length === 0) {
    gaps.push("no_board_claim_items");
  }
  const hasPreSubmitOnly = members.some((m) => m.status === "claimed" || m.status === "applied");
  const hasSubmitted = members.some((m) => m.isSubmitted);
  if (hasPreSubmitOnly && !hasSubmitted) {
    gaps.push(
      "no_submitted_for_review_visible — field evidence: assignment without交卷态 (stitch risk)",
    );
  }
  if (!members.some((m) => m.status === "in_progress")) {
    gaps.push("no_in_progress_visible — members may be working only in chat drafts");
  }
  if (params.currentTaskId == null || params.currentTaskId === "") {
    gaps.push("operating_state_missing_currentTaskId_or_not_provided");
  } else {
    gaps.push(
      "operating_state_only_currentTaskId — no per-member progress map (C1 claim states are source of truth)",
    );
  }
  gaps.push(
    "assistant_at_mention_does_not_wake_peers — wake ledger is C2; C0/C1 only make progress visible",
  );

  return {
    generatedAt: new Date().toISOString(),
    claimsDir: params.claimsDir,
    groupIdHint: params.groupIdHint,
    itemCount: params.items.length,
    memberCount: new Set(members.map((m) => m.memberId)).size,
    members,
    unclaimed,
    gaps,
    operatingState: {
      path: params.operatingStatePath,
      currentTaskId: params.currentTaskId ?? null,
      note: "operating-state is not a per-member progress authority; board-claims are.",
    },
  };
}

export function formatMemberProgressTable(report: MemberProgressReport): string {
  const lines: string[] = [];
  lines.push(`# Member progress (${report.generatedAt})`);
  lines.push(`claimsDir=${report.claimsDir}`);
  lines.push(`items=${report.itemCount} members=${report.memberCount}`);
  lines.push("");
  lines.push("| member | status | taskId | itemId | submissionId |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of report.members) {
    lines.push(
      `| ${row.memberId} | ${row.status} | ${row.taskId} | ${row.itemId} | ${row.submissionId ?? ""} |`,
    );
  }
  if (report.unclaimed.length > 0) {
    lines.push("");
    lines.push("## Unclaimed");
    for (const u of report.unclaimed) {
      lines.push(`- ${u.status} ${u.taskId} ${u.itemId} (${u.title})`);
    }
  }
  if (report.gaps.length > 0) {
    lines.push("");
    lines.push("## Gaps");
    for (const g of report.gaps) {
      lines.push(`- ${g}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function loadBoardClaimItemsFromDir(
  claimsDir: string,
): Promise<ExportedBoardClaimItem[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(claimsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const items: ExportedBoardClaimItem[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const raw = await fs.readFile(path.join(claimsDir, name), "utf8");
    items.push(...latestItemsFromBoardClaimJsonl(raw));
  }
  // Dedupe by itemId across files (should not happen, but safe).
  const byId = new Map<string, ExportedBoardClaimItem>();
  for (const item of items) {
    byId.set(item.itemId, item);
  }
  return [...byId.values()];
}

export async function buildMemberProgressReportFromDirs(params: {
  claimsDir: string;
  operatingStatePath?: string;
  groupIdHint?: string;
}): Promise<MemberProgressReport> {
  const items = await loadBoardClaimItemsFromDir(params.claimsDir);
  let currentTaskId: string | null | undefined;
  if (params.operatingStatePath) {
    try {
      const raw = await fs.readFile(params.operatingStatePath, "utf8");
      const parsed = JSON.parse(raw) as {
        activeContext?: { currentTaskId?: string | null };
      };
      currentTaskId = parsed.activeContext?.currentTaskId ?? null;
    } catch {
      currentTaskId = null;
    }
  }
  return aggregateMemberProgress({
    items,
    claimsDir: params.claimsDir,
    groupIdHint: params.groupIdHint,
    operatingStatePath: params.operatingStatePath,
    currentTaskId,
  });
}

/** Chat / draft speech is never a board progress fact (OGUI three-data split). */
export function chatDraftIsBoardProgressFact(): false {
  return false;
}
