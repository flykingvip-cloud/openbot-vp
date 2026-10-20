import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { recoverLatestVisibleAssistantText } from "../../gateway/collaboration-dispatch/visible-reply.js";
import { isGroupPublicTranscriptSessionFile } from "../../gateway/collaboration-learning/collaboration-paths.js";
import { openSessionManager } from "../pi-sdk/session.js";
import { guardSessionManager } from "../session-tool-result-guard-wrapper.js";
import { prepareSessionManagerForRun } from "./session-manager-init.js";

type TranscriptLine = {
  type?: string;
  message?: { role?: string; content?: unknown; details?: unknown };
};

let tempRoot: string | undefined;

afterEach(async () => {
  if (!tempRoot) {
    return;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

async function makeGroupPublicTranscriptPath(): Promise<{
  dir: string;
  transcriptPath: string;
  sessionId: string;
}> {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-group-public-sm-"));
  const groupId = "grp-shared-transcript-test";
  const runtimeDir = path.join(tempRoot, "groups", groupId, "runtime");
  await fs.mkdir(runtimeDir, { recursive: true });
  const transcriptPath = path.join(runtimeDir, "transcript.jsonl");
  const sessionId = "sess-group-public-1";
  expect(isGroupPublicTranscriptSessionFile(transcriptPath)).toBe(true);
  return { dir: tempRoot, transcriptPath, sessionId };
}

async function writeGatewayStyleTranscript(params: {
  transcriptPath: string;
  sessionId: string;
  cwd: string;
  userText: string;
}): Promise<void> {
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: params.sessionId,
    timestamp: new Date(0).toISOString(),
    cwd: params.cwd,
  };
  // Gateway early-persist now writes a proper session entry (type/id/parentId).
  const userLine = {
    type: "message",
    id: "local-round-1",
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: params.userText }],
      timestamp: Date.now(),
      idempotencyKey: "local-round-1",
    },
  };
  await fs.writeFile(
    params.transcriptPath,
    `${JSON.stringify(header)}\n${JSON.stringify(userLine)}\n`,
    "utf-8",
  );
}

async function readTranscriptMessages(transcriptPath: string): Promise<TranscriptLine[]> {
  const raw = await fs.readFile(transcriptPath, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TranscriptLine);
}

function messageRoles(lines: TranscriptLine[]): string[] {
  return lines
    .map((line) => line.message?.role)
    .filter((role): role is string => typeof role === "string");
}

describe("prepareSessionManagerForRun GROUP_PUBLIC", () => {
  it("does not wipe header+user GROUP_PUBLIC transcripts (original wipe motivation)", async () => {
    const { transcriptPath, sessionId, dir } = await makeGroupPublicTranscriptPath();
    await writeGatewayStyleTranscript({
      transcriptPath,
      sessionId,
      cwd: dir,
      userText: "please run ls",
    });

    const sessionManager = openSessionManager(transcriptPath);
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile: transcriptPath,
      hadSessionFile: true,
      sessionId,
      cwd: dir,
    });

    const lines = await readTranscriptMessages(transcriptPath);
    expect(messageRoles(lines)).toEqual(["user"]);
    expect(lines[0]?.type).toBe("session");
  });

  it("still resets non-GROUP_PUBLIC header+no-assistant files", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-private-sm-"));
    const transcriptPath = path.join(tempRoot, "private-session.jsonl");
    const sessionId = "sess-private-1";
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: tempRoot,
    };
    await fs.writeFile(
      transcriptPath,
      `${JSON.stringify(header)}\n${JSON.stringify({
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        message: { role: "user", content: [{ type: "text", text: "orphan user" }] },
      })}\n`,
      "utf-8",
    );
    expect(isGroupPublicTranscriptSessionFile(transcriptPath)).toBe(false);

    const sessionManager = openSessionManager(transcriptPath);
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile: transcriptPath,
      hadSessionFile: true,
      sessionId,
      cwd: tempRoot,
    });

    // Unlink the on-disk file; in-memory header remains until first assistant flush
    // (SessionManager then creates via openSync "wx").
    await expect(fs.access(transcriptPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((sessionManager as unknown as { flushed: boolean }).flushed).toBe(false);
  });
});

