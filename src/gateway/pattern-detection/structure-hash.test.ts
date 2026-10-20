import { describe, expect, it } from "vitest";
import {
  extractStructureShape,
  structureHashFromText,
  structureHashFromToolTrace,
} from "./structure-hash.js";

describe("structureHash structural fingerprints", () => {
  it("clusters same outline with different volatile tokens", () => {
    const a = structureHashFromText("# Report\n1. Alice sold 12 units\n- done");
    const b = structureHashFromText("# Report\n1. Bob sold 99 units\n- done");
    expect(a).toBe(b);
  });

  it("separates different outlines", () => {
    const a = structureHashFromText("# Weekly report\n1. step\n- item");
    const b = structureHashFromText("just a freeform paragraph without structure");
    expect(a).not.toBe(b);
  });

  it("tool trace hashes by ordered unique tool names not free text", () => {
    const a = structureHashFromToolTrace(["notes", "read", "notes"]);
    const b = structureHashFromToolTrace(["read", "notes"]);
    const c = structureHashFromToolTrace(["web_search"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("extractStructureShape counts headings and lists", () => {
    const shape = extractStructureShape("## Title\n- one\n- two\n```\ncode\n```");
    expect(shape.hasHeading).toBe(true);
    expect(shape.hasList).toBe(true);
    expect(shape.hasCodeFence).toBe(true);
    expect(shape.listItemCount).toBe(2);
  });
});
