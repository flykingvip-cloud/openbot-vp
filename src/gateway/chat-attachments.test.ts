import { describe, expect, it, vi } from "vitest";
import {
  buildMessageWithAttachments,
  DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES,
  type ChatAttachment,
  parseMessageWithAttachments,
} from "./chat-attachments.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";
const JPEG_1x1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]).toString("base64");

async function parseWithWarnings(message: string, attachments: ChatAttachment[]) {
  const logs: string[] = [];
  const parsed = await parseMessageWithAttachments(message, attachments, {
    log: { warn: (warning) => logs.push(warning) },
  });
  return { parsed, logs };
}

describe("buildMessageWithAttachments", () => {
  it("embeds a single image as data URL", () => {
    const msg = buildMessageWithAttachments("see this", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(msg).toContain("see this");
    expect(msg).toContain(`data:image/png;base64,${PNG_1x1}`);
    expect(msg).toContain("![dot.png]");
  });

  it("rejects non-image mime types", () => {
    const bad: ChatAttachment = {
      type: "file",
      mimeType: "application/pdf",
      fileName: "a.pdf",
      content: "AAA",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/image/);
  });
});

describe("parseMessageWithAttachments", () => {
  it("keeps a JPEG attachment as a structured image part", async () => {
    const parsed = await parseMessageWithAttachments(
      "read this jpeg",
      [
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "dot.jpg",
          content: JPEG_1x1,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/jpeg");
    expect(parsed.images[0]?.data).toBe(JPEG_1x1);
    expect(parsed.images[0]?.type).toBe("image");
    expect(JSON.stringify(parsed.images)).not.toContain("[object Object]");
  });

  it("keeps text + PNG as structured multimodal content", async () => {
    const parsed = await parseMessageWithAttachments(
      "what is this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.message).toContain("what is this");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]).toMatchObject({ type: "image", mimeType: "image/png", data: PNG_1x1 });
    expect(JSON.stringify(parsed.images)).toContain('"type":"image"');
    expect(JSON.stringify(parsed.images)).not.toContain("[object Object]");
  });

  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.message).toContain(
      '<attachment name="dot.png" mime="image/png" status="image_input">',
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(parsed.images[0]?.fileName).toBe("dot.png");
  });

  it("sniffs mime when missing", async () => {
    const { parsed, logs } = await parseWithWarnings("see this", [
      {
        type: "image",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.message).toContain("see this");
    expect(parsed.message).toContain(
      '<attachment name="dot.png" mime="image/png" status="image_input">',
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("adds text file payloads to the message context", async () => {
    const text = Buffer.from("hello </file> world").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "file",
        mimeType: "text/plain",
        fileName: "notes.txt",
        content: text,
      },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain(
      '<attachment name="notes.txt" mime="text/plain" status="extracted_and_staged">',
    );
    expect(parsed.message).toContain("Do NOT ask the user to re-upload");
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]?.fileName).toBe("notes.txt");
    expect(parsed.files[0]?.data).toBe(text);
    expect(parsed.message).toContain('<file name="notes.txt" mime="text/plain">');
    expect(parsed.message).toContain("hello &lt;/file&gt; world");
    expect(logs).toHaveLength(0);
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/jpeg",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("keeps an attachment notice when file content extraction fails", async () => {
    const unknown = Buffer.from("not an image").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      { type: "file", fileName: "unknown.bin", content: unknown },
    ]);
    expect(parsed.message).toContain('<attachment name="unknown.bin" mime="" status="staged">');
    expect(logs.join("\n")).toMatch(/content extraction failed/i);
  });

  it("does not abort chat.send parsing when a non-fatal attachment processor throws RangeError", async () => {
    const text = Buffer.from("safe notes").toString("base64");
    const pdf = Buffer.from("%PDF-1.4 stub").toString("base64");
    const sniff = await import("../media/sniff-mime-from-base64.js");
    const sniffSpy = vi
      .spyOn(sniff, "sniffMimeFromBase64")
      .mockImplementation(async (base64: string) => {
        if (base64 === pdf) {
          throw new RangeError("Maximum call stack size exceeded");
        }
        return undefined;
      });

    try {
      const { parsed, logs } = await parseWithWarnings("please read both", [
        {
          type: "file",
          mimeType: "application/pdf",
          fileName: "broken-ebook.pdf",
          content: pdf,
        },
        {
          type: "file",
          mimeType: "text/plain",
          fileName: "notes.txt",
          content: text,
        },
      ]);
      expect(parsed.message).toContain("please read both");
      expect(parsed.message).toContain(
        '<attachment name="broken-ebook.pdf" mime="application/pdf" status="received">',
      );
      expect(parsed.message).toContain(
        '<attachment name="notes.txt" mime="text/plain" status="extracted_and_staged">',
      );
      expect(parsed.message).toContain("safe notes");
      expect(logs.join("\n")).toMatch(/processing failed/i);
    } finally {
      sniffSpy.mockRestore();
    }
  });

  it("keeps valid images and appends valid file context", async () => {
    const text = Buffer.from("report").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
      {
        type: "file",
        mimeType: "text/plain",
        fileName: "report.txt",
        content: text,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(parsed.message).toContain('<attachment name="dot.png"');
    expect(parsed.message).toContain(
      '<attachment name="report.txt" mime="text/plain" status="extracted_and_staged">',
    );
    expect(parsed.message).toContain('<file name="report.txt" mime="text/plain">');
    expect(logs).toHaveLength(0);
  });

  it("extracts document attachments larger than the old 5 MB gateway limit", async () => {
    const text = Buffer.alloc(5_000_001, "a").toString("base64");
    const { parsed, logs } = await parseWithWarnings("summarize", [
      {
        type: "file",
        mimeType: "text/plain",
        fileName: "large-report.txt",
        content: text,
      },
    ]);

    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain(
      '<attachment name="large-report.txt" mime="text/plain" status="extracted_and_staged">',
    );
    expect(parsed.message).toContain('<file name="large-report.txt" mime="text/plain">');
    expect(logs).toHaveLength(0);
  });
});

describe("shared attachment validation", () => {
  it("rejects invalid base64 content for both builder and parser", async () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };

    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/base64/i);
    await expect(
      parseMessageWithAttachments("x", [bad], { log: { warn: () => {} } }),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit for both builder and parser without decoding base64", async () => {
    const big = "A".repeat(10_000);
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };

    const fromSpy = vi.spyOn(Buffer, "from");
    try {
      expect(() => buildMessageWithAttachments("x", [att], { maxBytes: 16 })).toThrow(
        /exceeds size limit/i,
      );
      await expect(
        parseMessageWithAttachments("x", [att], { maxBytes: 16, log: { warn: () => {} } }),
      ).rejects.toThrow(/exceeds size limit/i);
      const base64Calls = fromSpy.mock.calls.filter((args) => (args as unknown[])[1] === "base64");
      expect(base64Calls).toHaveLength(0);
    } finally {
      fromSpy.mockRestore();
    }
  });

  it("keeps the larger document limit bounded", async () => {
    const big = "A".repeat(Math.ceil((DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES + 1) / 3) * 4);
    const att: ChatAttachment = {
      type: "file",
      mimeType: "text/plain",
      fileName: "too-large.txt",
      content: big,
    };

    await expect(
      parseMessageWithAttachments("x", [att], { log: { warn: () => {} } }),
    ).rejects.toThrow(/exceeds size limit/i);
  });
});
