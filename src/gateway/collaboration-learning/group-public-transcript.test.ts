import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { truncateTranscriptToBoundary } from "../transcript-truncate.js";
import { resolveGroupPublicTranscriptPath } from "./collaboration-paths.js";
import {
  bindGroupPublicTranscript,
  dropDivergentGroupTranscriptMirrors,
  resetGroupPublicTranscriptHealLocksForTests,
  resolveBoundGroupPublicTranscriptPath,
} from "./group-public-transcript.js";
import { buildCollaborationSpaceSessionId } from "./session-id.js";

let tempDirs: string[] = [];
let previousEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  resetGroupPublicTranscriptHealLocksForTests();
  await Promise.all(tempDirs.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previousEnv = {};
  clearConfigCache();
  clearRuntimeConfigSnapshot();
});

async function makeTempDir(prefix: string) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeLegacyTranscript(
  filePath: string,
  sessionId: string,
  messages: Array<Record<string, unknown>>,
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: "/tmp",
    }),
    ...messages.map((message) => JSON.stringify({ message })),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

describe("bindGroupPublicTranscript", () => {
  beforeEach(() => {
    previousEnv = {
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
      OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
      OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
    };
  });

  it("merges two members' per-user space transcripts into runtime/transcript.jsonl", async () => {
    const stateDir = await makeTempDir("openbot-group-tx-state-");
    const workspaceDir = await makeTempDir("openbot-group-tx-ws-");
    const collaborationRoot = await makeTempDir("openbot-group-tx-root-");
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fsp.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fsp.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: collaborationRoot } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const groupId = "grp-shared-visibility";
    const sessionId = buildCollaborationSpaceSessionId(groupId);
    const memberADir = path.join(stateDir, "agents", "main", "sessions-a");
    const memberBDir = path.join(stateDir, "agents", "main", "sessions-b");
    const memberAFile = path.join(memberADir, `${sessionId}.jsonl`);
    const memberBFile = path.join(memberBDir, `${sessionId}.jsonl`);
    const storePath = path.join(memberADir, "sessions.json");

    writeLegacyTranscript(memberAFile, sessionId, [
      {
        id: "msg-a1",
        role: "user",
        content: [{ type: "text", text: "A says hello" }],
        timestamp: 1000,
        senderLabel: "MemberA",
      },
    ]);
    writeLegacyTranscript(memberBFile, sessionId, [
      {
        id: "msg-b1",
        role: "user",
        content: [{ type: "text", text: "B says hi" }],
        timestamp: 2000,
        senderLabel: "MemberB",
      },
      {
        id: "msg-a1",
        role: "user",
        content: [{ type: "text", text: "A says hello" }],
        timestamp: 1000,
        senderLabel: "MemberA",
      },
    ]);

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        [`space:${groupId}`]: {
          sessionId,
          sessionFile: memberAFile,
          groupId,
          space: groupId,
          updatedAt: Date.now(),
        },
      }),
      "utf-8",
    );

    // Point scan at B via existingSessionFile + store already has A.
    const shared = await bindGroupPublicTranscript({
      groupId,
      sessionId,
      storePath,
      existingSessionFile: memberBFile,
    });

    expect(shared).toBe(resolveGroupPublicTranscriptPath(groupId));
    expect(shared.endsWith(path.join("runtime", "transcript.jsonl"))).toBe(true);

    const body = fs.readFileSync(shared, "utf-8");
    expect(body).toContain("A says hello");
    expect(body).toContain("B says hi");
    expect(body.match(/A says hello/g)?.length).toBe(1);

    const otherGroupId = "grp-other-isolation";
    const otherShared = await bindGroupPublicTranscript({
      groupId: otherGroupId,
      sessionId: buildCollaborationSpaceSessionId(otherGroupId),
      storePath: path.join(memberADir, "other-sessions.json"),
    });
    expect(fs.existsSync(otherShared)).toBe(true);
    expect(fs.readFileSync(otherShared, "utf-8")).not.toContain("A says hello");
    expect(otherShared).not.toBe(shared);
  });

  it("uses the live .openbot transcript and does not create an empty .openclaw SoT", async () => {
    const home = await makeTempDir("openbot-tx-cutover-home-");
    const stateDir = await makeTempDir("openbot-tx-cutover-state-");
    const openclawWs = path.join(home, ".openclaw", "workspace");
    const openbotWs = path.join(home, ".openbot", "workspace");
    const groupId = "grp-glen-history";
    const rel = path.join(
      ".openbot",
      "collaboration",
      "groups",
      encodeURIComponent(groupId),
      "runtime",
      "transcript.jsonl",
    );
    const liveFile = path.join(openbotWs, rel);
    const deadFile = path.join(openclawWs, rel);
    writeLegacyTranscript(liveFile, "sess-live", [
      {
        role: "user",
        content: [{ type: "text", text: "keep live history" }],
        timestamp: 1,
      },
    ]);

    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fsp.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fsp.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: openclawWs } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const storePath = path.join(stateDir, "sessions.json");
    const bound = await bindGroupPublicTranscript({
      groupId,
      sessionId: "sess-live",
      storePath,
      existingSessionFile: deadFile,
    });

    expect(bound).toBe(path.resolve(liveFile));
    expect(bound.includes(`${path.sep}.openbot${path.sep}`)).toBe(true);
    expect(fs.existsSync(deadFile)).toBe(false);
    expect(fs.readFileSync(bound, "utf-8")).toContain("keep live history");
  });

  it("skips the legacy store scan when the shared transcript is already bound", async () => {
    const stateDir = await makeTempDir("openbot-group-tx-bound-");
    const workspaceDir = await makeTempDir("openbot-group-tx-bound-ws-");
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fsp.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fsp.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const groupId = "grp-already-bound";
    const shared = resolveGroupPublicTranscriptPath(groupId);
    writeLegacyTranscript(shared, "sess-bound", [
      {
        role: "assistant",
        content: [{ type: "text", text: "already public" }],
        timestamp: 1,
      },
    ]);

    expect(
      resolveBoundGroupPublicTranscriptPath({
        groupId,
        existingSessionFile: shared,
      }),
    ).toBe(path.resolve(shared));

    const rebound = await bindGroupPublicTranscript({
      groupId,
      sessionId: "sess-bound",
      storePath: path.join(stateDir, "sessions.json"),
      existingSessionFile: shared,
    });
    expect(rebound).toBe(path.resolve(shared));
    expect(fs.readFileSync(rebound, "utf-8")).toContain("already public");
  });

  it("folds a bot-scoped space mirror with a different sessionId then deletes the leftover key and file", async () => {
    const stateDir = await makeTempDir("openbot-group-tx-retire-");
    const workspaceDir = await makeTempDir("openbot-group-tx-retire-ws-");
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fsp.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fsp.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const groupId = "grp-panda-unique";
    const publicSessionId = buildCollaborationSpaceSessionId(groupId);
    const mirrorSessionId = "group-panda-deadbeef";
    const mainSessionsDir = path.join(stateDir, "agents", "main", "sessions");
    const pandaSessionsDir = path.join(stateDir, "agents", "panda", "sessions");
    const storePath = path.join(mainSessionsDir, "sessions.json");
    const pandaStorePath = path.join(pandaSessionsDir, "sessions.json");
    const mirrorFile = path.join(pandaSessionsDir, `${mirrorSessionId}.jsonl`);
    writeLegacyTranscript(mirrorFile, mirrorSessionId, [
      {
        id: "msg-panda",
        role: "user",
        content: [{ type: "text", text: "panda leftover group talk" }],
        timestamp: 3000,
      },
    ]);
    fs.mkdirSync(mainSessionsDir, { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        [`space:${groupId}`]: {
          sessionId: publicSessionId,
          groupId,
          space: groupId,
          updatedAt: Date.now(),
        },
      }),
      "utf-8",
    );
    fs.mkdirSync(pandaSessionsDir, { recursive: true });
    fs.writeFileSync(
      pandaStorePath,
      JSON.stringify({
        [`agent:panda:main:space:${groupId}`]: {
          sessionId: mirrorSessionId,
          sessionFile: mirrorFile,
          groupId,
          space: groupId,
          updatedAt: Date.now(),
        },
      }),
      "utf-8",
    );

    const shared = await bindGroupPublicTranscript({
      groupId,
      sessionId: publicSessionId,
      storePath,
    });

    expect(fs.readFileSync(shared, "utf-8")).toContain("panda leftover group talk");
    expect(fs.existsSync(mirrorFile)).toBe(false);
    const pandaStore = JSON.parse(fs.readFileSync(pandaStorePath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(pandaStore[`agent:panda:main:space:${groupId}`]).toBeUndefined();
    const mainStore = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<string, unknown>;
    expect(mainStore[`space:${groupId}`]).toBeDefined();
    expect(mainStore[`agent:panda:main:space:${groupId}`]).toBeUndefined();
  });

  it("does not resurrect a checkpoint tail from a larger agent mirror once the shared transcript is bound", async () => {
    const stateDir = await makeTempDir("openbot-group-tx-restore-");
    const workspaceDir = await makeTempDir("openbot-group-tx-restore-ws-");
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fsp.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fsp.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const groupId = "grp-checkpoint-restore";
    const sessionId = buildCollaborationSpaceSessionId(groupId);
    const shared = resolveGroupPublicTranscriptPath(groupId);
    const kept = "论文标题已确认，继续这一题";
    const tail = "刚才打错字了，是论文";
    writeLegacyTranscript(shared, sessionId, [
      {
        id: "entry-kept",
        role: "assistant",
        content: [{ type: "text", text: kept }],
        timestamp: 1_000,
      },
      {
        id: "entry-tail",
        role: "user",
        content: [{ type: "text", text: tail }],
        timestamp: 2_000,
      },
    ]);
    // Typed session entries: truncate matches the top-level id, same as restore.
    const typed = [
      JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id: sessionId }),
      JSON.stringify({
        type: "message",
        id: "entry-kept",
        parentId: null,
        message: {
          role: "assistant",
          content: [{ type: "text", text: kept }],
          timestamp: 1_000,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "entry-tail",
        parentId: "entry-kept",
        message: {
          role: "user",
          content: [{ type: "text", text: tail }],
          timestamp: 2_000,
        },
      }),
    ].join("\n");
    fs.writeFileSync(shared, `${typed}\n`, "utf-8");

    const trunc = await truncateTranscriptToBoundary({
      transcriptPath: shared,
      boundaryMessageId: "entry-kept",
      archivePath: path.join(path.dirname(shared), "transcript.jsonl.archive", "cp.jsonl"),
    });
    expect(trunc.truncated).toBe(true);

    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    const storePath = path.join(sessionsDir, "sessions.json");
    const mirrorFile = path.join(sessionsDir, `${sessionId}.jsonl`);
    writeLegacyTranscript(mirrorFile, sessionId, [
      {
        id: "entry-kept",
        role: "assistant",
        content: [{ type: "text", text: kept }],
        timestamp: 1_000,
      },
      {
        id: "entry-tail",
        role: "user",
        content: [{ type: "text", text: tail }],
        timestamp: 2_000,
      },
      {
        id: "entry-later",
        role: "assistant",
        content: [{ type: "text", text: "唤醒正常、身份稳定" }],
        timestamp: 3_000,
      },
    ]);
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        [`space:${groupId}`]: {
          sessionId,
          sessionFile: shared,
          groupId,
          space: groupId,
          updatedAt: Date.now(),
        },
      }),
      "utf-8",
    );

    const rebound = await bindGroupPublicTranscript({
      groupId,
      sessionId,
      storePath,
      existingSessionFile: shared,
    });
    const body = fs.readFileSync(rebound, "utf-8");
    expect(body).toContain(kept);
    expect(body).not.toContain(tail);
    expect(body).not.toContain("唤醒正常、身份稳定");

    await dropDivergentGroupTranscriptMirrors({
      groupId,
      sessionId,
      storePath,
      sharedTranscriptPath: rebound,
    });
    expect(fs.existsSync(mirrorFile)).toBe(false);
    expect(fs.readFileSync(rebound, "utf-8")).not.toContain(tail);
  });
});
