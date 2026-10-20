import { describe, expect, it } from "vitest";
import { resolveSessionFilePath } from "../../config/sessions/paths.js";
import {
  buildCollaborationBotGroupSessionId,
  buildCollaborationSpaceSessionId,
  resolveCollaborationBotGroupSessionId,
  resolveCollaborationSpaceSessionId,
} from "./session-id.js";

describe("collaboration session ids", () => {
  it("builds filesystem-safe space session ids for unicode group ids", () => {
    const groupId = "grp-daniel-hhd-gmail-com-试用小组";
    const sessionId = buildCollaborationSpaceSessionId(groupId);
    expect(sessionId).toMatch(/^space-[a-f0-9]{32}$/);
    expect(() => resolveSessionFilePath(sessionId)).not.toThrow();
  });

  it("replaces legacy encodeURIComponent session ids", () => {
    const groupId = "grp-daniel-hhd-gmail-com-试用小组";
    const legacy = `space-${encodeURIComponent(groupId)}`;
    expect(legacy.includes("%")).toBe(true);
    const resolved = resolveCollaborationSpaceSessionId({
      groupId,
      existingSessionId: legacy,
    });
    expect(resolved).toBe(buildCollaborationSpaceSessionId(groupId));
    expect(() => resolveSessionFilePath(resolved)).not.toThrow();
  });

  it("preserves valid existing session ids", () => {
    const existing = "space-existing-stable-id";
    expect(
      resolveCollaborationSpaceSessionId({
        groupId: "any-group",
        existingSessionId: existing,
      }),
    ).toBe(existing);
  });

  it("builds filesystem-safe bot group session ids", () => {
    const sessionId = buildCollaborationBotGroupSessionId("bot-a", "grp-试用小组");
    expect(sessionId).toMatch(/^group-bot-a-[a-f0-9]{32}$/);
    expect(() => resolveSessionFilePath(sessionId)).not.toThrow();
  });

  it("replaces legacy bot group session ids with percent escapes", () => {
    const groupId = "grp-试用小组";
    const legacy = `group-bot-a-${encodeURIComponent(groupId)}`;
    const resolved = resolveCollaborationBotGroupSessionId({
      botId: "bot-a",
      groupId,
      existingSessionId: legacy,
    });
    expect(resolved).toBe(buildCollaborationBotGroupSessionId("bot-a", groupId));
  });
});
