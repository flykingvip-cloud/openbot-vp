import type { AuditAdapter, CollaborationGovernanceEvent } from "./interfaces.js";

type GovernanceStoreEvent = {
  id: string;
  kind: string;
  occurredAt: number;
  sourceMethod: string;
  targetKind: string;
  targetId?: string;
  actorRole?: string;
  actorClientId?: string;
  actorConnId?: string;
  actorIp?: string;
  actorManagementLayer?: string;
  actorSubjectKind?: string;
  actorSubjectId?: string;
};

type GovernanceFunctions = {
  recordGovernanceEventWithLock: (params: {
    event: GovernanceStoreEvent;
    env?: NodeJS.ProcessEnv;
  }) => Promise<unknown>;
  loadGovernanceEventsStore: (env?: NodeJS.ProcessEnv) => {
    events?: GovernanceStoreEvent[];
  };
};

export class OpenBotAuditAdapter implements AuditAdapter {
  constructor(
    private readonly governanceFunctions?: GovernanceFunctions,
    private readonly env?: NodeJS.ProcessEnv,
  ) {}

  async recordEvent(event: CollaborationGovernanceEvent): Promise<void> {
    if (!this.governanceFunctions) {
      throw new Error("Governance functions not provided");
    }

    const openbotEvent: GovernanceStoreEvent = {
      id: event.id,
      kind: event.kind,
      occurredAt: event.occurredAt,
      sourceMethod: event.sourceMethod,
      targetKind: event.targetKind,
      ...(event.targetId ? { targetId: event.targetId } : {}),
      ...(event.actor?.role ? { actorRole: event.actor.role } : {}),
      ...(event.actor?.clientId ? { actorClientId: event.actor.clientId } : {}),
      ...(event.actor?.connId ? { actorConnId: event.actor.connId } : {}),
      ...(event.actor?.ip ? { actorIp: event.actor.ip } : {}),
      ...(event.actor?.managementLayer
        ? { actorManagementLayer: event.actor.managementLayer }
        : {}),
      ...(event.actor?.subjectKind ? { actorSubjectKind: event.actor.subjectKind } : {}),
      ...(event.actor?.subjectId ? { actorSubjectId: event.actor.subjectId } : {}),
      ...(event.actor?.id && !event.actor?.subjectId ? { actorSubjectId: event.actor.id } : {}),
    };

    await this.governanceFunctions.recordGovernanceEventWithLock({
      event: openbotEvent,
      env: this.env,
    });
  }

  async queryEvents(filters: {
    groupId?: string;
    targetKind?: string;
    targetId?: string;
    kind?: string;
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<CollaborationGovernanceEvent[]> {
    if (!this.governanceFunctions) {
      throw new Error("Governance functions not provided");
    }

    const store = this.governanceFunctions.loadGovernanceEventsStore(this.env);
    let events = store.events ?? [];

    if (filters.groupId) {
      events = events.filter(
        (event) => event.targetKind === "space" && event.targetId === filters.groupId,
      );
    }
    if (filters.targetKind) {
      events = events.filter((event) => event.targetKind === filters.targetKind);
    }
    if (filters.targetId) {
      events = events.filter((event) => event.targetId === filters.targetId);
    }
    if (filters.kind) {
      events = events.filter((event) => event.kind === filters.kind);
    }
    if (filters.since !== undefined) {
      events = events.filter((event) => event.occurredAt >= filters.since!);
    }
    if (filters.until !== undefined) {
      events = events.filter((event) => event.occurredAt <= filters.until!);
    }
    if (filters.limit) {
      events = events.slice(0, filters.limit);
    }

    return events.map((event) => ({
      id: event.id,
      kind: event.kind,
      occurredAt: event.occurredAt,
      sourceMethod: event.sourceMethod,
      targetKind: event.targetKind,
      ...(event.targetId ? { targetId: event.targetId } : {}),
      ...(event.targetKind === "space" && typeof event.targetId === "string"
        ? { groupId: event.targetId }
        : {}),
      ...(event.actorRole ||
      event.actorClientId ||
      event.actorConnId ||
      event.actorIp ||
      event.actorManagementLayer ||
      event.actorSubjectKind ||
      event.actorSubjectId
        ? {
            actor: {
              id: event.actorSubjectId || event.actorClientId || "unknown",
              ...(event.actorRole ? { role: event.actorRole } : {}),
              ...(event.actorClientId ? { clientId: event.actorClientId } : {}),
              ...(event.actorConnId ? { connId: event.actorConnId } : {}),
              ...(event.actorIp ? { ip: event.actorIp } : {}),
              ...(event.actorManagementLayer
                ? { managementLayer: event.actorManagementLayer }
                : {}),
              ...(event.actorSubjectKind ? { subjectKind: event.actorSubjectKind } : {}),
              ...(event.actorSubjectId ? { subjectId: event.actorSubjectId } : {}),
            },
          }
        : {}),
    }));
  }
}
