export interface SessionProjection {
  sessionId: string;
  groupId: string;
  metadata: Record<string, unknown>;
  projectedAt: number;
}

export interface SessionProjectionAdapter {
  readProjection(sessionId: string): Promise<SessionProjection | null>;
  writeProjection(projection: SessionProjection): Promise<void>;
  flushSessionMemoryToGroup(sessionId: string, groupId: string): Promise<void>;
}
