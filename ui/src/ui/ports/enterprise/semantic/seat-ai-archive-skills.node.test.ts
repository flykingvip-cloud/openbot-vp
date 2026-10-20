import { describe, expect, it, vi } from "vitest";
import {
  collectUniqueSeatAgentIds,
  ensureSeatArchiveSkillsLoaded,
  getSeatArchiveKnownSkills,
  resetSeatArchiveSkillsCacheForTests,
} from "./seat-ai-archive-skills.ts";

describe("seat-ai-archive-skills", () => {
  it("collects unique agent ids with defaultAgentId last", () => {
    expect(
      collectUniqueSeatAgentIds({
        agentIds: ["bot-a", "bot-a", ""],
        defaultAgentId: "bot-b",
      }),
    ).toEqual(["bot-a", "bot-b"]);
  });

  it("loads robot-capability.list and caches seat skill names", async () => {
    resetSeatArchiveSkillsCacheForTests();
    const request = vi.fn().mockResolvedValue({
      items: [
        { name: "web-search", skillId: "web-search" },
        { name: "browser", skillId: "browser" },
      ],
    });
    ensureSeatArchiveSkillsLoaded({
      client: { request } as never,
      seatId: "seat-skills",
      agentIds: ["bot-1"],
      defaultAgentId: null,
    });
    await vi.waitFor(() => {
      expect(getSeatArchiveKnownSkills("seat-skills")).toEqual(["browser", "web-search"]);
    });
    expect(request).toHaveBeenCalledWith("robot-capability.list", { agentId: "bot-1" });
  });
});
