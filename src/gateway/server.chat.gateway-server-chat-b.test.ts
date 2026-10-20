import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { GetReplyOptions } from "../auto-reply/types.js";
import { __setMaxChatHistoryMessagesBytesForTest } from "./server-constants.js";
import {
  connectOk,
  getReplyFromConfig,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startServerWithClient,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });
const FAST_WAIT_OPTS = { timeout: 15000, interval: 100 } as const;
const BASE_IMAGE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3mIAAAAASUVORK5CYII=";

const sendReq = (
  ws: { send: (payload: string) => void },
  id: string,
  method: string,
  params: unknown,
) => {
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method,
      params,
    }),
  );
};

async function withGatewayChatHarness(
  run: (ctx: {
    ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
    createSessionDir: () => Promise<string>;
  }) => Promise<void>,
) {
  const tempDirs: string[] = [];
  const { server, ws } = await startServerWithClient();
  const createSessionDir = async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gw-"));
    tempDirs.push(sessionDir);
    testState.sessionStorePath = path.join(sessionDir, "sessions.json");
    return sessionDir;
  };

  try {
    await run({ ws, createSessionDir });
  } finally {
    __setMaxChatHistoryMessagesBytesForTest();
    testState.sessionStorePath = undefined;
    ws.close();
    await server.close();
    await Promise.all(
      tempDirs.map(async (dir) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            await fs.rm(dir, { recursive: true, force: true });
            return;
          } catch (error) {
            if (attempt === 4) {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          }
        }
      }),
    );
  }
}

async function writeMainSessionStore() {
  await writeSessionStore({
    entries: {
      main: { sessionId: "sess-main", updatedAt: Date.now() },
    },
  });
}

async function writeMainSessionTranscript(sessionDir: string, lines: string[]) {
  await fs.writeFile(path.join(sessionDir, "sess-main.jsonl"), `${lines.join("\n")}\n`, "utf-8");
}

function createActiveBotMember(agentId: string, name: string) {
  return {
    memberId: `bot:${agentId}`,
    memberKind: "bot" as const,
    agentId,
    name,
    governanceRole: "member" as const,
    status: "active" as const,
    joinedAtMs: 1,
    updatedAtMs: 1,
  };
}

function createOpenDiscussionOperatingState(groupId: string) {
  return {
    groupId,
    groupProfile: {
      displayName: groupId,
      expectedOutputs: [],
      successCriteria: [],
    },
    // Standing coordinator keeps primary/supplement staging deterministic in gateway turns.
    governance: { adminUserIds: [] as string[], coordinatorBotId: "bot-d" as string | null },
    collaborationPolicy: {
      humanStartsNewRound: true,
      mentionBotMustRespond: false,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: true,
      maxVisibleBotRepliesPerRound: 3,
      botMaySelfAdvanceWithoutHuman: false,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
    },
    memberRoleMap: [],
    activeContext: {
      currentOperatingPhase: "explore" as const,
      waitingForHuman: false,
      summary: "test",
      updatedAtMs: 1,
    },
    onboardingStatus: { initialized: true },
    groupMemoryRefs: { latestCapsuleIds: [] as string[] },
    updatedAtMs: 1,
  };
}

async function writeManagedSpace(
  groupId: string,
  payload: {
    profile?: unknown;
    members: unknown;
    operatingState?: unknown;
  },
) {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (!stateDir) {
    throw new Error("OPENCLAW_STATE_DIR is not set");
  }
  // Live catalog reads stateDir/collaboration/groups via resolveLiveCollaborationWorkspaceRoot.
  // File-store format matches spaces.test.ts: unwrapped profile (needs `name`) and members array.
  const groupDir = path.join(stateDir, "collaboration", "groups", encodeURIComponent(groupId));
  await fs.mkdir(groupDir, { recursive: true });
  if (payload.profile !== undefined) {
    const raw =
      payload.profile && typeof payload.profile === "object"
        ? (payload.profile as Record<string, unknown>)
        : {};
    const displayName =
      (typeof raw.displayName === "string" && raw.displayName) ||
      (typeof raw.name === "string" && raw.name) ||
      groupId;
    const profile = {
      ...raw,
      id: typeof raw.id === "string" ? raw.id : groupId,
      groupId: typeof raw.groupId === "string" ? raw.groupId : groupId,
      name: typeof raw.name === "string" ? raw.name : displayName,
      displayName,
      createdAtMs: typeof raw.createdAtMs === "number" ? raw.createdAtMs : 1,
      updatedAtMs: typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : 1,
    };
    await fs.writeFile(path.join(groupDir, "profile.json"), JSON.stringify(profile));
  }
  const members = Array.isArray(payload.members)
    ? payload.members
    : payload.members &&
        typeof payload.members === "object" &&
        Array.isArray((payload.members as { members?: unknown }).members)
      ? (payload.members as { members: unknown[] }).members
      : payload.members;
  await fs.writeFile(path.join(groupDir, "members.json"), JSON.stringify(members));
  if (payload.operatingState !== undefined) {
    await fs.writeFile(
      path.join(groupDir, "operating-state.json"),
      JSON.stringify(payload.operatingState),
    );
  }
}

