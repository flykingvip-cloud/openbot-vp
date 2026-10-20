/**
 * In-memory CreationSession store. Not an employee identity store.
 */

import type { BlueprintDraft, CreationSession, EmployeeDesignIntent } from "./types.js";

export type StoredDesign = {
  session: CreationSession;
  intent: EmployeeDesignIntent;
  draft: BlueprintDraft;
};

export class DesignSessionStore {
  private readonly byId = new Map<string, StoredDesign>();
  private readonly agentByKey = new Map<string, string>();

  put(entry: StoredDesign): StoredDesign {
    this.byId.set(entry.session.id, entry);
    return entry;
  }

  get(sessionId: string): StoredDesign | undefined {
    return this.byId.get(sessionId);
  }

  rememberAgent(idempotencyKey: string, agentId: string): string {
    const existing = this.agentByKey.get(idempotencyKey);
    if (existing) {
      return existing;
    }
    this.agentByKey.set(idempotencyKey, agentId);
    return agentId;
  }

  peekAgent(idempotencyKey: string): string | undefined {
    return this.agentByKey.get(idempotencyKey);
  }

  delete(sessionId: string): void {
    this.byId.delete(sessionId);
  }
}

export const designSessionStore = new DesignSessionStore();
