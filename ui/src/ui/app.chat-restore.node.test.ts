/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  ChatRestoreNotConnectedError,
  resolveChatRestoreSessionKey,
  restoreShellChat,
  setChatActionsTestHooks,
  setChatRestoreClientTimeoutForTests,
} from "./app-chat-actions.ts";
import { OpenBotApp } from "./app.ts";

describe("resolveChatRestoreSessionKey", () => {
  it("prefers the visible workbench session when it diverges from sessionKey", () => {
    expect(
      resolveChatRestoreSessionKey({
        sessionKey: "agent:main:main",
        workbenchTeamSelectedKey: "agent:other:main",
      }),
    ).toBe("agent:other:main");
  });

  it("canonicalizes and binds collaboration space selected keys", () => {
    expect(
      resolveChatRestoreSessionKey({
        sessionKey: "agent:main:main",
        workbenchTeamSelectedKey: "agent:main:main:space:grp-demo",
        workbenchPrimaryModule: "collaboration",
      }),
    ).toBe("space:grp-demo");
  });

  it("keeps sessionKey when surfaces already match", () => {
    expect(
      resolveChatRestoreSessionKey({
        sessionKey: "agent:main:main",
        workbenchTeamSelectedKey: "agent:main:main",
      }),
    ).toBe("agent:main:main");
  });
});

