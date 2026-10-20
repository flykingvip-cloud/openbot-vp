export interface CollaborationGovernanceEvent {
  id: string;
  kind: string;
  occurredAt: number;
  sourceMethod: string;
  targetKind: string;
  targetId?: string;
  groupId?: string;
  actor?: {
    id: string;
    role?: string;
    clientId?: string;
    connId?: string;
    ip?: string;
    managementLayer?: string;
    subjectKind?: string;
    subjectId?: string;
  };
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditAdapter {
  recordEvent(event: CollaborationGovernanceEvent): Promise<void>;
  queryEvents(filters: {
    groupId?: string;
    targetKind?: string;
    targetId?: string;
    kind?: string;
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<CollaborationGovernanceEvent[]>;
}
