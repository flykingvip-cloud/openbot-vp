import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openSessionManager, SessionVersionError } from "./session.js";

const fixture057 = path.resolve(
  fileURLToPath(
    new URL(
      "../../../.kiro/specs/pi-sdk-family-migration/fixtures/session-057.jsonl",
      import.meta.url,
    ),
  ),
);

let tempDir: string | undefined;

async function withTempDir(): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pi-sdk-session-"));
  return tempDir;
}

afterEach(async () => {
  if (!tempDir) {
    return;
  }
  await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("openSessionManager", () => {
  it("reads a Mario 0.57 session fixture written with version 3", async () => {
    const dir = await withTempDir();
    const sessionFile = path.join(dir, "session.jsonl");
    await fs.copyFile(fixture057, sessionFile);

    const sessionManager = openSessionManager(sessionFile);
    const header = sessionManager.getHeader();
    expect(header?.type).toBe("session");
    expect(header?.version).toBe(3);
    expect(sessionManager.getBranch().length).toBeGreaterThan(0);
  });

  it("fail-closes on a future session header version", async () => {
    const dir = await withTempDir();
    const sessionFile = path.join(dir, "future.jsonl");
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: 99,
        id: "future-session",
        timestamp: new Date().toISOString(),
        cwd: dir,
      })}\n`,
    );

    expect(() => openSessionManager(sessionFile)).toThrow(SessionVersionError);
    expect(() => openSessionManager(sessionFile)).toThrow(/version 99 is newer than supported/);
  });

  it("fail-closes on a non-empty file without a session header", async () => {
    const dir = await withTempDir();
    const sessionFile = path.join(dir, "no-header.jsonl");
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "orphan" }] },
      })}\n`,
    );

    expect(() => openSessionManager(sessionFile)).toThrow();
  });
});
