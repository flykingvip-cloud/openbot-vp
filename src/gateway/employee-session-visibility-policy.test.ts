import { describe, expect, it } from "vitest";
import { readEmployeePolicyJsonFile } from "./employee-session-visibility-policy.js";

describe("employee session visibility policy strict reads", () => {
  it("treats only ENOENT as an absent optional policy file", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });

    await expect(
      readEmployeePolicyJsonFile("/missing/policy.json", async () => {
        throw missing;
      }),
    ).resolves.toEqual({ found: false, value: null });
  });

  it("propagates policy permission errors instead of falling back", async () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });

    await expect(
      readEmployeePolicyJsonFile("/denied/policy.json", async () => {
        throw denied;
      }),
    ).rejects.toThrow("unable to read employee visibility policy");
  });

  it("rejects malformed policy JSON instead of treating it as empty", async () => {
    await expect(
      readEmployeePolicyJsonFile("/invalid/policy.json", async () => "{not-json"),
    ).rejects.toThrow("invalid employee visibility policy JSON");
  });

  it("returns parsed policy JSON for a valid source", async () => {
    await expect(
      readEmployeePolicyJsonFile("/valid/policy.json", async () => '{"groupId":"group-1"}'),
    ).resolves.toEqual({ found: true, value: { groupId: "group-1" } });
  });
});
