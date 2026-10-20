import { describe, expect, it } from "vitest";
import { buildExecApprovalFollowupPrompt } from "./bash-tools.exec-approval-followup.js";

describe("buildExecApprovalFollowupPrompt", () => {
  it("redacts Exec denied and gateway ids before the model sees them", () => {
    const prompt = buildExecApprovalFollowupPrompt(
      "Exec denied (gateway id=5f53b11c, allowlist-miss): cat /etc/passwd",
    );
    expect(prompt).toContain("authorization-denied");
    expect(prompt).not.toMatch(/gateway id=/i);
    expect(prompt).not.toMatch(/5f53b11c/);
    expect(prompt).not.toMatch(/Exec denied \(gateway id=5f53b11c/);
    expect(prompt).toMatch(/Default Chinese/);
    expect(prompt).toMatch(/never say Exec denied/);
  });
});
