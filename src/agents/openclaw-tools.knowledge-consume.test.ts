import { describe, expect, it } from "vitest";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools knowledge consume registration", () => {
  it("registers read-only knowledge_search and knowledge_get beside knowledge_source", () => {
    const tools = createOpenClawTools({ gatewayClientUser: "user@example.com" });
    const search = tools.find((candidate) => candidate.name === "knowledge_search");
    const get = tools.find((candidate) => candidate.name === "knowledge_get");
    const source = tools.find((candidate) => candidate.name === "knowledge_source");

    expect(search?.description).toContain("ingested Knowledge Universe documents");
    expect(search?.description).toContain("memory_search");
    expect(get?.description).toContain("knowledge_search");
    expect(source?.description).toContain("knowledge_search / knowledge_get");
  });
});
