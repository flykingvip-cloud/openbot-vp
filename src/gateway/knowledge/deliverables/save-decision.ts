export const SAVE_DECISION_REQUIRED = "SAVE_DECISION_REQUIRED";
export const SAVE_CONFLICT_STALE = "SAVE_CONFLICT_STALE";

export type DeliverableSaveMode = "overwrite" | "save_as";

export type ArchivedDeliverableRecord = {
  knowledgeBaseId: string;
  documentId: string;
  deliverableId?: string;
  logicalId?: string;
  rawHash?: string;
  filename?: string;
  title?: string;
  archivedByAgentId?: string;
  archivedByGroupId?: string;
  archivedByUserId?: string;
  derivedFromDocumentId?: string;
  derivedFromRawHash?: string;
};

export type SaveDecisionInput = {
  existing: ArchivedDeliverableRecord | null;
  proposedRawHash: string;
  proposedAgentId: string;
  proposedGroupId?: string | null;
  saveMode?: DeliverableSaveMode | null;
  expectedRawHash?: string | null;
  saveAsFilename?: string | null;
  reservedFilenames?: string[] | null;
};

export type SaveDecision =
  | { action: "create" }
  | { action: "noop"; existing: ArchivedDeliverableRecord }
  | { action: "overwrite"; existing: ArchivedDeliverableRecord }
  | { action: "save_as"; existing: ArchivedDeliverableRecord; filename: string }
  | {
      action: "require_decision";
      existing: ArchivedDeliverableRecord;
      reason: "already_archived" | "different_origin" | "content_changed";
    }
  | { action: "stale"; existing: ArchivedDeliverableRecord };

export class SaveDecisionRequiredError extends Error {
  readonly code = SAVE_DECISION_REQUIRED;
  readonly existing: ArchivedDeliverableRecord;
  readonly proposedRawHash: string;
  readonly reason: "already_archived" | "different_origin" | "content_changed";
  readonly suggestedSaveAsFilename: string;

  constructor(params: {
    existing: ArchivedDeliverableRecord;
    proposedRawHash: string;
    reason: "already_archived" | "different_origin" | "content_changed";
    suggestedSaveAsFilename?: string | null;
    reservedFilenames?: string[] | null;
  }) {
    super("this deliverable is already archived; choose overwrite or save as");
    this.name = "SaveDecisionRequiredError";
    this.existing = params.existing;
    this.proposedRawHash = params.proposedRawHash;
    this.reason = params.reason;
    this.suggestedSaveAsFilename =
      params.suggestedSaveAsFilename?.trim() ||
      resolveSaveAsFilename({
        requested: params.existing.filename,
        existingFilename: params.existing.filename,
        reservedFilenames: params.reservedFilenames,
      });
  }
}

export class SaveConflictStaleError extends Error {
  readonly code = SAVE_CONFLICT_STALE;
  readonly existing: ArchivedDeliverableRecord;

  constructor(existing: ArchivedDeliverableRecord) {
    super("archived document changed; choose overwrite, save as, or cancel again");
    this.name = "SaveConflictStaleError";
    this.existing = existing;
  }
}

export function originChanged(
  existing: ArchivedDeliverableRecord,
  proposedAgentId: string,
  proposedGroupId?: string | null,
): boolean {
  const existingAgent = existing.archivedByAgentId?.trim() || "";
  const proposedAgent = proposedAgentId.trim();
  if (existingAgent && proposedAgent && existingAgent !== proposedAgent) {
    return true;
  }
  const existingGroup = existing.archivedByGroupId?.trim() || "";
  const proposedGroup = proposedGroupId?.trim() || "";
  return existingGroup !== proposedGroup;
}

export function archiveFilenameKey(filename: string): string {
  const trimmed = filename.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return "";
  }
  return (trimmed.split("/").pop() ?? trimmed).trim().toLowerCase();
}

