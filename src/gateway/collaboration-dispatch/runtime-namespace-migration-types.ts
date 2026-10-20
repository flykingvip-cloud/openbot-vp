/** P0.0a migration — report / manifest / audit shapes (see runtime-namespace-migration.ts). */
import type { TenantDecision } from "./runtime-namespace-tenant-inference.js";

export type MigrationTarget =
  | { profile: "managed_enterprise"; tenantsRoot: string }
  | { profile: "personal_local"; groupsRoot: string };

export type MigrationDirection = "forward" | "reverse";

export type MigrationOptions = {
  /** Legacy host groups root, e.g. `~/.openbot/collaboration/groups`. */
  sourceGroupsRoot: string;
  target: MigrationTarget;
  /** Default false: dry-run, nothing is written anywhere. */
  apply?: boolean;
  direction?: MigrationDirection;
  /** Operator decision per groupId; wins over inference. */
  tenantMap?: Record<string, string>;
  groupIds?: string[];
  runId?: string;
  now?: () => number;
};

export type FileAction =
  | "copy"
  | "overwrite"
  | "unchanged"
  | "dest_newer"
  | "conflict"
  | "merge"
  | "append"
  | "same_path";

export type FileEntry = {
  /** `rounds/<name>` or `ledger/collaboration.jsonl`. */
  fact: string;
  from: string[];
  to: string;
  action: FileAction;
  sourceSha256?: string;
  destSha256?: string;
  lines?: number;
  bytes?: number;
  sourceMtimeMs?: number;
  /** Ledger merges: records dropped as duplicates / already present. */
  duplicatesDropped?: number;
  /** Set on apply (and for unchanged files): re-read sha256 / key coverage verified. */
  verified?: boolean;
};

export type ManifestFile = {
  /** sha256 both sides agreed on at the last successful sync (three-way baseline). */
  baselineSha256: string;
  lines: number;
  bytes: number;
  sourceMtimeMs?: number;
};

export type MigrationManifest = {
  version: 1;
  groupId: string;
  tenantId: string | null;
  tenantKey: string;
  profile: MigrationTarget["profile"];
  source: { legacyGroupDir: string };
  target: { namespaceRoot: string };
  files: Record<string, ManifestFile>;
  history: Array<{ runId: string; direction: MigrationDirection; atMs: number; files: number }>;
};

export type GroupStatus =
  | "planned"
  | "migrated"
  | "unchanged"
  | "quarantined"
  | "skipped_no_runtime_facts"
  | "failed";

export type GroupTenant =
  | TenantDecision
  | {
      status: "resolved";
      tenantId: string | null;
      reason: "personal-local" | "target-namespace";
      evidence: string[];
    };

export type MigrationAuditRecord = {
  kind: "collab_runtime_namespace_migration";
  version: 1;
  runId: string;
  actor: "migration";
  mode: "dry-run" | "apply";
  direction: MigrationDirection;
  groupId: string;
  tenantId: string | null;
  tenantKey: string | null;
  /** e.g. `owner-default-tenant-001`, `tenant-map`, `group-record`, `tenant-conflict`. */
  reason: string;
  from: string;
  to: string | null;
  status: GroupStatus;
  recordedAtMs: number;
};

export type NonTerminalRound = { roundId: string; state: string; file: string };

export type GroupReport = {
  groupId: string;
  legacyGroupDir: string;
  status: GroupStatus;
  tenant: GroupTenant;
  namespaceRoot: string | null;
  files: FileEntry[];
  /** Copied as-is; settled by round restart recovery (never re-run). */
  nonTerminalRounds: NonTerminalRound[];
  /** Group files outside P0.0a runtime facts (stay on the C5 group store). */
  retainedOnLegacyStore: string[];
  audit: MigrationAuditRecord;
};

export type MigrationReport = {
  runId: string;
  mode: "dry-run" | "apply";
  direction: MigrationDirection;
  sourceGroupsRoot: string;
  target: MigrationTarget;
  groups: GroupReport[];
  totals: Record<string, number>;
};
