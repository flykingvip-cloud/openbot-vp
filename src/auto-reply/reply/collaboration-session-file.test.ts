import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { resolveGroupPublicTranscriptPath } from "../../gateway/collaboration-learning/collaboration-paths.js";
import { resolveCollaborationAwareSessionFile } from "./collaboration-session-file.js";

const tempDirs: string[] = [];
const previousEnv: Record<string, string | undefined> = {};

/**
 * macOS TMPDIR is often `/var/folders/...`, which realpath resolves to
 * `/private/var/folders/...`. `resolveSessionFilePath` returns the real path.
 * Compare both sides the same way so the assertion is the same file, not the
 * same spelling.
 */
function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    delete previousEnv[key];
  }
  clearConfigCache();
  clearRuntimeConfigSnapshot();
});

describe("resolveCollaborationAwareSessionFile", () => {
  it("keeps an explicit GROUP_PUBLIC transcript outside the agent sessions dir", () => {
    const publicFile = path.resolve(
      "/tmp/openbot-collab/groups/grp-paper/runtime/transcript.jsonl",
    );
    const resolved = resolveCollaborationAwareSessionFile({
      sessionId: "sess-group",
      sessionKey: "agent:main:main",
      sessionEntry: { sessionFile: publicFile },
      agentId: "main",
      storePath: "/tmp/openbot-collab/agents/main/sessions/sessions.json",
    });
    expect(resolved).toBe(publicFile);
  });

  it("opens the shared group transcript for space: sessions instead of the sessions-dir fallback", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-collab-session-file-"));
    tempDirs.push(stateDir);
    const workspaceDir = path.join(stateDir, "workspace");
    previousEnv.OPENBOT_STATE_DIR = process.env.OPENBOT_STATE_DIR;
    previousEnv.OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH;
    previousEnv.OPENBOT_CONFIG_PATH = process.env.OPENBOT_CONFIG_PATH;
    const configPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENBOT_CONFIG_PATH = configPath;
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ agents: { defaults: { workspace: workspaceDir } } }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const groupId = "grp-digital-human";
    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    const fallback = path.join(sessionsDir, "sess-group.jsonl");
    const resolved = resolveCollaborationAwareSessionFile({
      sessionId: "sess-group",
      sessionKey: `space:${groupId}`,
      sessionEntry: { sessionFile: fallback },
      agentId: "main",
      storePath: path.join(sessionsDir, "sessions.json"),
    });
    expect(resolved).toBe(path.resolve(resolveGroupPublicTranscriptPath(groupId)));
    expect(resolved.endsWith(path.join("runtime", "transcript.jsonl"))).toBe(true);
    expect(resolved).not.toBe(path.resolve(fallback));
  });

  it("still resolves a 1:1 session inside the agent sessions dir", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-collab-session-file-dm-"));
    tempDirs.push(stateDir);
    previousEnv.OPENBOT_STATE_DIR = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    const sessionFile = path.join(sessionsDir, "sess-dm.jsonl");
    await fs.mkdir(sessionsDir, { recursive: true });
    const resolved = resolveCollaborationAwareSessionFile({
      sessionId: "sess-dm",
      sessionKey: "agent:main:main",
      sessionEntry: { sessionFile },
      agentId: "main",
      storePath: path.join(sessionsDir, "sessions.json"),
    });
    expect(canonicalPath(resolved)).toBe(canonicalPath(sessionFile));
  });

  it("opens the existing in-dir transcript when the stored session file is missing", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "openbot-collab-session-file-visible-"),
    );
    tempDirs.push(stateDir);
    const sessionsDir = path.join(stateDir, "agents", "robot", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const missing = path.join(sessionsDir, "custom-missing.jsonl");
    const visible = path.join(sessionsDir, "sess-robot.jsonl");
    await fs.writeFile(visible, '{"type":"session"}\n', "utf8");
    const resolved = resolveCollaborationAwareSessionFile({
      sessionId: "sess-robot",
      sessionKey: "agent:robot:main",
      sessionEntry: { sessionFile: missing },
      agentId: "robot",
      storePath: path.join(sessionsDir, "sessions.json"),
    });
    expect(canonicalPath(resolved)).toBe(canonicalPath(visible));
  });
});