describe("restoreShellChat", () => {
  it("throws when disconnected instead of silently returning", async () => {
    await expect(
      restoreShellChat({
        connected: false,
        sessionKey: "main",
        client: { request: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(ChatRestoreNotConnectedError);
  });

  it("calls chat.restore with the workbench session key", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    await restoreShellChat(
      {
        connected: true,
        sessionKey: "agent:stale:main",
        workbenchTeamSelectedKey: "agent:visible:main",
        client: { request },
      },
      "cp-1",
    );
    expect(request).toHaveBeenCalledWith("chat.restore", {
      sessionKey: "agent:visible:main",
      checkpointId: "cp-1",
      queueWhenActive: true,
    });
  });
});

describe("OpenBotApp chat restore", () => {
  it("calls chat.restore for the active session", async () => {
    const app = new OpenBotApp();
    app.connected = true;
    app.sessionKey = "main";
    const client = {
      request: vi.fn().mockResolvedValue({ ok: true, checkpointId: "cp-1" }),
    };
    app.client = client as never;

    await app.handleRestoreChat();

    expect(client.request).toHaveBeenCalledWith("chat.restore", {
      sessionKey: "main",
      queueWhenActive: true,
    });
  });

  it("surfaces a disconnected error and clears pendingRestore on early return", async () => {
    const app = new OpenBotApp();
    app.connected = false;
    app.client = null;
    app.pendingRestoreCheckpointId = "cp-stuck";

    await app.confirmRestoreCheckpoint("cp-stuck");

    expect(app.pendingRestoreCheckpointId).toBeNull();
    expect(app.lastError).toMatch(/disconnected|未连接/i);
    expect(app.restoreInFlightCheckpointId).toBeNull();
  });

  it("surfaces RPC failures, clears pendingRestore, and uses workbench session key", async () => {
    const app = new OpenBotApp();
    app.connected = true;
    app.sessionKey = "agent:stale:main";
    app.workbenchTeamSelectedKey = "agent:visible:main";
    app.pendingRestoreCheckpointId = "cp-1";
    app.chatCheckpoints = [
      {
        checkpointId: "cp-1",
        boundaryMessageId: "m0",
        createdAt: "2026-07-07T00:00:00.000Z",
        summary: "s",
        restorable: { files: true, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ] as never;
    const client = {
      request: vi.fn().mockRejectedValue(new Error("GatewayRequestError: boom")),
    };
    app.client = client as never;

    await app.confirmRestoreCheckpoint("cp-1");

    expect(client.request).toHaveBeenCalledWith("chat.restore", {
      sessionKey: "agent:visible:main",
      checkpointId: "cp-1",
      queueWhenActive: true,
    });
    expect(app.pendingRestoreCheckpointId).toBeNull();
    expect(app.restoreInFlightCheckpointId).toBeNull();
    expect(app.lastError).toMatch(/Restore failed|恢复失败/i);
    expect(app.lastError).toContain("boom");
  });
});

describe("OpenBotApp loadChatCheckpoints Phase A 恢复线", () => {
  it("fetches checkpoints for collaboration space session keys (no empty early-return)", async () => {
    const app = new OpenBotApp();
    app.connected = true;
    app.sessionKey = "agent:main:main";
    app.workbenchTeamSelectedKey = "agent:main:main:space:grp-demo";
    app.workbenchPrimaryModule = "collaboration";
    const checkpoints = [
      {
        checkpointId: "cp-space-1",
        boundaryMessageId: "m0",
        createdAt: "2026-07-07T00:00:00.000Z",
        summary: "space turn",
        restorable: { files: false, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ];
    const client = {
      request: vi.fn().mockResolvedValue({ checkpoints }),
    };
    app.client = client as never;

    await app.loadChatCheckpoints();

    expect(client.request).toHaveBeenCalledWith("chat.checkpoints.list", {
      sessionKey: "space:grp-demo",
    });
    expect(app.chatCheckpoints).toEqual(checkpoints);
  });
});

describe("OpenBotApp restore concurrency UX", () => {
  it("ignores further restore clicks while a restore is in flight", async () => {
    setChatActionsTestHooks({ reloadShellChatHistory: async () => {} });
    try {
      const app = new OpenBotApp();
      app.connected = true;
      app.sessionKey = "main";
      let resolveRequest!: (value: unknown) => void;
      const request = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      );
      app.client = { request } as never;
      app.chatCheckpoints = [
        {
          checkpointId: "cp-1",
          boundaryMessageId: "m0",
          createdAt: "2026-07-07T00:00:00.000Z",
          summary: "s",
          restorable: { files: true, transcript: true },
          externalEffects: { present: false, kinds: [] },
        },
      ] as never;

      const first = app.confirmRestoreCheckpoint("cp-1");
      await Promise.resolve();
      expect(app.restoreInFlightCheckpointId).toBe("cp-1");

      app.requestRestoreCheckpoint("cp-1");
      expect(app.pendingRestoreCheckpointId).toBeNull();

      await app.confirmRestoreCheckpoint("cp-1");
      expect(request).toHaveBeenCalledTimes(1);

      resolveRequest({ ok: true, checkpointId: "cp-1" });
      await first;
      expect(app.restoreInFlightCheckpointId).toBeNull();
    } finally {
      setChatActionsTestHooks(null);
    }
  });

  it("surfaces RESTORE_IN_PROGRESS with a clear busy message", async () => {
    const app = new OpenBotApp();
    app.connected = true;
    app.sessionKey = "main";
    const { GatewayRequestError } = await import("./gateway.ts");
    app.client = {
      request: vi.fn().mockRejectedValue(
        new GatewayRequestError({
          code: "UNAVAILABLE",
          message: "A restore is already in progress for this session. Wait for it to finish.",
          details: { reasonCode: "RESTORE_IN_PROGRESS" },
        }),
      ),
    } as never;
    app.chatCheckpoints = [
      {
        checkpointId: "cp-1",
        boundaryMessageId: "m0",
        createdAt: "2026-07-07T00:00:00.000Z",
        summary: "s",
        restorable: { files: true, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ] as never;

    await app.confirmRestoreCheckpoint("cp-1");
    expect(app.lastError).toMatch(/正在恢复|already in progress/i);
  });

  it("clears restoring state when chat.restore never returns", async () => {
    setChatRestoreClientTimeoutForTests(40);
    try {
      const app = new OpenBotApp();
      app.connected = true;
      app.sessionKey = "agent:bot-2:main";
      app.pendingRestoreCheckpointId = "cp-1";
      app.chatCheckpoints = [
        {
          checkpointId: "cp-1",
          boundaryMessageId: "m0",
          createdAt: "2026-07-07T00:00:00.000Z",
          summary: "s",
          restorable: { files: true, transcript: true },
          externalEffects: { present: false, kinds: [] },
        },
      ] as never;
      let release!: (value: unknown) => void;
      const request = vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      app.client = { request } as never;

      const pending = app.confirmRestoreCheckpoint("cp-1");
      await Promise.resolve();
      expect(app.restoreInFlightCheckpointId).toBe("cp-1");

      await pending;
      expect(app.restoreInFlightCheckpointId).toBeNull();
      expect(app.pendingRestoreCheckpointId).toBeNull();
      expect(app.lastError).toMatch(/恢复超时|timed out/i);
      release?.({ ok: true });
    } finally {
      setChatRestoreClientTimeoutForTests(null);
    }
  });

  it("maps gateway RESTORE_TIMEOUT onto the timeout message", async () => {
    const app = new OpenBotApp();
    app.connected = true;
    app.sessionKey = "main";
    const { GatewayRequestError } = await import("./gateway.ts");
    app.client = {
      request: vi.fn().mockRejectedValue(
        new GatewayRequestError({
          code: "UNAVAILABLE",
          message: "checkpoint restore timed out before the conversation was rolled back",
          details: { reasonCode: "RESTORE_TIMEOUT" },
        }),
      ),
    } as never;
    app.chatCheckpoints = [
      {
        checkpointId: "cp-1",
        boundaryMessageId: "m0",
        createdAt: "2026-07-07T00:00:00.000Z",
        summary: "s",
        restorable: { files: true, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ] as never;

    await app.confirmRestoreCheckpoint("cp-1");
    expect(app.restoreInFlightCheckpointId).toBeNull();
    expect(app.pendingRestoreCheckpointId).toBeNull();
    expect(app.lastError).toMatch(/恢复超时|timed out/i);
    expect(app.lastError).not.toContain("checkpoint restore timed out before");
  });

  it("surfaces a queued restore and does not reload the unchanged thread", async () => {
    const reload = vi.fn(async () => {
      throw new Error("history reload should not run for a queued restore");
    });
    setChatActionsTestHooks({ reloadShellChatHistory: reload });
    try {
      const app = new OpenBotApp();
      app.connected = true;
      app.sessionKey = "main";
      app.pendingRestoreCheckpointId = "cp-1";
      app.client = {
        request: vi.fn().mockResolvedValue({
          ok: true,
          queued: true,
          reasonCode: "RUN_ACTIVE",
        }),
      } as never;
      app.chatCheckpoints = [
        {
          checkpointId: "cp-1",
          boundaryMessageId: "m0",
          createdAt: "2026-07-07T00:00:00.000Z",
          summary: "s",
          restorable: { files: true, transcript: true },
          externalEffects: { present: false, kinds: [] },
        },
      ] as never;

      await app.confirmRestoreCheckpoint("cp-1");
      expect(reload).not.toHaveBeenCalled();
      expect(app.restoreInFlightCheckpointId).toBeNull();
      expect(app.pendingRestoreCheckpointId).toBeNull();
      expect(app.lastError).toMatch(/排队|queued/i);
    } finally {
      setChatActionsTestHooks(null);
    }
  });

  it("asks the history reload to replace local rows and reports an unchanged thread", async () => {
    const reload = vi.fn(async (state: { chatHistoryReplaceLocal?: boolean }) => {
      expect(state.chatHistoryReplaceLocal).toBe(true);
      state.chatHistoryReplaceLocal = false;
    });
    setChatActionsTestHooks({ reloadShellChatHistory: reload });
    try {
      const app = new OpenBotApp();
      app.connected = true;
      app.sessionKey = "agent:market:main";
      app.chatMessages = [
        { id: "m0", role: "assistant", content: "之前" },
        { id: "m1", role: "user", content: "你好" },
      ];
      app.client = {
        request: vi.fn().mockResolvedValue({ ok: true, checkpointId: "cp-1" }),
      } as never;
      app.chatCheckpoints = [
        {
          checkpointId: "cp-1",
          boundaryMessageId: "m0",
          createdAt: "2026-07-07T00:00:00.000Z",
          summary: "s",
          restorable: { files: false, transcript: true },
          externalEffects: { present: false, kinds: [] },
        },
      ] as never;

      await app.confirmRestoreCheckpoint("cp-1");

      expect(reload).toHaveBeenCalledTimes(1);
      expect(app.chatHistoryReplaceLocal).toBe(false);
      expect(app.lastError).toMatch(/没有改动|did not change/i);
    } finally {
      setChatActionsTestHooks(null);
    }
  });
});
