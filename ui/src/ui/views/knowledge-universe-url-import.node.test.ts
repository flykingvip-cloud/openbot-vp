// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  countWebImportUrlLines,
  parseWebImportUrlLines,
  webUrlSyncScheduleToIntervalMs,
} from "./knowledge-universe-url-import.ts";

describe("knowledge-universe-url-import", () => {
  it("parses valid urls and ignores blank lines", () => {
    const result = parseWebImportUrlLines(
      "https://a.example/1\n\nhttps://b.example/2\nnot-a-url\n",
    );
    expect(result.urls).toEqual(["https://a.example/1", "https://b.example/2"]);
    expect(result.invalidLines).toEqual(["not-a-url"]);
    expect(result.totalNonEmptyLines).toBe(3);
  });

  it("caps batch import at 20 links", () => {
    const lines = Array.from({ length: 25 }, (_, index) => `https://example.com/${index}`).join(
      "\n",
    );
    const result = parseWebImportUrlLines(lines);
    expect(result.urls).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(countWebImportUrlLines(lines)).toBe(25);
  });

  it("maps sync schedules to refresh intervals", () => {
    expect(webUrlSyncScheduleToIntervalMs("once")).toBeNull();
    expect(webUrlSyncScheduleToIntervalMs("daily")).toBe(86_400_000);
    expect(webUrlSyncScheduleToIntervalMs("weekly")).toBe(604_800_000);
  });
});
