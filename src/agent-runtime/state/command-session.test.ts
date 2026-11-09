import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import { persistCommandSessionEntry } from "./command-session.js";

it("preserves fresh stored fields and applies explicit override clears through the original transaction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "command-state-"));
  try {
    const storePath = path.join(root, "sessions.json");
    await fs.writeFile(
      storePath,
      JSON.stringify({
        own: {
          sessionId: "session",
          updatedAt: 10,
          thinkingLevel: "high",
          providerOverride: "old",
          modelOverride: "old-model",
          authProfileOverride: "old-auth",
          claudeCliSessionId: "expired",
        },
        other: { sessionId: "other", updatedAt: 1 },
      }),
    );
    const sessionStore: Record<string, SessionEntry> = {};
    await persistCommandSessionEntry({
      storePath,
      sessionKey: "own",
      sessionStore,
      entry: { sessionId: "session", updatedAt: 11 },
    });
    const stored = JSON.parse(await fs.readFile(storePath, "utf8"));
    expect(stored.own).toMatchObject({ sessionId: "session", thinkingLevel: "high" });
    for (const key of [
      "providerOverride",
      "modelOverride",
      "authProfileOverride",
      "claudeCliSessionId",
    ]) {
      expect(stored.own).not.toHaveProperty(key);
    }
    expect(stored.other.sessionId).toBe("other");
    expect(sessionStore.own).toEqual(stored.own);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
