import { describe, expect, it } from "vitest";
import {
  artifactHashMatches,
  buildArtifactIdFromBody,
  buildLegacyArtifactId,
  hashArtifactBody,
  legacyHashPreviewText,
} from "./artifact-hash.ts";
import { canonicalizePreviewText } from "./canonicalize.ts";
import { extractDeliverableEnvelope } from "./deliverable-envelope.ts";

describe("preview-artifact canonicalize + hash", () => {
  it("canonicalizes line endings and trailing whitespace", () => {
    expect(canonicalizePreviewText("a\r\nb  \nc\t")).toBe("a\nb\nc");
  });

  it("uses stable sha256 body hash independent of title", () => {
    const body = "# Title\n\nBody";
    const a = hashArtifactBody(body);
    const b = hashArtifactBody(`${body}  `);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(buildArtifactIdFromBody(body)).toBe(`assistant-doc:${a}`);
  });

  it("matches legacy and modern artifact hashes", () => {
    const title = "会议邀请函";
    const body = "# 会议邀请函\n\n内容";
    const legacyId = buildLegacyArtifactId(title, body);
    const legacyHash = legacyId.slice("assistant-doc:".length);
    expect(
      artifactHashMatches(legacyHash, {
        body,
        legacyTitle: title,
        legacySourceMessage: body,
      }),
    ).toBe(true);
    expect(legacyHashPreviewText(`${title}\n${body}`)).toBe(legacyHash);
  });
});

describe("deliverable envelope multiline attrs", () => {
  it("parses versioned multiline DELIVERABLE headers", () => {
    const text = [
      "<<DELIVERABLE",
      'title="会议邀请函"',
      'type="template"',
      'version="1"',
      ">>",
      "# body with enough length for envelope parsing.".repeat(3),
      "<</DELIVERABLE>>",
    ].join("\n");
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.title).toBe("会议邀请函");
    expect(envelope?.type).toBe("template");
    expect(envelope?.version).toBe("1");
    expect(envelope?.body).toContain("# body");
  });
});
