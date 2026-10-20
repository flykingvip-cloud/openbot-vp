import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  archiveConversationToDataSpace,
  resolveConversationArchiveIndexPath,
} from "./conversation-archive.js";

describe("conversation-archive", () => {
  const dataRoot = path.join(os.tmpdir(), `openbot-conv-archive-${Date.now()}`);
  const stateDir = path.join(os.tmpdir(), `openbot-conv-state-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("copies runtime transcript into data space archive and updates index", async () => {
    const agentId = "helper";
    const sessionId = "sess-001";
    const runtimeDir = path.join(stateDir, "agents", agentId, "sessions");
    const runtimePath = path.join(runtimeDir, `${sessionId}.jsonl`);
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(runtimePath, '{"role":"user","text":"hi"}\n', "utf-8");

    const result = await archiveConversationToDataSpace({
      cfg: { data: { root: dataRoot, mode: "local", schemaVersion: 1 } },
      agentId,
      sessionId,
      runtimePath,
    });

    const archivePath = path.join(
      dataRoot,
      "agents",
      agentId,
      "conversations",
      "archive",
      `${sessionId}.jsonl`,
    );
    expect(result.archivePath).toBe(archivePath);
    expect(await fs.readFile(archivePath, "utf-8")).toContain('"role":"user"');

    const indexPath = resolveConversationArchiveIndexPath(dataRoot, agentId);
    const index = JSON.parse(await fs.readFile(indexPath, "utf-8")) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(index.sessions.some((entry) => entry.sessionId === sessionId)).toBe(true);
  });
});
