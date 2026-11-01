/* @vitest-environment jsdom */

import { expect, it, vi } from "vitest";
import { switchShellSession } from "./app-session-actions.ts";
import { OpenBotApp } from "./app.ts";

it("generic shell session switch immediately isolates checkpoints and rejects prior response", async () => {
  const app = new OpenBotApp();
  app.connected = true;
  app.sessionKey = "agent:a:main";
  app.workbenchTeamSelectedKey = "agent:a:main";
  app.resetToolStream = vi.fn();
  app.resetChatScroll = vi.fn();
  app.applySettings = vi.fn();
  app.loadAssistantIdentity = vi.fn(async () => {});

  const cp = {
    checkpointId: "cp-a",
    createdAt: "2026-10-31T00:00:00Z",
    summary: "a",
    boundaryMessageId: "m0",
    restorable: { files: false, transcript: true },
    externalEffects: { present: false, kinds: [] },
  };
  let release!: (value: unknown) => void;
  app.client = {
    request: vi
      .fn()
      .mockResolvedValueOnce({ checkpoints: [cp] })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
  } as never;

  await app.loadChatCheckpoints();
  const pending = app.loadChatCheckpoints();
  switchShellSession(app as never, "agent:b:main");
  const afterSwitch = app.chatCheckpoints.slice();
  release({ checkpoints: [cp] });
  await pending;
  expect({ afterSwitch, afterLate: app.chatCheckpoints }).toEqual({
    afterSwitch: [],
    afterLate: [],
  });
  expect(app.chatCheckpointLoadState.sessionKey).toBe("agent:b:main");
  expect(app.chatCheckpointDiagnostics).toEqual([]);
  expect(app.pendingRestoreCheckpointId).toBeNull();
});
