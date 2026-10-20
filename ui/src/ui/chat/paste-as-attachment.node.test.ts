import { describe, expect, it } from "vitest";
import {
  PASTE_AS_ATTACHMENT_CHAR_THRESHOLD,
  buildPastedTextFileName,
  countPasteChars,
  createPastedTextFile,
  decodeDataUrlText,
  encodeTextDataUrl,
  expandFoldedPastesIntoMessage,
  foldedPastePreview,
  mergeRestoredPasteIntoDraft,
  planComposerPaste,
  readClipboardText,
  shouldPasteAsAttachment,
} from "./paste-as-attachment.ts";

describe("paste-as-attachment", () => {
  it("counts Unicode code points, not UTF-16 units", () => {
    expect(countPasteChars("测".repeat(10))).toBe(10);
    expect(countPasteChars("🙂")).toBe(1);
  });

  it("converts pastes strictly over the 500-character threshold", () => {
    expect(shouldPasteAsAttachment("测".repeat(PASTE_AS_ATTACHMENT_CHAR_THRESHOLD))).toBe(false);
    expect(shouldPasteAsAttachment("测".repeat(PASTE_AS_ATTACHMENT_CHAR_THRESHOLD + 1))).toBe(true);
    expect(shouldPasteAsAttachment("   ")).toBe(false);
  });

  it("converts long manuscripts even when Word/browser attach an HTML clipboard file", () => {
    const html = new File(["<p>x</p>"], "clipboard.html", { type: "text/html" });
    const text = "测".repeat(800);
    expect(
      planComposerPaste({
        files: [html],
        text,
      }),
    ).toEqual({ kind: "text-attachment", text, charCount: 800 });
  });

  it("keeps real image files when long text is also pasted", () => {
    const image = new File(["img"], "shot.png", { type: "image/png" });
    const text = "测".repeat(501);
    expect(
      planComposerPaste({
        files: [image],
        text,
      }),
    ).toEqual({
      kind: "text-attachment-and-files",
      text,
      charCount: 501,
      files: [image],
    });
  });

  it("still attaches real images when the accompanying text is short", () => {
    const file = new File(["img"], "shot.png", { type: "image/png" });
    expect(
      planComposerPaste({
        files: [file],
        text: "看这张图",
      }),
    ).toEqual({ kind: "files", files: [file] });
  });

  it("reads HTML clipboard text when text/plain is empty", () => {
    expect(
      readClipboardText({
        getData: (type) => (type === "text/html" ? "<p>你好<br>世界</p>" : ""),
      }).replace(/\s+/g, ""),
    ).toBe("你好世界");
  });

  it("plans a text attachment for long plaintext pastes", () => {
    const text = "测".repeat(501);
    expect(planComposerPaste({ text })).toEqual({
      kind: "text-attachment",
      text,
      charCount: 501,
    });
  });

  it("leaves short text to the textarea", () => {
    expect(planComposerPaste({ text: "hello" })).toEqual({ kind: "default" });
  });

  it("builds unique paste filenames and round-trips UTF-8 content", async () => {
    const name = buildPastedTextFileName(Date.UTC(2026, 8, 15, 7, 35, 12, 482), "粘贴内容");
    expect(name).toContain("粘贴内容-");
    expect(name.endsWith(".txt")).toBe(true);
    const file = createPastedTextFile("你好世界", name, 1);
    expect(file.type).toBe("text/plain");
    expect(await file.text()).toBe("你好世界");
  });

  it("decodes base64 data URLs back to the pasted text", () => {
    const encoded = btoa(unescape(encodeURIComponent("粘贴正文")));
    expect(decodeDataUrlText(`data:text/plain;base64,${encoded}`)).toBe("粘贴正文");
  });

  it("appends restored paste after existing draft text", () => {
    expect(mergeRestoredPasteIntoDraft("", "long")).toBe("long");
    expect(mergeRestoredPasteIntoDraft("问一下", "long")).toBe("问一下\n\nlong");
  });

  it("previews the first line and expands folded pastes into the message", () => {
    const text = `Last login: Thu Sep 24\n${"x".repeat(600)}`;
    expect(foldedPastePreview(text)).toBe("Last login: Thu Se...");
    const dataUrl = encodeTextDataUrl("折叠正文");
    expect(decodeDataUrlText(dataUrl)).toBe("折叠正文");
    expect(
      expandFoldedPastesIntoMessage("请看这个", [
        { source: "paste", dataUrl },
        { source: undefined, dataUrl: "data:image/png;base64,QQ==" },
      ]),
    ).toEqual({
      message: "请看这个\n\n折叠正文",
      attachments: [{ source: undefined, dataUrl: "data:image/png;base64,QQ==" }],
    });
  });
});
