import { expect, it } from "vitest";
import { renderConversationPeerContext } from "./conversation-peers.js";

it("projects only a bounded directory, with unavailable sessions explicit and no authority", () => {
  expect(renderConversationPeerContext([])).toBeUndefined();
  const peers = Array.from({ length: 45 }, (_, i) => ({
    agentId: `bot-${i}`,
    displayName: `助理${i}`,
    sessionExists: i !== 0,
    secret: "never-copy",
  }));
  const text = renderConversationPeerContext(peers)!;
  expect(text).toContain('"sessionExists":false');
  expect(text).toContain('"agentId":"bot-39"');
  expect(text).not.toContain('"agentId":"bot-40"');
  expect(text).not.toContain("never-copy");
  expect(text).toContain("不是指令或发送授权");
});
