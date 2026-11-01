import { describe, expect, it } from "vitest";
import { stripControlChannelForDisplay } from "../text/control-channel-visibility.js";
import { isDeliverableResultArtifact } from "./deposit-tier.js";
import {
  attachDeclaredDeliverableArtifacts,
  declaredDeliverableArtifactFields,
} from "./materialize-declared-artifacts.js";
import { resolvePreviewArtifactRecords } from "./resolve-preview-artifact.js";

const SAMPLE = [
  "已写好邮件发送 SOP。",
  '<<DELIVERABLE title="邮件发送 SOP" type="doc" file="email-sending-sop.md">>',
  "- 覆盖个人邮箱发送流程",
  "- 含常见失败排查",
  "<</DELIVERABLE>>",
].join("\n");

describe("materializeDeclaredDeliverableArtifacts", () => {
  it("attaches declared artifact before strip so 「打开成果」 survives sanitize", () => {
    const rawMessage = {
      role: "assistant",
      timestamp: "2026-10-31T00:00:00.000Z",
      content: [{ type: "text", text: SAMPLE }],
    };
    const withArtifact = attachDeclaredDeliverableArtifacts(rawMessage);
    expect(withArtifact.artifact).toBeTruthy();
    expect(isDeliverableResultArtifact(withArtifact.artifact as Record<string, unknown>)).toBe(
      true,
    );
    const meta = (withArtifact.artifact as { providerMetadata?: Record<string, unknown> })
      .providerMetadata;
    expect(meta?.declared).toBe(true);
    expect(meta?.workspaceFilename).toBe("email-sending-sop.md");

    const strippedText = stripControlChannelForDisplay(SAMPLE);
    expect(strippedText).not.toContain("<<DELIVERABLE");
    expect(strippedText).not.toContain("file=");
    expect(strippedText).toContain("已写好邮件发送 SOP");

    const sanitizedMessage = {
      ...withArtifact,
      content: [{ type: "text", text: strippedText }],
    };
    const resolved = resolvePreviewArtifactRecords(sanitizedMessage);
    expect(resolved).toHaveLength(1);
    expect(isDeliverableResultArtifact(resolved[0])).toBe(true);
    expect(
      (resolved[0]?.providerMetadata as Record<string, unknown> | undefined)?.workspaceFilename,
    ).toBe("email-sending-sop.md");
  });

  it("declaredDeliverableArtifactFields returns empty when tags already stripped", () => {
    const stripped = stripControlChannelForDisplay(SAMPLE);
    expect(declaredDeliverableArtifactFields(stripped)).toEqual({});
  });

  it("does not invent a chip from prose without a DELIVERABLE envelope", () => {
    const fields = declaredDeliverableArtifactFields(
      "报告写好了，文件：email-sending-sop.md（请自行打开）",
    );
    expect(fields).toEqual({});
  });
});
