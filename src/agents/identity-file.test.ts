import { describe, expect, it } from "vitest";
import {
  listMissingIdentityFieldLabels,
  listMissingUserFieldLabels,
  parseIdentityMarkdown,
  upsertIdentityMarkdownFields,
} from "./identity-file.js";

describe("parseIdentityMarkdown", () => {
  it("ignores identity template placeholders", () => {
    const content = `
# IDENTITY.md - Who Am I?

- **Name:** *(pick something you like)*
- **Creature:** *(AI? robot? familiar? ghost in the machine? something weirder?)*
- **Vibe:** *(how do you come across? sharp? warm? chaotic? calm?)*
- **Emoji:** *(your signature - pick one that feels right)*
- **Avatar:** *(workspace-relative path, http(s) URL, or data URI)*
`;
    const parsed = parseIdentityMarkdown(content);
    expect(parsed).toEqual({});
  });

  it("parses explicit identity values", () => {
    const content = `
- **Name:** Samantha
- **Creature:** Robot
- **Vibe:** Warm
- **Emoji:** :robot:
- **Avatar:** avatars/openclaw.png
`;
    const parsed = parseIdentityMarkdown(content);
    expect(parsed).toEqual({
      name: "Samantha",
      creature: "Robot",
      vibe: "Warm",
      emoji: ":robot:",
      avatar: "avatars/openclaw.png",
    });
  });
});

describe("upsertIdentityMarkdownFields", () => {
  it("replaces existing fields and appends missing ones", () => {
    const content = `# IDENTITY.md\n\n- Name: Old\n- Emoji: 🤖\n`;
    const next = upsertIdentityMarkdownFields(content, {
      name: "新名称",
      theme: "市场分析与竞品跟踪",
    });
    expect(next).toContain("- Name: 新名称");
    expect(next).toContain("- Emoji: 🤖");
    expect(next).toContain("- Theme: 市场分析与竞品跟踪");
    expect(parseIdentityMarkdown(next)).toMatchObject({
      name: "新名称",
      emoji: "🤖",
      theme: "市场分析与竞品跟踪",
    });
  });

  it("creates identity lines when file is empty", () => {
    const next = upsertIdentityMarkdownFields("", { name: "助手", emoji: "🐻" });
    expect(parseIdentityMarkdown(next)).toEqual({ name: "助手", emoji: "🐻" });
  });
});

describe("identity gap labels", () => {
  it("lists missing identity and user field names without values", () => {
    const identity = `
- **Name:** *(pick something you like)*
- **Vibe:** Sharp
`;
    const user = `
- **Name:**
- **What to call them:** Daniel
- **Timezone:**
`;
    expect(listMissingIdentityFieldLabels(identity)).toEqual([
      "name",
      "emoji",
      "creature",
      "theme",
      "avatar",
    ]);
    expect(listMissingUserFieldLabels(user)).toEqual(["name", "timezone"]);
    expect(JSON.stringify(listMissingIdentityFieldLabels(identity))).not.toContain("Sharp");
    expect(JSON.stringify(listMissingUserFieldLabels(user))).not.toContain("Daniel");
  });
});
