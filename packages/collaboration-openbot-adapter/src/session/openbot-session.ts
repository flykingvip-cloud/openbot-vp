import type { SessionProjection, SessionProjectionAdapter } from "./interfaces.js";

type SessionFunctions = {
  readSessionProjection: (sessionId: string) => Promise<SessionProjection | null>;
  writeSessionProjection: (sessionId: string, projection: SessionProjection) => Promise<void>;
  flushSessionMemory: (sessionId: string, groupId: string) => Promise<void>;
};

export class OpenBotSessionProjectionAdapter implements SessionProjectionAdapter {
  constructor(private readonly sessionFunctions?: SessionFunctions) {}

  async readProjection(sessionId: string): Promise<SessionProjection | null> {
    if (!this.sessionFunctions) {
      throw new Error("Session functions not provided");
    }
    return this.sessionFunctions.readSessionProjection(sessionId);
  }

  async writeProjection(projection: SessionProjection): Promise<void> {
    if (!this.sessionFunctions) {
      throw new Error("Session functions not provided");
    }
    await this.sessionFunctions.writeSessionProjection(projection.sessionId, projection);
  }

  async flushSessionMemoryToGroup(sessionId: string, groupId: string): Promise<void> {
    if (!this.sessionFunctions) {
      throw new Error("Session functions not provided");
    }
    await this.sessionFunctions.flushSessionMemory(sessionId, groupId);
  }
}
