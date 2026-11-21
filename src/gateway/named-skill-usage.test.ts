import { describe, expect, it } from "vitest";
import { countExplicitSkillReads } from "./named-skill-usage.js";

describe("countExplicitSkillReads", () => {
  it("counts a read of one skill file and ignores catalog listings and primitive tools", () => {
    const read = JSON.stringify({
      message: {
        content: [
          {
            type: "toolCall",
            name: "read",
            arguments: { path: "/skills/wechat-article/SKILL.md" },
          },
        ],
      },
    });
    const listing = JSON.stringify({
      message: {
        content: [
          {
            type: "toolCall",
            name: "exec",
            arguments: { command: "find skills -name SKILL.md" },
          },
        ],
      },
    });
    const many = JSON.stringify({
      message: {
        content: [
          {
            type: "toolCall",
            name: "read",
            arguments: "skills/github/SKILL.md skills/weather/SKILL.md",
          },
        ],
      },
    });
    const browser = JSON.stringify({
      message: {
        content: [
          {
            type: "toolCall",
            name: "read",
            arguments: { path: "/skills/browser/SKILL.md" },
          },
        ],
      },
    });
    const counts = countExplicitSkillReads([read, listing, many, browser].join("\n"));
    expect([...counts.entries()]).toEqual([["wechat-article", 1]]);
  });
});
