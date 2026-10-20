import { describe, expect, it } from "vitest";
import {
  extractObsidianExplicitMetadata,
  extractObsidianHashtags,
  extractObsidianWikilinks,
  titleKeysForWikilinkTarget,
} from "./document-obsidian-extract.js";

describe("document-obsidian-extract (P2)", () => {
  it("extracts wikilinks with aliases and anchors stripped", () => {
    const links = extractObsidianWikilinks(
      "See [[Project Alpha|Alpha]] and [[Notes/Daily#heading]] plus [[Dup]] [[Dup]].",
    );
    expect(links.map((l) => l.target)).toEqual(["Project Alpha", "Notes/Daily", "Dup"]);
    expect(links[0]?.alias).toBe("Alpha");
    expect(titleKeysForWikilinkTarget("Notes/Daily")).toContain("daily");
  });

  it("extracts hashtags and frontmatter tags", () => {
    const text = `---
title: Hello
tags: [okr, planning]
---

Body with #meeting and #OKR notes.
`;
    const meta = extractObsidianExplicitMetadata(text);
    expect(meta.frontmatter.title).toBe("Hello");
    expect(meta.tags).toEqual(expect.arrayContaining(["okr", "planning", "meeting"]));
    expect(extractObsidianHashtags("plain #tag")).toContain("tag");
  });
});
