import { describe, expect, it } from "vitest";
import { resolveConversationRetentionPolicy } from "./retention-policy.js";

describe("resolveConversationRetentionPolicy", () => {
  it("uses platform defaults when no tenant policy is configured", () => {
    expect(resolveConversationRetentionPolicy({})).toEqual({
      activeDays: 30,
      archiveDays: 180,
      deleteAfterDays: 365,
      complianceProfile: "standard",
    });
  });

  it("merges tenant overrides", () => {
    expect(
      resolveConversationRetentionPolicy(
        {
          gateway: {
            tenantPolicies: {
              "tenant-acme": {
                retention: {
                  conversation: { deleteAfterDays: 90 },
                  complianceProfile: "financial",
                },
              },
            },
          },
        },
        "tenant-acme",
      ),
    ).toEqual({
      activeDays: 30,
      archiveDays: 180,
      deleteAfterDays: 90,
      complianceProfile: "financial",
    });
  });
});
