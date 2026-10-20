import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { sanitizeSessionHistory } from "./pi-embedded-runner/google.js";
import {
  omitImagePayloadForHistory,
  projectTranscriptSourceImages,
} from "./transcript-image-omit.js";

function transcriptImageMessage(imageData: string) {
  return {
    role: "user" as const,
    timestamp: 1,
    content: [
      { type: "text", text: "看这张截图里的报价" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: imageData,
        },
        fileName: "报价截图.png",
        mimeType: "image/png",
        assetId: "asset-42",
        mediaPath: "/tmp/staged/报价截图.png",
      },
    ],
  };
}

describe("transcript source image projection", () => {
  it("replaces source.data with a marker and does not mutate the transcript object", () => {
    const imageData = "C".repeat(140 * 1024);
    const messages = [transcriptImageMessage(imageData)];
    const before = JSON.stringify(messages);
    const projected = projectTranscriptSourceImages(messages);
    expect(JSON.stringify(messages)).toBe(before);
    expect(projected).not.toBe(messages);

    const serialized = JSON.stringify(projected);
    expect(serialized).toContain("看这张截图里的报价");
    expect(serialized).toContain("[image omitted:");
    expect(serialized).toContain("报价截图.png");
    expect(serialized).toContain("image/png");
    expect(serialized).toContain("asset-42");
    expect(serialized).toContain("/tmp/staged/报价截图.png");
    expect(serialized.includes(imageData.slice(0, 80))).toBe(false);
    const imageBlocks = (projected[0] as { content: Array<{ type?: string }> }).content.filter(
      (block) => block.type === "image",
    );
    expect(imageBlocks).toHaveLength(0);
  });

  it("leaves a compressor-shaped image untouched and drops only a duplicate source.data", () => {
    const block = { type: "image", data: "iVBOR", mimeType: "image/png" };
    const messages = [{ role: "user", content: [block] }];
    expect(projectTranscriptSourceImages(messages)).toBe(messages);

    const dual = {
      type: "image",
      data: "iVBOR",
      mimeType: "image/png",
      source: { type: "base64", media_type: "image/png", data: "DUPLICATE" },
    };
    const projected = projectTranscriptSourceImages([{ role: "user", content: [dual] }]);
    const next = (projected[0] as { content: Array<Record<string, unknown>> }).content[0];
    if (!next) {
      throw new Error("missing projected image block");
    }
    expect(next.data).toBe("iVBOR");
    expect(next.mimeType).toBe("image/png");
    const source = next.source as { data?: string };
    expect(source.data).toBeUndefined();
    expect(JSON.stringify(dual.source)).toContain("DUPLICATE");
  });

  it("history omit keeps sibling-ready metadata without base64", () => {
    const imageData = "D".repeat(32);
    const block = transcriptImageMessage(imageData).content[1];
    const omitted = omitImagePayloadForHistory(block);
    expect(omitted.changed).toBe(true);
    const serialized = JSON.stringify(omitted.blocks);
    expect(serialized).toContain("[image omitted:");
    expect(serialized).toContain("asset-42");
    expect(serialized.includes(imageData)).toBe(false);
    expect(JSON.stringify(block)).toContain(imageData);
  });

  it("sanitizeSessionHistory shows the caption and a marker instead of source.data bytes", async () => {
    const imageData = "E".repeat(140 * 1024);
    const original = [transcriptImageMessage(imageData)];
    const before = JSON.stringify(original);
    const sessionManager = {
      getEntries: () => [],
      appendCustomEntry: () => {},
    } as unknown as SessionManager;
    const sanitized = await sanitizeSessionHistory({
      messages: original as unknown as AgentMessage[],
      modelApi: "openai-completions",
      provider: "openai",
      modelId: "gpt-4.1",
      sessionManager,
      sessionId: "test-session",
    });
    expect(JSON.stringify(original)).toBe(before);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).toContain("看这张截图里的报价");
    expect(serialized).toContain("[image omitted:");
    expect(serialized).toContain("asset-42");
    expect(serialized.includes(imageData.slice(0, 80))).toBe(false);
  });
});
