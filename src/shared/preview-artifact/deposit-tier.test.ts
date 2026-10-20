import { describe, expect, it } from "vitest";
import { classifyArtifactDepositTier, isDeliverableResultArtifact } from "./deposit-tier.js";

describe("classifyArtifactDepositTier", () => {
  it("marks deliverable envelopes as high", () => {
    expect(
      classifyArtifactDepositTier({
        provider: "assistant-message",
        providerMetadata: { deliverableEnvelope: true },
      }),
    ).toBe("high");
  });

  it("marks write-tool and artifact-event as high", () => {
    expect(classifyArtifactDepositTier({ provider: "write-tool" })).toBe("high");
    expect(classifyArtifactDepositTier({ provider: "tool-write" })).toBe("high");
    expect(classifyArtifactDepositTier({ provider: "artifact-event" })).toBe("high");
  });

  it("marks plain assistant-message as low", () => {
    expect(
      classifyArtifactDepositTier({
        provider: "assistant-message",
      }),
    ).toBe("low");
  });

  it("returns none for unknown providers", () => {
    expect(classifyArtifactDepositTier({ provider: "other" })).toBe("none");
    expect(
      classifyArtifactDepositTier({
        provider: "cron-result",
        providerMetadata: { depositEligible: true },
      }),
    ).toBe("none");
  });
});

describe("isDeliverableResultArtifact", () => {
  it("accepts a declared envelope with a workspace file", () => {
    expect(
      isDeliverableResultArtifact({
        artifactId: "assistant-doc:resume",
        provider: "assistant-message",
        providerMetadata: {
          declared: true,
          deliverableEnvelope: true,
          workspaceFilename: "Alice简历.docx",
        },
      }),
    ).toBe(true);
  });

  it("accepts write-tool and host-supplied explicit artifacts", () => {
    expect(
      isDeliverableResultArtifact({
        artifactId: "tool-write:report",
        provider: "tool-write",
        providerMetadata: { filePath: "reports/a.md" },
      }),
    ).toBe(true);
    expect(
      isDeliverableResultArtifact({
        artifactId: "artifact:handoff",
        title: "Handoff Spec",
      }),
    ).toBe(true);
  });

  it("rejects inferred files, scraped filenames, and article bodies", () => {
    expect(
      isDeliverableResultArtifact({
        artifactId: "assistant-doc:skill",
        provider: "assistant-message",
        title: "把选题—撰写—排版—配图这条链固化成一份 SKILL.md",
        providerMetadata: {
          inferredFile: true,
          previewKind: "file",
          workspaceFilename: "把选题—撰写—排版—配图这条链固化成一份 SKILL.md",
        },
      }),
    ).toBe(false);
    expect(
      isDeliverableResultArtifact({
        artifactId: "assistant-doc:article",
        provider: "assistant-message",
        providerMetadata: { inferredFrom: "assistant-message" },
      }),
    ).toBe(false);
    expect(
      isDeliverableResultArtifact({
        artifactId: "assistant-doc:named",
        provider: "assistant-message",
        providerMetadata: { inferredDeliverable: true, workspaceFilename: "报告.md" },
      }),
    ).toBe(false);
  });
});
