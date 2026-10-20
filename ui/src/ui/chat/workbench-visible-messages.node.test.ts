import { describe, expect, it } from "vitest";
import {
  resolveWorkbenchChatSessionKey,
  resolveWorkbenchVisibleChatMessages,
} from "./workbench-visible-messages.ts";

describe("resolveWorkbenchVisibleChatMessages", () => {
  const messages = [{ id: "m1" }];

  it("blanks group history when the header is a 1:1 steward surface", () => {
    expect(
      resolveWorkbenchVisibleChatMessages({
        selectedKey: "agent:main:employee:alice",
        sessionKey: "space:grp-elledecke204-gmail-com-ai",
        messages,
      }),
    ).toEqual([]);
  });

  it("blanks 1:1 history when the header is a collaboration space", () => {
    expect(
      resolveWorkbenchVisibleChatMessages({
        selectedKey: "space:grp-elledecke204-gmail-com-ai",
        sessionKey: "agent:main:main",
        messages,
      }),
    ).toEqual([]);
  });

  it("keeps history when both keys share the same group surface", () => {
    expect(
      resolveWorkbenchVisibleChatMessages({
        selectedKey: "space:alpha",
        sessionKey: "agent:bot-2:main:space:alpha",
        messages,
      }),
    ).toEqual(messages);
  });

  it("keeps history when steward aliases share the 1:1 surface", () => {
    expect(
      resolveWorkbenchVisibleChatMessages({
        selectedKey: "agent:main:main",
        sessionKey: "agent:main:employee:alice",
        messages,
      }),
    ).toEqual(messages);
  });
});

describe("resolveWorkbenchChatSessionKey", () => {
  it("follows the header when the live sessionKey is on another surface", () => {
    expect(
      resolveWorkbenchChatSessionKey({
        selectedKey: "agent:main:main",
        sessionKey: "space:grp-ai",
      }),
    ).toBe("agent:main:main");
  });
});
