import { describe, expect, it } from "vitest";
import type { ReadyCatalogEntry } from "./workbench-personal-authorization-catalog.ts";
import { sortReadyCatalog } from "./workbench-personal-authorization-panel.ts";

function entry(
  partial: Pick<ReadyCatalogEntry, "provider" | "label" | "category">,
): ReadyCatalogEntry {
  return {
    rolloutTier: "pilot",
    registrationReady: true,
    authMode: "manual",
    manualKind: null,
    operationalActions: [],
    reauthHint: "",
    degradedHint: null,
    ...partial,
  };
}

describe("sortReadyCatalog", () => {
  it("pins wechat-official then wechat-personal before category rank", () => {
    const ready = [
      entry({ provider: "zhihu", label: "知乎", category: "social" }),
      entry({ provider: "github-personal", label: "GitHub", category: "developer" }),
      entry({ provider: "wechat-personal", label: "微信个人号", category: "social" }),
      entry({ provider: "personal-email", label: "邮箱", category: "communication" }),
      entry({ provider: "wechat-official", label: "微信公众号", category: "official" }),
      entry({ provider: "weibo", label: "微博", category: "social" }),
    ];

    const sorted = sortReadyCatalog(ready);

    expect(sorted.map((item) => item.provider)).toEqual([
      "wechat-official",
      "wechat-personal",
      "personal-email",
      "github-personal",
      "weibo",
      "zhihu",
    ]);
    expect(sorted[0]?.label).toBe("微信公众号");
    expect(sorted[1]?.label).toBe("微信个人号");
    expect(sorted.find((item) => item.provider === "wechat-personal")?.category).toBe("social");
  });
});
