import { describe, expect, it } from "vitest";
import { normalizeCapabilityInstallFacts } from "./capability-install-facts.ts";

describe("E3 capability install facts", () => {
  it("keeps maturity beside verification and does not treat maturity as execution", () => {
    const facts = normalizeCapabilityInstallFacts(
      {
        skillId: "skill-site",
        websites: [
          {
            sourceId: "src-site",
            displayName: "网站 A",
            capabilityId: "sar.cap",
            version: "2026.10.17",
          },
        ],
        accountRequirement: "待配置",
        bindingId: "bind-other",
        executionVersion: "2026.10.17",
        executionDigest: "digest-pinned",
        catalogVersion: "2026.10.18",
        reviewedAt: "",
        verification: "unknown",
        bridgeVerification: "passed",
        effects: ["read", "create"],
        dependencies: ["fixture.sar.draft-note.create"],
        executable: false,
        denialMessage: "没有通过的验证记录。成熟度和桥上的标记都不能代替验证。",
        inFlightSideEffectsWithdrawn: true,
        entersKnowledgeProjection: true,
      },
      "企业认证",
    );
    expect(facts?.accountRequirement).toBe("待配置");
    expect(facts?.bindingId).toBeNull();
    expect(facts?.maturityLabel).toBe("企业认证");
    expect(facts?.verification).toBe("unknown");
    expect(facts?.reviewedAt).toBeNull();
    expect(facts?.executable).toBe(false);
    expect(facts?.denialMessage).toContain("成熟度");
    expect(facts?.inFlightSideEffectsWithdrawn).toBe(false);
    expect(facts?.entersKnowledgeProjection).toBe(false);
    expect(facts?.executionVersion).toBe("2026.10.17");
    expect(facts?.catalogVersion).toBe("2026.10.18");
  });

  it("does not invent a verification time", () => {
    const facts = normalizeCapabilityInstallFacts({
      skillId: "skill-site",
      verification: "passed",
      reviewedAt: "   ",
      accountRequirement: "已绑定",
      bindingId: "bind-owner",
    });
    expect(facts?.reviewedAt).toBeNull();
    expect(facts?.accountRequirement).toBe("已绑定");
    expect(facts?.bindingId).toBe("bind-owner");
    expect(facts?.executable).toBe(false);
  });
});
