import { describe, expect, it } from "vitest";
import { resolveSpaceAwareAssistantIdentity } from "./space-stream-identity.ts";

const stewardIdentity = { name: "大白管家", avatar: "大" };

describe("resolveSpaceAwareAssistantIdentity", () => {
  it("does not paint the group placeholder on the steward 1:1 surface", () => {
    expect(
      resolveSpaceAwareAssistantIdentity({
        sessionKey: "agent:main:employee:alice",
        senderLabel: null,
        agentId: null,
        stewardIdentity,
      }),
    ).toEqual(stewardIdentity);
  });

  it("uses steward identity for unlabeled turns on the steward's own group-scoped session", () => {
    expect(
      resolveSpaceAwareAssistantIdentity({
        sessionKey: "agent:main:space:grp-ai",
        senderLabel: null,
        agentId: null,
        stewardIdentity,
      }),
    ).toEqual(stewardIdentity);
  });

  it("keeps the group placeholder for unlabeled public space turns", () => {
    expect(
      resolveSpaceAwareAssistantIdentity({
        sessionKey: "space:grp-ai",
        senderLabel: null,
        agentId: null,
        stewardIdentity,
      }).name,
    ).toBe("群成员");
  });
});
