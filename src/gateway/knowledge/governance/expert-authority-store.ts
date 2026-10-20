import type { DatabaseSync } from "node:sqlite";

export type ExpertAuthorityRecord = {
  expertId: string;
  domainScope: string | null;
  expertWeight: number;
  verificationLevel: string | null;
  grantedBy: string | null;
  createdAt: number;
};

const DEFAULT_EXPERT_WEIGHT = 1;
const MIN_EXPERT_WEIGHT = 0.5;
const MAX_EXPERT_WEIGHT = 1.5;

function clampExpertWeight(weight: number): number {
  return Math.min(MAX_EXPERT_WEIGHT, Math.max(MIN_EXPERT_WEIGHT, weight));
}

export function getExpertAuthority(
  db: DatabaseSync,
  expertId: string,
): ExpertAuthorityRecord | null {
  const row = db
    .prepare(
      `SELECT expert_id, domain_scope, expert_weight, verification_level, granted_by, created_at
       FROM governance_expert_authority WHERE expert_id = ?`,
    )
    .get(expertId) as
    | {
        expert_id: string;
        domain_scope: string | null;
        expert_weight: number | null;
        verification_level: string | null;
        granted_by: string | null;
        created_at: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    expertId: row.expert_id,
    domainScope: row.domain_scope,
    expertWeight: clampExpertWeight(row.expert_weight ?? DEFAULT_EXPERT_WEIGHT),
    verificationLevel: row.verification_level,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
  };
}

export function upsertExpertAuthority(params: {
  db: DatabaseSync;
  expertId: string;
  domainScope?: string | null;
  expertWeight?: number;
  verificationLevel?: string | null;
  grantedBy?: string | null;
  now?: number;
}): ExpertAuthorityRecord {
  const now = params.now ?? Date.now();
  const weight = clampExpertWeight(params.expertWeight ?? DEFAULT_EXPERT_WEIGHT);
  params.db
    .prepare(
      `INSERT INTO governance_expert_authority (
         expert_id, domain_scope, expert_weight, verification_level, granted_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(expert_id) DO UPDATE SET
         domain_scope = COALESCE(excluded.domain_scope, governance_expert_authority.domain_scope),
         expert_weight = excluded.expert_weight,
         verification_level = COALESCE(excluded.verification_level, governance_expert_authority.verification_level),
         granted_by = COALESCE(excluded.granted_by, governance_expert_authority.granted_by)`,
    )
    .run(
      params.expertId,
      params.domainScope ?? null,
      weight,
      params.verificationLevel ?? null,
      params.grantedBy ?? null,
      now,
    );
  return getExpertAuthority(params.db, params.expertId)!;
}

export function resolveExpertWeight(params: {
  db: DatabaseSync;
  expertId: string;
  domainScope?: string | null;
}): number {
  const record = getExpertAuthority(params.db, params.expertId);
  if (!record) {
    return DEFAULT_EXPERT_WEIGHT;
  }
  const scope = params.domainScope?.trim();
  if (scope && record.domainScope && record.domainScope !== "*" && record.domainScope !== scope) {
    return Math.min(record.expertWeight, DEFAULT_EXPERT_WEIGHT);
  }
  return record.expertWeight;
}

export function seedExpertAuthorityForResolver(params: {
  db: DatabaseSync;
  expertId: string;
  grantedBy: string;
  verificationLevel?: string | null;
  domainScope?: string | null;
}): ExpertAuthorityRecord {
  const existing = getExpertAuthority(params.db, params.expertId);
  if (existing) {
    return existing;
  }
  return upsertExpertAuthority({
    db: params.db,
    expertId: params.expertId,
    domainScope: params.domainScope ?? "*",
    expertWeight: 1,
    verificationLevel: params.verificationLevel ?? "member",
    grantedBy: params.grantedBy,
  });
}
