import { describe, expect, it } from "vitest";
import { parseActionItemsParam, parseDecisionList } from "./meeting-tool-minutes.js";

describe("meeting tool minutes parsers", () => {
  it("splits decisions on newlines and pipes", () => {
    expect(parseDecisionList("ship v1 | note the risk\nowner is user-2")).toEqual([
      "ship v1",
      "note the risk",
      "owner is user-2",
    ]);
  });

  it("parses line action items with assignee and due", () => {
    const parsed = parseActionItemsParam(
      "draft spec @ user-2 @ 2026-07-03T00:00:00.000Z\nshare notes @ user-1",
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.items).toEqual([
      {
        title: "draft spec",
        assigneeUserId: "user-2",
        dueAt: "2026-07-03T00:00:00.000Z",
      },
      { title: "share notes", assigneeUserId: "user-1" },
    ]);
  });

  it("parses a JSON action item array", () => {
    const parsed = parseActionItemsParam(
      JSON.stringify([{ title: "follow up", assigneeUserId: "user-2" }]),
    );
    expect(parsed.items).toEqual([{ title: "follow up", assigneeUserId: "user-2" }]);
  });

  it("rejects invalid JSON", () => {
    expect(parseActionItemsParam("{").error).toMatch(/not valid/i);
  });
});
