import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { promptAccountId, type PromptAccountIdParams } from "./onboarding.js";

describe("plugin-sdk/onboarding shim", () => {
  it("loads promptAccountId from the facade path", () => {
    expect(typeof promptAccountId).toBe("function");
    const typeProbe: PromptAccountIdParams["label"] = "channel";
    expect(typeProbe).toBe("channel");
  });

  it("re-exports the original symbols from the channels implementation", () => {
    const source = fs.readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8");
    expect(source).toContain("promptAccountId");
    expect(source).toContain("PromptAccountIdParams");
    expect(source).toContain("../channels/plugins/onboarding/prompt-account-id.js");
  });
});
