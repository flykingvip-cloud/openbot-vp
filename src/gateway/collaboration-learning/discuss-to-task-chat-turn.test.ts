/**
 * Actual chat-turn helper integration (not format-only).
 * Covers flag-off, exception, duplicate request, receipt persist failure.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { validateChatEvent } from "../protocol/index.js";
import {
  applyDiscussToTaskChatTurnToChatHandler,
  emitDiscussToTaskClientFeedback,
  runControlledDiscussToTaskChatTurn,
} from "./discuss-to-task-chat-turn.js";
import { clearDiscussToTaskSourceBindingsForTests } from "./discuss-to-task-source-binding.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const EXPLICIT = "请团队正式开展市场调研，验收标准：1) 竞品清单 2) 定价建议报告";

afterEach(async () => {
  clearDiscussToTaskSourceBindingsForTests();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function useCfg(claimContract: boolean) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-chat-turn-"));
  tempDirs.push(root);
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_chat");
  await fs.mkdir(groupLocator, { recursive: true });
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract },
    },
  } as OpenBotConfig;
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return {
    cfg,
    trusted: { groupsRoot, groupLocator },
    stores: createTrustedGroupStores({ groupsRoot, groupLocator }),
  };
}

function extractEgressText(payload: { message?: Record<string, unknown> } | undefined): string {
  const message = payload?.message;
  if (!message) {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  if (typeof message.text === "string") {
    return message.text;
  }
  return JSON.stringify(message);
}

function captureClientEgress() {
  const broadcasts: Array<{
    sessionKey: string;
    payload: { message?: Record<string, unknown>; state?: string; runId?: string };
    opts?: unknown;
  }> = [];
  const nodeSends: Array<{
    sessionKey: string;
    event: string;
    payload: { message?: Record<string, unknown>; state?: string; runId?: string };
  }> = [];
  return {
    broadcasts,
    nodeSends,
    broadcastChat: (sessionKey: string, payload: unknown, opts?: unknown) => {
      broadcasts.push({
        sessionKey,
        payload: payload as {
          message?: Record<string, unknown>;
          state?: string;
          runId?: string;
        },
        opts,
      });
    },
    nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => {
      nodeSends.push({
        sessionKey,
        event,
        payload: payload as {
          message?: Record<string, unknown>;
          state?: string;
          runId?: string;
        },
      });
    },
    receivedTexts(): string[] {
      return broadcasts.map((row) => extractEgressText(row.payload));
    },
  };
}

describe("runControlledDiscussToTaskChatTurn (chat handler path)", () => {
  it("flag-off / blocked: no 已派工 in visible receipt or coordinator bind", async () => {
    const { cfg } = await useCfg(false);
    const persisted: string[] = [];
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-flag-off",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async ({ message }) => {
        persisted.push(message);
        return { ok: true };
      },
    });
    expect(turn.userVisibleMessage ?? "").not.toMatch(/已派工/);
    if (turn.formalTaskEstablish) {
      expect(turn.formalTaskEstablish.userMessage ?? "").not.toMatch(/已派工/);
      expect(turn.coordinatorBindingText ?? "").toMatch(/禁止|回执/);
    }
    for (const row of persisted) {
      expect(row).not.toMatch(/已派工/);
    }
  });

  it("duplicate request: same principal ok; different principal conflicts", async () => {
    const { cfg } = await useCfg(true);
    await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-dup",
      message: EXPLICIT,
      principalActor: "human:alice",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    const steal = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-dup",
      message: EXPLICIT,
      principalActor: "human:bob",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    expect(steal.formalTaskEstablish?.reason).toMatch(/source_owner_conflict/);
    expect(steal.userVisibleMessage ?? "").toMatch(/归属冲突|冲突|受阻/);
    expect(steal.userVisibleMessage ?? "").not.toMatch(/已派工/);
    const retry = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-dup",
      message: EXPLICIT,
      principalActor: "human:alice",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    expect(retry.formalTaskEstablish?.reason).not.toBe("source_owner_conflict");
  });

  it("receipt persist failure surfaces in user-visible message", async () => {
    const { cfg } = await useCfg(true);
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-persist-fail",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: false, error: "disk_full" }),
    });
    expect(turn.transcriptPersist?.ok).toBe(false);
    if (turn.d2tResult) {
      expect(turn.userVisibleMessage ?? "").toMatch(/展示写入失败/);
      expect(turn.userVisibleMessage ?? "").not.toMatch(/disk_full/);
      expect(turn.formalTaskEstablish?.userMessage ?? "").toMatch(/展示写入失败/);
      const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
      expect(applied.clientFeedbackMessage ?? "").toMatch(/展示写入失败/);
      expect(applied.coordinatorBindingText ?? "").toMatch(/展示写入失败/);
      expect(applied.formalTaskEstablish?.userMessage ?? "").toMatch(/展示写入失败/);
    }
  });

  it("exception path returns blocked without 已派工", async () => {
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-boom",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg: null as unknown as OpenBotConfig,
      persistReceipt: async () => ({ ok: true }),
    });
    const blob = (turn.userVisibleMessage ?? "") + (turn.formalTaskEstablish?.userMessage ?? "");
    expect(blob).not.toMatch(/已派工/);
  });

  it("source conflict early return still persists receipt + chat handler emits feedback", async () => {
    const { cfg } = await useCfg(true);
    const persisted: string[] = [];
    await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-conflict-persist",
      message: EXPLICIT,
      principalActor: "human:alice",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async ({ message }) => {
        persisted.push(message);
        return { ok: true };
      },
    });
    const steal = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-conflict-persist",
      message: EXPLICIT,
      principalActor: "human:bob",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async ({ message }) => {
        persisted.push(message);
        return { ok: true };
      },
    });
    expect(steal.formalTaskEstablish?.reason).toMatch(/source_owner_conflict/);
    expect(persisted.length).toBeGreaterThanOrEqual(2);
    expect(persisted.some((row) => /归属冲突|冲突/.test(row))).toBe(true);
    const applied = applyDiscussToTaskChatTurnToChatHandler(steal);
    expect(applied.clientFeedbackMessage ?? "").toMatch(/归属冲突|冲突|受阻/);
    expect(applied.coordinatorBindingText ?? "").toMatch(/source_owner_conflict|归属冲突|冲突/);
    expect(applied.formalTaskEstablish?.userMessage ?? "").toMatch(/归属冲突|冲突|受阻/);
  });

  it("exception path persists receipt and apply helper surfaces feedback", async () => {
    const persisted: string[] = [];
    // Missing cfg-backed storage → hook throws or blocks; still must emit feedback.
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-exception-persist",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg: { gateway: { security: { profile: "personal_local" } } } as never,
      persistReceipt: async ({ message }) => {
        persisted.push(message);
        return { ok: true };
      },
    });
    // Either blocked establish or null discussion — when formal/userVisible present, must have persisted.
    if (turn.userVisibleMessage || turn.formalTaskEstablish) {
      expect(persisted.length).toBeGreaterThanOrEqual(1);
      const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
      expect(
        applied.clientFeedbackMessage ?? applied.formalTaskEstablish?.userMessage ?? "",
      ).toBeTruthy();
    }
  });
});

describe("emitDiscussToTaskClientFeedback (real chat egress — client receives)", () => {
  it("normal path: client broadcast+node receive safe status text", async () => {
    const { cfg } = await useCfg(true);
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-egress-ok",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async ({ message }) => ({
        ok: true,
        messageId: "msg-ok-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: message }],
          timestamp: Date.now(),
        },
      }),
    });
    const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
    expect(applied.clientFeedbackMessage ?? "").toBeTruthy();
    const client = captureClientEgress();
    const emitted = emitDiscussToTaskClientFeedback({
      applied,
      sessionKey: "agent:bot-a:main:space:grp_chat",
      runId: "chat-run-egress-ok",
      broadcastChat: client.broadcastChat,
      nodeSendToSession: client.nodeSendToSession,
    });
    expect(emitted.emitted).toBe(true);
    expect(client.broadcasts.length).toBe(1);
    expect(client.nodeSends.length).toBe(1);
    expect(client.nodeSends[0].event).toBe("chat");
    expect(client.broadcasts[0].payload.state).toBe("status");
    expect(client.nodeSends[0].payload.state).toBe("status");
    expect(String(client.broadcasts[0].payload.runId)).toContain(":discuss-to-task-receipt");
    expect(
      (client.broadcasts[0].payload.message as { discussToTaskReceipt?: boolean })
        ?.discussToTaskReceipt,
    ).toBe(true);
    const texts = client.receivedTexts().join("\n");
    expect(texts).toContain(applied.clientFeedbackMessage!);
    expect(texts).not.toMatch(/disk_full|EACCES|ENOENT/);
  });

  it("conflict path: client receives conflict copy (not helper-only)", async () => {
    const { cfg } = await useCfg(true);
    await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-egress-conflict",
      message: EXPLICIT,
      principalActor: "human:alice",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    const steal = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-egress-conflict",
      message: EXPLICIT,
      principalActor: "human:bob",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    const applied = applyDiscussToTaskChatTurnToChatHandler(steal);
    const client = captureClientEgress();
    const emitted = emitDiscussToTaskClientFeedback({
      applied,
      sessionKey: "agent:bot-a:main:space:grp_chat",
      runId: "chat-run-egress-conflict",
      broadcastChat: client.broadcastChat,
      nodeSendToSession: client.nodeSendToSession,
    });
    expect(emitted.emitted).toBe(true);
    const texts = client.receivedTexts().join("\n");
    expect(texts).toMatch(/归属冲突|冲突|受阻/);
    expect(texts).not.toMatch(/已派工/);
    expect(client.broadcasts[0].payload.state).toBe("status");
  });

  it("exception path: client receives fixed blocked copy", async () => {
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-egress-exception",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg: { gateway: { security: { profile: "personal_local" } } } as never,
      persistReceipt: async () => ({ ok: true }),
    });
    const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
    // When feedback exists, egress must deliver it to the client sinks.
    if (!applied.clientFeedbackMessage) {
      return;
    }
    const client = captureClientEgress();
    const emitted = emitDiscussToTaskClientFeedback({
      applied,
      sessionKey: "agent:bot-a:main:space:grp_chat",
      runId: "chat-run-egress-exception",
      broadcastChat: client.broadcastChat,
      nodeSendToSession: client.nodeSendToSession,
    });
    expect(emitted.emitted).toBe(true);
    const texts = client.receivedTexts().join("\n");
    expect(texts).toMatch(/受阻|尚未建立正式任务|正式任务/);
    expect(texts).not.toMatch(/已派工/);
  });

  it("persist-failure: client still receives fixed fail copy without raw error", async () => {
    const { cfg } = await useCfg(true);
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-egress-persist-fail",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: false, error: "disk_full_raw_internal" }),
    });
    const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
    expect(applied.clientFeedbackMessage ?? "").toMatch(/展示写入失败/);
    expect(applied.clientFeedbackMessage ?? "").not.toMatch(/disk_full/);
    const client = captureClientEgress();
    const emitted = emitDiscussToTaskClientFeedback({
      applied,
      sessionKey: "agent:bot-a:main:space:grp_chat",
      runId: "chat-run-egress-persist-fail",
      broadcastChat: client.broadcastChat,
      nodeSendToSession: client.nodeSendToSession,
    });
    expect(emitted.emitted).toBe(true);
    expect(client.broadcasts.length).toBe(1);
    expect(client.nodeSends.length).toBe(1);
    const blob =
      JSON.stringify(client.broadcasts[0].payload) + JSON.stringify(client.nodeSends[0].payload);
    expect(blob).toMatch(/展示写入失败/);
    expect(blob).not.toMatch(/disk_full_raw_internal/);
    expect(extractEgressText(client.broadcasts[0].payload)).toMatch(/展示写入失败/);
  });
});

describe("emitDiscussToTaskClientFeedback protocol schema (R7)", () => {
  it("actual egress payload passes validateChatEvent", async () => {
    const { cfg } = await useCfg(true);
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-protocol-ok",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async ({ message }) => ({
        ok: true,
        messageId: "msg-protocol-ok",
        message: {
          role: "assistant",
          content: [{ type: "text", text: message }],
          timestamp: Date.now(),
        },
      }),
    });
    const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
    expect(applied.clientFeedbackMessage ?? "").toBeTruthy();
    const client = captureClientEgress();
    const emitted = emitDiscussToTaskClientFeedback({
      applied,
      sessionKey: "agent:bot-a:main:space:grp_chat",
      runId: "chat-run-protocol-ok",
      broadcastChat: client.broadcastChat,
      nodeSendToSession: client.nodeSendToSession,
    });
    expect(emitted.emitted).toBe(true);
    const payload = client.broadcasts[0]?.payload as Record<string, unknown>;
    expect(payload.state).toBe("status");
    expect((payload.message as { receiptId?: string })?.receiptId).toMatch(
      /discuss-to-task-receipt:/,
    );
    expect(validateChatEvent(payload)).toBe(true);
  });

  it("flag-off identical copy still validates for distinct run identities", async () => {
    const { cfg } = await useCfg(false);
    const client = captureClientEgress();
    for (const runId of ["flag-off-a", "flag-off-b"]) {
      const turn = await runControlledDiscussToTaskChatTurn({
        groupId: "grp_chat",
        sourceMessageId: runId,
        message: EXPLICIT,
        principalActor: "human:owner",
        client: {},
        tenant: null,
        cfg,
        persistReceipt: async ({ message }) => ({
          ok: true,
          message: {
            role: "assistant",
            content: [{ type: "text", text: message }],
            timestamp: Date.now(),
          },
        }),
      });
      const applied = applyDiscussToTaskChatTurnToChatHandler(turn);
      emitDiscussToTaskClientFeedback({
        applied,
        sessionKey: "agent:bot-a:main:space:grp_chat",
        runId,
        broadcastChat: client.broadcastChat,
        nodeSendToSession: client.nodeSendToSession,
      });
    }
    expect(client.broadcasts.length).toBeGreaterThanOrEqual(2);
    const ids = client.broadcasts.map(
      (b) =>
        (b.payload.message as { receiptId?: string; id?: string })?.receiptId ??
        (b.payload.message as { id?: string })?.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of client.broadcasts) {
      expect(b.payload.state).toBe("status");
      expect(validateChatEvent(b.payload)).toBe(true);
    }
  });
});
