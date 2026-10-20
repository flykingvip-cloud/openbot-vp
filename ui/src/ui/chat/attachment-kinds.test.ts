import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_EXTENSIONS,
  CHAT_ATTACHMENT_MIME_TYPES,
  isSupportedAttachmentFile,
} from "./attachment-kinds.ts";

describe("chat attachment allowlist", () => {
  it("builds the picker accept list from the same mime and extension tables", () => {
    const accept = CHAT_ATTACHMENT_ACCEPT.split(",");
    expect(accept[0]).toBe("image/*");
    for (const mime of CHAT_ATTACHMENT_MIME_TYPES) {
      expect(accept).toContain(mime);
    }
    for (const ext of CHAT_ATTACHMENT_EXTENSIONS) {
      expect(accept).toContain(ext);
    }
    expect(accept).toContain(".zip");
    expect(accept).toContain(".rar");
    expect(accept).toContain(".7z");
    expect(accept).toContain(".tar");
    expect(accept).toContain(".gz");
    expect(accept).toContain(".tgz");
  });

  it("accepts archives by MIME alias, extension, and empty Windows MIME", () => {
    const accepted = [
      { name: "a.zip", type: "application/zip" },
      { name: "a.zip", type: "application/x-zip-compressed" },
      { name: "a.rar", type: "application/vnd.rar" },
      { name: "a.rar", type: "application/x-rar-compressed" },
      { name: "a.7z", type: "application/x-7z-compressed" },
      { name: "a.tar", type: "application/x-tar" },
      { name: "a.gz", type: "application/gzip" },
      { name: "a.gz", type: "application/x-gzip" },
      { name: "a.tgz", type: "" },
      { name: "A.ZIP", type: "" },
      { name: "bundle.tar.gz", type: "application/octet-stream" },
      { name: "notes.md", type: "" },
      { name: "photo.png", type: "image/png" },
      { name: "sheet.xlsx", type: "" },
    ];
    for (const file of accepted) {
      expect(isSupportedAttachmentFile(file), `${file.name} ${file.type}`).toBe(true);
    }
  });

  it("rejects files outside the allowlist", () => {
    const rejected = [
      { name: "run.exe", type: "application/octet-stream" },
      { name: "run.exe", type: "" },
      { name: "clip", type: "application/x-msdownload" },
      { name: "archive.zip.exe", type: "" },
    ];
    for (const file of rejected) {
      expect(isSupportedAttachmentFile(file), `${file.name} ${file.type}`).toBe(false);
    }
  });
});
