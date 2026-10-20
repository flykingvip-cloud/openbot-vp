import { describe, expect, it } from "vitest";
import { applyInputProvenanceToUserMessage, normalizeInputProvenance } from "./input-provenance.js";

describe("input provenance speaker", () => {
  it("keeps the sending robot's name on an inter-session user line", () => {
    const provenance = normalizeInputProvenance({
      kind: "inter_session",
      sourcePlatformUserId: "user-1",
      sourceSenderLabel: "大白管家",
    });
    const message = applyInputProvenanceToUserMessage(
      { role: "user", content: "请准备明天的会议资料" } as never,
      provenance,
    ) as { senderLabel?: string; provenance?: { sourceSenderLabel?: string } };

    expect(message.senderLabel).toBe("大白管家");
    expect(message.provenance?.sourceSenderLabel).toBe("大白管家");
  });

  it("does not rename a person's own line", () => {
    const message = applyInputProvenanceToUserMessage(
      { role: "user", content: "你好", senderLabel: "CEO" } as never,
      normalizeInputProvenance({ kind: "external_user" }),
    ) as { senderLabel?: string };

    expect(message.senderLabel).toBe("CEO");
  });
});
