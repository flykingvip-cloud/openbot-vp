/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { OpenBotApp } from "./app.ts";

describe("OpenBotApp send routing", () => {
  it("keeps collaboration messages on the normal send path", async () => {
    const app = new OpenBotApp();
    app.connected = true;
    app.tab = "me";
    app.workbenchPrimaryModule = "collaboration";
    app.sessionKey = "space:grp-demo";
    app.workbenchTeamSelectedKey = "space:grp-demo";
    app.chatMessage = "大家先看这个问题";
    app.sessionsResult = {
      ts: 0,
      path: "",
      count: 1,
      defaults: { model: null, contextTokens: null },
      sessions: [
        {
          key: "space:grp-demo",
          sourceKey: "agent:bot-2:main:space:grp-demo",
        },
      ],
    } as never;

    const sendFallback = vi
      .spyOn(await import("./app-chat.ts"), "handleSendChat")
      .mockResolvedValue(undefined as never);

    await app.handleSendChat();

    expect(sendFallback).toHaveBeenCalled();
  });
});
