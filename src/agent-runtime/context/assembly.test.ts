import { describe, expect, it } from "vitest";
import {
  appendSystemContextPart,
  finalizeSystemContext,
  selectSystemContextParts,
} from "./assembly.js";

describe("system context assembly compatibility", () => {
  it("filters blank initial material while preserving bytes, order and duplicate sources", () => {
    const input = [undefined, "", " \n", "  first\n", "second", "second"];
    const previous = input.filter((entry): entry is string => Boolean(entry?.trim()));
    expect(selectSystemContextParts(input)).toEqual(previous);
    expect(finalizeSystemContext(selectSystemContextParts(input))).toBe(
      "  first\n\n\nsecond\n\nsecond",
    );
  });

  it("preserves caller-admitted append semantics and does not mutate earlier snapshots", () => {
    const initial = selectSystemContextParts(["base"]);
    const appended = appendSystemContextPart(initial, " ");
    expect(initial).toEqual(["base"]);
    expect(finalizeSystemContext(appended)).toBe("base\n\n ");
  });

  it("keeps ordered late additions and represents absent system context as undefined", () => {
    expect(finalizeSystemContext([])).toBeUndefined();
    let parts = selectSystemContextParts(["identity", "task"]);
    for (const value of ["speaker", "recall", "events", "skill"]) {
      parts = appendSystemContextPart(parts, value);
    }
    expect(finalizeSystemContext(parts)).toBe(
      ["identity", "task", "speaker", "recall", "events", "skill"].join("\n\n"),
    );
  });
});
