// @vitest-environment node
import { describe, expect, it } from "vitest";
import { knowledgeHandlers } from "./knowledge.js";

describe("knowledge connector RPC registration", () => {
  it("registers connector unbind/bind/status handlers used by the library sources table", () => {
    expect(typeof knowledgeHandlers["knowledge.connector.unbind"]).toBe("function");
    expect(typeof knowledgeHandlers["knowledge.connector.bind"]).toBe("function");
    expect(typeof knowledgeHandlers["knowledge.connector.status"]).toBe("function");
    expect(typeof knowledgeHandlers["knowledge.connector.providers"]).toBe("function");
  });
});