describe("collaboration round shared transcript append path", () => {
  it("keeps one user turn and retains toolResult EXIT on shared GROUP_PUBLIC file", async () => {
    const { transcriptPath, sessionId, dir } = await makeGroupPublicTranscriptPath();
    const userText = "run echo and report exit";
    await writeGatewayStyleTranscript({
      transcriptPath,
      sessionId,
      cwd: dir,
      userText,
    });

    const hadSessionFile = true;
    const sessionManager = guardSessionManager(openSessionManager(transcriptPath), {
      skipUserTranscriptPersist: true,
    });
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile: transcriptPath,
      hadSessionFile,
      sessionId,
      cwd: dir,
    });

    // Simulate the agent attempting to re-ingest the user (must be blocked).
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: userText }],
      timestamp: Date.now(),
    } as Parameters<SessionManager["appendMessage"]>[0]);

    sessionManager.appendMessage({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_exec_1",
          name: "exec",
          arguments: { command: "echo hi" },
        },
      ],
      timestamp: Date.now(),
      stopReason: "toolUse",
    } as unknown as Parameters<SessionManager["appendMessage"]>[0]);

    sessionManager.appendMessage({
      role: "toolResult",
      toolCallId: "call_exec_1",
      toolName: "exec",
      content: [{ type: "text", text: "hi\nEXIT:0" }],
      isError: false,
      timestamp: Date.now(),
      details: { status: "completed", exitCode: 0 },
    } as Parameters<SessionManager["appendMessage"]>[0]);

    const finalAssistantText = "Command completed successfully with exit 0.";
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: finalAssistantText }],
      timestamp: Date.now(),
      stopReason: "end_turn",
    } as unknown as Parameters<SessionManager["appendMessage"]>[0]);

    // Gateway still appends the labeled final assistant onto the shared transcript.
    await fs.appendFile(
      transcriptPath,
      `${JSON.stringify({
        message: {
          role: "assistant",
          content: [{ type: "text", text: finalAssistantText }],
          timestamp: Date.now(),
          senderLabel: "BotA",
          agentId: "bot-a",
          collaborationRoundId: "round-1",
        },
      })}\n`,
      "utf-8",
    );

    const lines = await readTranscriptMessages(transcriptPath);
    const roles = messageRoles(lines);
    const userCount = roles.filter((role) => role === "user").length;
    expect(userCount).toBe(1);
    expect(roles).toContain("toolResult");

    const toolResultLine = lines.find((line) => line.message?.role === "toolResult");
    expect(toolResultLine).toBeDefined();
    const toolContent = toolResultLine?.message?.content;
    const toolText = Array.isArray(toolContent)
      ? toolContent
          .map((block) => {
            if (!block || typeof block !== "object" || !("text" in block)) {
              return "";
            }
            const text = (block as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          })
          .join("")
      : "";
    expect(toolText).toContain("EXIT:0");

    // No scratch redirect: SessionManager wrote into the shared transcript only.
    const scratchHits = await fs
      .readdir(dir, { recursive: true })
      .then((entries) =>
        entries
          .map(String)
          .filter(
            (name) => path.basename(name).startsWith("collab-round-") && name.endsWith(".jsonl"),
          ),
      );
    expect(scratchHits).toEqual([]);
    expect(isGroupPublicTranscriptSessionFile(transcriptPath)).toBe(true);

    const historyMessages = lines
      .map((line) => line.message)
      .filter((message): message is NonNullable<typeof message> => Boolean(message));
    const recovered = recoverLatestVisibleAssistantText({
      messages: historyMessages,
      sinceMs: 0,
    });
    expect(recovered).toBe(finalAssistantText);
  });
});