function splitArchiveFilename(filename: string): { dir: string; stem: string; ext: string } {
  const normalized = filename.trim().replace(/\\/g, "/") || "deliverable.md";
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = base.lastIndexOf(".");
  const hasExt = dot > 0 && dot < base.length - 1;
  return {
    dir,
    stem: hasExt ? base.slice(0, dot) : base,
    ext: hasExt ? base.slice(dot) : "",
  };
}

function uniquifyArchiveFilename(filename: string, reserved: Set<string>): string {
  const { dir, stem, ext } = splitArchiveFilename(filename);
  const versioned = stem.match(/^(.*)-v(\d+)$/);
  const baseStem = versioned?.[1] || stem;
  let next = versioned ? Number(versioned[2]) + 1 : 2;
  while (next < 1000) {
    const candidate = `${dir}${baseStem}-v${next}${ext}`;
    if (!reserved.has(archiveFilenameKey(candidate))) {
      return candidate;
    }
    next += 1;
  }
  return `${dir}${baseStem}-v${Date.now()}${ext}`;
}

export function resolveSaveAsFilename(params: {
  requested?: string | null;
  existingFilename?: string | null;
  reservedFilenames?: string[] | null;
}): string {
  const requested = params.requested?.trim() || "";
  const existing = params.existingFilename?.trim() || "";
  const fallback = requested || existing || "deliverable.md";
  const reserved = new Set(
    [existing, ...(params.reservedFilenames ?? [])]
      .map((name) => archiveFilenameKey(name))
      .filter(Boolean),
  );
  if (!reserved.has(archiveFilenameKey(fallback))) {
    return fallback;
  }
  return uniquifyArchiveFilename(fallback, reserved);
}

/**
 * Second-save contract:
 * - first save → create
 * - same bytes → noop (do not prompt)
 * - already archived and (origin or bytes changed) → ask unless the user already chose
 * - overwrite must see the rawHash the user confirmed; mismatch → stale
 */
export function resolveDeliverableSaveDecision(input: SaveDecisionInput): SaveDecision {
  const existing = input.existing;
  if (!existing?.documentId?.trim() && !existing?.knowledgeBaseId?.trim()) {
    return { action: "create" };
  }
  if (!existing) {
    return { action: "create" };
  }

  const proposedRawHash = input.proposedRawHash.trim();
  const currentRawHash = existing.rawHash?.trim() || "";
  const sameHash = Boolean(currentRawHash && proposedRawHash && currentRawHash === proposedRawHash);
  if (sameHash && input.saveMode !== "save_as") {
    return { action: "noop", existing };
  }

  const changedOrigin = originChanged(existing, input.proposedAgentId, input.proposedGroupId);
  const contentChanged = !sameHash;
  const needsPrompt = changedOrigin || contentChanged || !currentRawHash;

  if (!input.saveMode) {
    if (needsPrompt) {
      return {
        action: "require_decision",
        existing,
        reason: !currentRawHash
          ? "already_archived"
          : changedOrigin
            ? "different_origin"
            : "content_changed",
      };
    }
    return { action: "noop", existing };
  }

  if (input.saveMode === "overwrite") {
    if (currentRawHash) {
      const expected = input.expectedRawHash?.trim() || "";
      if (!expected || expected !== currentRawHash) {
        return { action: "stale", existing };
      }
    }
    return { action: "overwrite", existing };
  }

  const filename = resolveSaveAsFilename({
    requested: input.saveAsFilename,
    existingFilename: existing.filename,
    reservedFilenames: input.reservedFilenames,
  });
  return { action: "save_as", existing, filename };
}

export function assertDeliverableSaveDecision(
  input: SaveDecisionInput,
): Exclude<SaveDecision, { action: "require_decision" } | { action: "stale" }> {
  const decision = resolveDeliverableSaveDecision(input);
  if (decision.action === "require_decision") {
    throw new SaveDecisionRequiredError({
      existing: decision.existing,
      proposedRawHash: input.proposedRawHash,
      reason: decision.reason,
      reservedFilenames: input.reservedFilenames,
    });
  }
  if (decision.action === "stale") {
    throw new SaveConflictStaleError(decision.existing);
  }
  return decision;
}