async function writeWorkspaceGroupFile(groupId: string, filename: string, data: unknown) {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (!stateDir) {
    throw new Error("OPENCLAW_STATE_DIR is not set");
  }
  const groupDir = path.join(stateDir, "collaboration", "groups", encodeURIComponent(groupId));
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(path.join(groupDir, filename), JSON.stringify(data));
}

async function fetchHistoryMessages(
  ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"],
  sessionKey = "main",
): Promise<unknown[]> {
  const historyRes = await rpcReq<{ messages?: unknown[] }>(ws, "chat.history", {
    sessionKey,
    limit: 1000,
  });
  expect(historyRes.ok).toBe(true);
  return historyRes.payload?.messages ?? [];
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const entry = message as { text?: unknown; content?: unknown };
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (typeof entry.content === "string") {
    return entry.content;
  }
  if (Array.isArray(entry.content)) {
    return entry.content
      .map((block) =>
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? ((block as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

describe("gateway server chat", () => {
  test("smoke: caps history payload and preserves routing metadata", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const historyMaxBytes = 64 * 1024;
      __setMaxChatHistoryMessagesBytesForTest(historyMaxBytes);
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const bigText = "x".repeat(2_000);
      const historyLines: string[] = [];
      for (let i = 0; i < 45; i += 1) {
        historyLines.push(
          JSON.stringify({
            message: {
              role: "user",
              content: [{ type: "text", text: `${i}:${bigText}` }],
              timestamp: Date.now() + i,
            },
          }),
        );
      }
      await writeMainSessionTranscript(sessionDir, historyLines);
      const messages = await fetchHistoryMessages(ws);
      const bytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
      expect(bytes).toBeLessThanOrEqual(historyMaxBytes);
      expect(messages.length).toBeLessThan(45);

      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastTo: "+1555",
          },
        },
      });

      const sendRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-route",
      });
      expect(sendRes.ok).toBe(true);

      const sessionStorePath = testState.sessionStorePath;
      if (!sessionStorePath) {
        throw new Error("expected session store path");
      }
      const stored = JSON.parse(await fs.readFile(sessionStorePath, "utf-8")) as Record<
        string,
        { lastChannel?: string; lastTo?: string } | undefined
      >;
      expect(stored["agent:main:main"]?.lastChannel).toBe("whatsapp");
      expect(stored["agent:main:main"]?.lastTo).toBe("+1555");
    });
  });

  test("chat.send does not force-disable block streaming", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const spy = getReplyFromConfig;
      await connectOk(ws);

      await createSessionDir();
      await writeMainSessionStore();
      testState.agentConfig = { blockStreamingDefault: "on" };
      try {
        spy.mockClear();
        let capturedOpts: GetReplyOptions | undefined;
        spy.mockImplementationOnce(async (_ctx: unknown, opts?: GetReplyOptions) => {
          capturedOpts = opts;
          return undefined;
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: "main",
          message: "hello",
          idempotencyKey: "idem-block-streaming",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(() => {
          expect(spy.mock.calls.length).toBeGreaterThan(0);
        }, FAST_WAIT_OPTS);

        expect(capturedOpts?.disableBlockStreaming).toBeUndefined();
      } finally {
        testState.agentConfig = undefined;
      }
    });
  });

  test("chat.history hard-caps single oversized nested payloads", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const historyMaxBytes = 64 * 1024;
      __setMaxChatHistoryMessagesBytesForTest(historyMaxBytes);
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const hugeNestedText = "n".repeat(120_000);
      const oversizedLine = JSON.stringify({
        message: {
          role: "assistant",
          timestamp: Date.now(),
          content: [
            {
              type: "tool_result",
              toolUseId: "tool-1",
              output: {
                nested: {
                  payload: hugeNestedText,
                },
              },
            },
          ],
        },
      });
      await writeMainSessionTranscript(sessionDir, [oversizedLine]);
      const messages = await fetchHistoryMessages(ws);
      expect(messages.length).toBe(1);

      const serialized = JSON.stringify(messages);
      const bytes = Buffer.byteLength(serialized, "utf8");
      expect(bytes).toBeLessThanOrEqual(historyMaxBytes);
      expect(serialized).toContain("[chat.history omitted: message too large]");
      expect(serialized.includes(hugeNestedText.slice(0, 256))).toBe(false);
    });
  });

  test("chat.history keeps recent small messages when latest message is oversized", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const historyMaxBytes = 64 * 1024;
      __setMaxChatHistoryMessagesBytesForTest(historyMaxBytes);
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const baseText = "s".repeat(1_200);
      const lines: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        lines.push(
          JSON.stringify({
            message: {
              role: "user",
              timestamp: Date.now() + i,
              content: [{ type: "text", text: `small-${i}:${baseText}` }],
            },
          }),
        );
      }

      const hugeNestedText = "z".repeat(120_000);
      lines.push(
        JSON.stringify({
          message: {
            role: "assistant",
            timestamp: Date.now() + 1_000,
            content: [
              {
                type: "tool_result",
                toolUseId: "tool-1",
                output: {
                  nested: {
                    payload: hugeNestedText,
                  },
                },
              },
            ],
          },
        }),
      );

      await writeMainSessionTranscript(sessionDir, lines);
      const messages = await fetchHistoryMessages(ws);
      const serialized = JSON.stringify(messages);
      const bytes = Buffer.byteLength(serialized, "utf8");

      expect(bytes).toBeLessThanOrEqual(historyMaxBytes);
      expect(messages.length).toBeGreaterThan(1);
      expect(serialized).toContain("small-29:");
      expect(serialized).toContain("[chat.history omitted: message too large]");
      expect(serialized.includes(hugeNestedText.slice(0, 256))).toBe(false);
    });
  });

  test("chat.history strips inline directives from displayed message text", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const lines = [
        JSON.stringify({
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Hello [[reply_to_current]] world [[audio_as_voice]]" },
            ],
            timestamp: Date.now(),
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: "A [[reply_to:abc-123]] B",
            timestamp: Date.now() + 1,
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            text: "[[ reply_to : 456 ]] C",
            timestamp: Date.now() + 2,
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "  keep padded  " }],
            timestamp: Date.now() + 3,
          },
        }),
      ];
      await writeMainSessionTranscript(sessionDir, lines);
      const messages = await fetchHistoryMessages(ws);
      expect(messages.length).toBe(4);

      const serialized = JSON.stringify(messages);
      expect(serialized.includes("[[reply_to")).toBe(false);
      expect(serialized.includes("[[audio_as_voice]]")).toBe(false);

      const first = messages[0] as { content?: Array<{ text?: string }> };
      const second = messages[1] as { content?: string };
      const third = messages[2] as { text?: string };
      const fourth = messages[3] as { content?: Array<{ text?: string }> };

      expect(first.content?.[0]?.text?.replace(/\s+/g, " ").trim()).toBe("world");
      expect(second.content?.replace(/\s+/g, " ").trim()).toBe("B");
      expect(third.text?.replace(/\s+/g, " ").trim()).toBe("C");
      expect(fourth.content?.[0]?.text).toBe("keep padded  ");
    });
  });

  test("smoke: supports abort and idempotent completion", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const spy = getReplyFromConfig;
      let aborted = false;
      await connectOk(ws);

      await createSessionDir();
      await writeMainSessionStore();

      spy.mockClear();
      spy.mockImplementationOnce(async (_ctx, opts) => {
        opts?.onAgentRunStart?.(opts.runId ?? "idem-abort-1");
        const signal = opts?.abortSignal;
        await new Promise<void>((resolve) => {
          if (!signal || signal.aborted) {
            aborted = Boolean(signal?.aborted);
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        return undefined;
      });

      const sendResP = onceMessage(ws, (o) => o.type === "res" && o.id === "send-abort-1", 2_000);
      sendReq(ws, "send-abort-1", "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-abort-1",
        timeoutMs: 30_000,
      });

      const sendRes = await sendResP;
      expect(sendRes.ok).toBe(true);
      await vi.waitFor(() => {
        expect(spy.mock.calls.length).toBeGreaterThan(0);
      }, FAST_WAIT_OPTS);

      const inFlight = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-abort-1",
      });
      expect(inFlight.ok).toBe(true);
      expect(["started", "in_flight", "ok"]).toContain(inFlight.payload?.status ?? "");

      const abortRes = await rpcReq<{ aborted?: boolean }>(ws, "chat.abort", {
        sessionKey: "main",
        runId: "idem-abort-1",
      });
      expect(abortRes.ok).toBe(true);
      expect(abortRes.payload?.aborted).toBe(true);
      await vi.waitFor(() => {
        expect(aborted).toBe(true);
      }, FAST_WAIT_OPTS);

      spy.mockClear();
      spy.mockResolvedValueOnce(undefined);

      const completeRes = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-complete-1",
      });
      expect(completeRes.ok).toBe(true);

      await vi.waitFor(async () => {
        const again = await rpcReq<{ status?: string }>(ws, "chat.send", {
          sessionKey: "main",
          message: "hello",
          idempotencyKey: "idem-complete-1",
        });
        expect(again.ok).toBe(true);
        expect(again.payload?.status).toBe("ok");
      }, FAST_WAIT_OPTS);
    });
  });

  test("space chat open discussion fans out to active bots and caps visible replies at three", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      const groupId = "open-discussion-alpha";
      try {
        await connectOk(ws);
        await createSessionDir();
        const openDiscussionState = createOpenDiscussionOperatingState(groupId);
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Open Discussion",
            coordinatorBotId: "bot-d",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [
            createActiveBotMember("bot-a", "Bot A"),
            createActiveBotMember("bot-b", "Bot B"),
            createActiveBotMember("bot-c", "Bot C"),
            createActiveBotMember("bot-d", "Bot D"),
          ],
          operatingState: openDiscussionState,
        });
        await writeWorkspaceGroupFile(groupId, "operating-state.json", openDiscussionState);
        await writeSessionStore({
          entries: {
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
            [`agent:bot-b:main:space:${groupId}`]: {
              sessionId: "sess-bot-b",
              updatedAt: 20,
              groupId,
              displayName: "Bot B",
              collaborationParticipationOverlay: { groupId, botId: "bot-b", updatedAt: 1 },
            },
            [`agent:bot-c:main:space:${groupId}`]: {
              sessionId: "sess-bot-c",
              updatedAt: 30,
              groupId,
              displayName: "Bot C",
              collaborationParticipationOverlay: { groupId, botId: "bot-c", updatedAt: 1 },
            },
            [`agent:bot-d:main:space:${groupId}`]: {
              sessionId: "sess-bot-d",
              updatedAt: 40,
              groupId,
              displayName: "Bot D",
              collaborationParticipationOverlay: { groupId, botId: "bot-d", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "@bot-d @bot-c @bot-b 请继续开放讨论研究各个角度",
          idempotencyKey: "idem-space-open",
          // Keep primary deadline above cold dispatchInboundMessage cost so supplements run.
          timeoutMs: 60_000,
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(4);
        }, FAST_WAIT_OPTS);

        const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
        const assistantTexts = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map(extractMessageText);
        const assistantSenderLabels = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map((message) => (message as { senderLabel?: unknown }).senderLabel);

        expect(replySpy).toHaveBeenCalledTimes(3);
        expect(assistantTexts).toHaveLength(3);
        expect(assistantTexts.join("\n")).not.toContain("[Bot");
        expect(assistantSenderLabels).toEqual(["Bot D", "Bot C", "Bot B"]);
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat sends attachment context to bots and stores visible file blocks", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      const groupId = "attachment-alpha";
      try {
        await connectOk(ws);
        await createSessionDir();
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Attachment",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [createActiveBotMember("bot-a", "Bot A")],
        });
        await writeSessionStore({
          entries: {
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-attachment-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => ({
          text: (ctx.BodyForAgent ?? "").includes("feasibility")
            ? "I can see the attachment"
            : "I cannot see the attachment",
        }));

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "please review",
          attachments: [
            {
              type: "file",
              mimeType: "text/plain",
              fileName: "feasibility.txt",
              content: Buffer.from("feasibility report").toString("base64"),
            },
          ],
          idempotencyKey: "idem-space-attachment",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        expect(replySpy).toHaveBeenCalledTimes(1);
        const botContext = String(replySpy.mock.calls[0]?.[0].BodyForAgent ?? "");
        expect(botContext).toContain('<attachment name="feasibility.txt"');
        expect(botContext).toContain("feasibility report");

        const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
        const userMessage = messages.find(
          (message) =>
            message &&
            typeof message === "object" &&
            (message as { role?: unknown }).role === "user",
        ) as { content?: unknown } | undefined;
        expect(userMessage?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "file",
              fileName: "feasibility.txt",
              mimeType: "text/plain",
              status: "sent",
            }),
          ]),
        );
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat stages image attachments as media paths for bots", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      const groupId = "attachment-image-alpha";
      try {
        await connectOk(ws);
        await createSessionDir();
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Attachment Image",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [createActiveBotMember("bot-a", "Bot A")],
        });
        await writeSessionStore({
          entries: {
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-attachment-image-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockResolvedValue({ text: "I can see the image attachment" });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "please inspect this image",
          attachments: [
            {
              type: "image",
              mimeType: "image/png",
              fileName: "tiny.png",
              content: BASE_IMAGE_PNG,
            },
          ],
          idempotencyKey: "idem-space-image-attachment",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(() => {
          expect(replySpy).toHaveBeenCalledTimes(1);
        }, FAST_WAIT_OPTS);
        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        const botContext = replySpy.mock.calls[0]?.[0];
        const replyOptions = replySpy.mock.calls[0]?.[1];
        expect(botContext?.BodyForAgent).toContain(
          '<attachment name="tiny.png" mime="image/png" status="image_input">',
        );
        expect(botContext?.MediaPath).toContain("webchat-uploads");
        expect(botContext?.MediaPaths).toEqual([botContext?.MediaPath]);
        expect(botContext?.MediaType).toBe("image/png");
        await expect(fs.stat(String(botContext?.MediaPath))).resolves.toMatchObject({
          size: expect.any(Number),
        });
        expect(replyOptions?.images).toEqual([
          expect.objectContaining({
            type: "image",
            mimeType: "image/png",
            data: BASE_IMAGE_PNG,
          }),
        ]);
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat open discussion routes default user turns only to the coordinator", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      const groupId = "priority-alpha";
      const operatingState = {
        groupId,
        groupProfile: {
          displayName: "Alpha Group",
          expectedOutputs: ["task", "review", "decision", "deliverable", "capsule"],
          successCriteria: [],
        },
        governance: {
          ownerUserId: "user-1",
          adminUserIds: [],
          coordinatorBotId: "bot-c",
        },
        collaborationPolicy: {
          humanStartsNewRound: true,
          mentionBotMustRespond: true,
          mentionHumanNotifiesOnly: true,
          openDiscussionWithoutMention: false,
          maxVisibleBotRepliesPerRound: 3,
          botMaySelfAdvanceWithoutHuman: false,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
        },
        memberRoleMap: [
          {
            memberId: "human:user-1",
            memberKind: "human",
            label: "UPBEYOND",
            governanceRole: "owner",
            status: "active",
          },
          {
            memberId: "bot:bot-a",
            memberKind: "bot",
            label: "Bot A",
            governanceRole: "member",
            collaborationRole: "final_decider",
            status: "active",
          },
          {
            memberId: "bot:bot-b",
            memberKind: "bot",
            label: "Bot B",
            governanceRole: "member",
            collaborationRole: "reviewer",
            status: "active",
          },
          {
            memberId: "bot:bot-c",
            memberKind: "bot",
            label: "Bot C",
            governanceRole: "member",
            collaborationRole: "coordinator",
            status: "active",
          },
          {
            memberId: "bot:bot-d",
            memberKind: "bot",
            label: "Bot D",
            governanceRole: "member",
            collaborationRole: "contributor",
            status: "active",
          },
        ],
        activeContext: {
          currentOperatingPhase: "decide",
          currentMission: "Converge on the next strategic decision.",
          currentDecisionId: "decision-priority-1",
          waitingForHuman: true,
          summary: "Decision stage is active.",
          updatedAtMs: 2,
        },
        onboardingStatus: {
          initialized: true,
        },
        groupMemoryRefs: {
          latestCapsuleIds: [],
        },
        updatedAtMs: 2,
      };
      try {
        await connectOk(ws);
        await createSessionDir();
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Alpha Group",
            coordinatorBotId: "bot-c",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [
            {
              memberId: "human:user-1",
              memberKind: "human",
              userId: "user-1",
              name: "UPBEYOND",
              governanceRole: "owner",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-a",
              memberKind: "bot",
              agentId: "bot-a",
              name: "Bot A",
              governanceRole: "member",
              collaborationRole: "final_decider",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-b",
              memberKind: "bot",
              agentId: "bot-b",
              name: "Bot B",
              governanceRole: "member",
              collaborationRole: "reviewer",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-c",
              memberKind: "bot",
              agentId: "bot-c",
              name: "Bot C",
              governanceRole: "member",
              collaborationRole: "coordinator",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-d",
              memberKind: "bot",
              agentId: "bot-d",
              name: "Bot D",
              governanceRole: "member",
              collaborationRole: "contributor",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
          ],
        });
        await writeWorkspaceGroupFile(groupId, "operating-state.json", operatingState);
        await writeSessionStore({
          entries: {
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
            [`agent:bot-b:main:space:${groupId}`]: {
              sessionId: "sess-bot-b",
              updatedAt: 20,
              groupId,
              displayName: "Bot B",
              collaborationParticipationOverlay: { groupId, botId: "bot-b", updatedAt: 1 },
            },
            [`agent:bot-c:main:space:${groupId}`]: {
              sessionId: "sess-bot-c",
              updatedAt: 30,
              groupId,
              displayName: "Bot C",
              collaborationParticipationOverlay: { groupId, botId: "bot-c", updatedAt: 1 },
            },
            [`agent:bot-d:main:space:${groupId}`]: {
              sessionId: "sess-bot-d",
              updatedAt: 40,
              groupId,
              displayName: "Bot D",
              collaborationParticipationOverlay: { groupId, botId: "bot-d", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "请大家收敛一下决策建议",
          idempotencyKey: "idem-space-role-priority",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        expect(replySpy).toHaveBeenCalledTimes(1);
        expect([`space:${groupId}`, `agent:main:space:${groupId}`]).toContain(
          replySpy.mock.calls[0]?.[0].SessionKey,
        );
        const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
        const assistantSenderLabels = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map((message) => (message as { senderLabel?: unknown }).senderLabel)
          .toSorted((left, right) => String(left).localeCompare(String(right)));
        expect(assistantSenderLabels).toEqual(["Bot C"]);
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat uses the managed group profile coordinator when no operating state exists", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      const groupId = "profile-coordinator-alpha";
      try {
        await connectOk(ws);
        await createSessionDir();
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Alpha Group",
            coordinatorBotId: "bot-b",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [
            {
              memberId: "bot:bot-a",
              memberKind: "bot",
              agentId: "bot-a",
              name: "Bot A",
              governanceRole: "member",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-b",
              memberKind: "bot",
              agentId: "bot-b",
              name: "Bot B",
              governanceRole: "member",
              collaborationRole: "coordinator",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
          ],
        });
        await writeSessionStore({
          entries: {
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
            [`agent:bot-b:main:space:${groupId}`]: {
              sessionId: "sess-bot-b",
              updatedAt: 20,
              groupId,
              displayName: "Bot B",
              collaborationParticipationOverlay: { groupId, botId: "bot-b", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "请把任务分配给当前小组成员",
          idempotencyKey: "idem-space-profile-coordinator",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        expect(replySpy).toHaveBeenCalledTimes(1);
        expect([`space:${groupId}`, `agent:main:space:${groupId}`]).toContain(
          replySpy.mock.calls[0]?.[0].SessionKey,
        );
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("@bot in a space chat only forces the mentioned bot to reply", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      try {
        await connectOk(ws);
        await createSessionDir();
        const groupId = "mention-alpha";
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Alpha",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [
            createActiveBotMember("bot-a", "Bot A"),
            createActiveBotMember("bot-b", "Bot B"),
          ],
        });
        await writeSessionStore({
          entries: {
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
            [`agent:bot-b:main:space:${groupId}`]: {
              sessionId: "sess-bot-b",
              updatedAt: 20,
              groupId,
              displayName: "Bot B",
              collaborationParticipationOverlay: { groupId, botId: "bot-b", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "@bot-a please answer",
          idempotencyKey: "idem-space-mention",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
        const assistantTexts = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map(extractMessageText);
        const assistantSenderLabels = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map((message) => (message as { senderLabel?: unknown }).senderLabel);

        expect(replySpy).toHaveBeenCalledTimes(1);
        expect(assistantTexts).toEqual([expect.not.stringContaining("[Bot A]")]);
        expect(assistantSenderLabels).toEqual(["Bot A"]);
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat resolves bot targets from group member sessions instead of direct space sessions", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      try {
        await connectOk(ws);
        await createSessionDir();
        const groupId = "ignore-direct-alpha";
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Alpha",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [createActiveBotMember("bot-a", "Bot A")],
        });
        await writeSessionStore({
          entries: {
            [`agent:bot-a:space:${groupId}`]: {
              sessionId: "sess-direct-bot-a",
              updatedAt: 100,
              chatType: "direct",
            },
            [`agent:bot-a:main:space:${groupId}`]: {
              sessionId: "sess-group-bot-a",
              updatedAt: 10,
              groupId,
              displayName: "Bot A",
              chatType: "group",
              collaborationParticipationOverlay: { groupId, botId: "bot-a", updatedAt: 1 },
            },
          },
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "open discussion",
          idempotencyKey: "idem-space-ignore-direct",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        const calledSessionKeys = replySpy.mock.calls.map((call) => call[0].SessionKey);
        expect(
          calledSessionKeys.some(
            (key) => key === `space:${groupId}` || key === `agent:main:space:${groupId}`,
          ),
        ).toBe(true);
        expect(calledSessionKeys).not.toContain(`agent:bot-a:main:space:${groupId}`);

        const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
        const assistantTexts = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map(extractMessageText);
        expect(assistantTexts.some((text) => /视角已表达完毕/.test(String(text)))).toBe(true);
        expect(assistantTexts.join("\n")).not.toContain("agent:bot-a:main:space");
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat auto-seeds missing active bot group sessions for existing groups", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      try {
        await connectOk(ws);
        await createSessionDir();
        const groupId = "autoseed-alpha";
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "Alpha Group",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [
            {
              memberId: "human:user-1",
              memberKind: "human",
              userId: "user-1",
              name: "UPBEYOND",
              governanceRole: "owner",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-a",
              memberKind: "bot",
              agentId: "bot-a",
              name: "Bot A",
              governanceRole: "member",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-b",
              memberKind: "bot",
              agentId: "bot-b",
              name: "Bot B",
              governanceRole: "member",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
          ],
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "open discussion",
          idempotencyKey: "idem-space-autoseed",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages).toHaveLength(2);
        }, FAST_WAIT_OPTS);

        expect(replySpy).toHaveBeenCalledTimes(1);
        expect([`space:${groupId}`, `agent:main:space:${groupId}`]).toContain(
          replySpy.mock.calls[0]?.[0].SessionKey,
        );

        const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
        const assistantSenderLabels = messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as { role?: unknown }).role === "assistant",
          )
          .map((message) => (message as { senderLabel?: unknown }).senderLabel);
        expect(assistantSenderLabels).toEqual(["Bot A"]);
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  test("space chat accepts unicode group ids for transcript paths", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const replySpy = getReplyFromConfig;
      const originalImplementation = replySpy.getMockImplementation();
      const groupId = "grp-daniel-hhd-gmail-com-试用小组";
      try {
        await connectOk(ws);
        await createSessionDir();
        await writeManagedSpace(groupId, {
          profile: {
            id: groupId,
            groupId,
            displayName: "试用小组",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          members: [
            {
              memberId: "human:user-1",
              memberKind: "human",
              userId: "user-1",
              name: "CEO",
              governanceRole: "owner",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
            {
              memberId: "bot:bot-a",
              memberKind: "bot",
              agentId: "bot-a",
              name: "Bot A",
              governanceRole: "member",
              status: "active",
              joinedAtMs: 1,
              updatedAtMs: 1,
            },
          ],
        });
        replySpy.mockClear();
        replySpy.mockImplementation(async (ctx) => {
          const agent =
            (ctx as { CollaborationBotAgentId?: string }).CollaborationBotAgentId ??
            ctx.SessionKey ??
            "bot";
          // Unique per-bot body so redundant-reply suppression does not drop peers.
          return { text: `${agent} 视角已表达完毕。` };
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: "你们都在嘛",
          idempotencyKey: "idem-space-unicode-group",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(async () => {
          const messages = await fetchHistoryMessages(ws, `space:${groupId}`);
          expect(messages.length).toBeGreaterThan(0);
        }, FAST_WAIT_OPTS);
      } finally {
        if (originalImplementation) {
          replySpy.mockImplementation(originalImplementation);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });
});
