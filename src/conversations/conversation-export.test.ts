import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";

vi.mock("../gateway/session-utils.js", () => ({
  readSessionMessages: vi.fn((_sessionId: string, _store?: string, filePath?: string) => {
    if (filePath?.includes("archive")) {
      return [{ role: "assistant", content: "archived reply" }];
    }
    return [{ role: "user", content: "hello" }];
  }),
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => path.join(os.tmpdir(), "openbot-state-export-test"),
}));

const { exportConversationTranscript } = await import("./conversation-export.js");

describe("exportConversationTranscript", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-export-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("merges runtime and archive sections", async () => {
    const agentId = "main";
    const sessionId = "sess-1";
    const archiveDir = path.join(tmpRoot, "agents", agentId, "conversations", "archive");
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(path.join(archiveDir, `${sessionId}.jsonl`), "{}", "utf-8");
    await fs.writeFile(
      path.join(tmpRoot, "agents", agentId, "conversations", "index.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        sessions: [
          {
            sessionId,
            archivedAt: new Date().toISOString(),
            relativePath: `archive/${sessionId}.jsonl`,
          },
        ],
      })}\n`,
    );

    const cfg = {
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
    } as OpenBotConfig;

    const result = await exportConversationTranscript({ cfg, agentId, sessionId });
    expect(result.format).toBe("markdown");
    expect(result.content).toContain("hello");
    expect(result.content).toContain("archived reply");
    expect(result.sources.length).toBe(2);
  });
});
