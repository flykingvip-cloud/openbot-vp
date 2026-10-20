import { describe, expect, it } from "vitest";
import {
  isForbiddenHumanProfileName,
  resolveWorkbenchHumanProfileName,
} from "./resolve-human-profile-name.ts";

describe("resolveWorkbenchHumanProfileName", () => {
  it("prefers platform displayName over assistant / steward names", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "",
        platformDisplayName: "Elle",
        platformEmail: "elledecke204@gmail.com",
        platformUser: "elledecke204@gmail.com",
        forbiddenAgentNames: ["大白管家"],
      }),
    ).toBe("Elle");
  });

  it("rejects sticky workbenchProfileName that equals 大白管家", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "大白管家",
        platformDisplayName: "Elle",
        platformEmail: "elledecke204@gmail.com",
        platformUser: "elledecke204@gmail.com",
        forbiddenAgentNames: ["大白管家"],
      }),
    ).toBe("Elle");
  });

  it("falls back to email local-part when displayName is missing", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "大白管家",
        platformDisplayName: "",
        platformEmail: "elledecke204@gmail.com",
        platformUser: "elledecke204@gmail.com",
        forbiddenAgentNames: ["大白管家", "市场助手"],
      }),
    ).toBe("elledecke204");
  });

  it("never returns the selected assistant name as the human profile", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "",
        platformDisplayName: "",
        platformEmail: "",
        platformUser: "",
        forbiddenAgentNames: ["大白管家"],
      }),
    ).toBe("");
    expect(isForbiddenHumanProfileName("大白管家")).toBe(true);
    expect(isForbiddenHumanProfileName("agent:main:employee:abc")).toBe(true);
    expect(isForbiddenHumanProfileName("Elle")).toBe(false);
  });

  it("rejects sticky workbenchProfileName that equals brand openbot and prefers CEO displayName", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "openbot",
        platformDisplayName: "CEO",
        platformEmail: "daniel.hhd@gmail.com",
        platformUser: "daniel.hhd@gmail.com",
        forbiddenAgentNames: ["大白管家"],
      }),
    ).toBe("CEO");
    expect(isForbiddenHumanProfileName("openbot")).toBe(true);
    expect(isForbiddenHumanProfileName("OpenBot")).toBe(true);
  });

  it("falls back to email local-part when sticky brand openbot and displayName are empty", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "OpenBot",
        platformDisplayName: "",
        platformEmail: "daniel.hhd@gmail.com",
        platformUser: "daniel.hhd@gmail.com",
        forbiddenAgentNames: ["大白管家"],
      }),
    ).toBe("daniel.hhd");
  });

  it("keeps a legitimate user-edited workbenchProfileName", () => {
    expect(
      resolveWorkbenchHumanProfileName({
        workbenchProfileName: "Amy",
        platformDisplayName: "Elle",
        platformEmail: "elledecke204@gmail.com",
        forbiddenAgentNames: ["大白管家"],
      }),
    ).toBe("Amy");
  });
});
