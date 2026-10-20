import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveOwnerAttachmentFilePath,
  resolveUserOperationalIdentityEmailAttachments,
} from "./user-operational-identity-email-attachments.js";
import { parseUserOperationalIdentityExecutionPayload } from "./user-operational-identity-execution.js";

const ownerId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";

describe("user operational identity email attachments", () => {
  const previousRoot = process.env.OPENBOT_TENANTS_ROOT;
  let tmpRoot = "";

  afterEach(async () => {
    if (previousRoot === undefined) {
      delete process.env.OPENBOT_TENANTS_ROOT;
    } else {
      process.env.OPENBOT_TENANTS_ROOT = previousRoot;
    }
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = "";
    }
  });

  async function seedWorkspaceFile(name: string, bytes: Buffer): Promise<string> {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oi-email-att-"));
    process.env.OPENBOT_TENANTS_ROOT = tmpRoot;
    const filePath = path.join(tmpRoot, "001", "users", ownerId, "OpenBot", "workspace", name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return filePath;
  }

  it("keeps filePath and base64 aliases in the execute payload", () => {
    const payload = parseUserOperationalIdentityExecutionPayload({
      to: "hedon@example.com",
      subject: "Deck",
      message: "See attached",
      filePath: "/tmp/deck.pptx",
      filename: "OpenBot_投资介绍.pptx",
      buffer: "UEsDBA==",
    });
    expect(payload.filePath).toBe("/tmp/deck.pptx");
    expect(payload.filename).toBe("OpenBot_投资介绍.pptx");
    expect(payload.attachmentBase64).toBe("UEsDBA==");
  });

  it("reads a workspace filePath for the signed-in owner", async () => {
    const bytes = Buffer.from("PK deck");
    const filePath = await seedWorkspaceFile("OpenBot_投资介绍.pptx", bytes);
    const resolved = await resolveOwnerAttachmentFilePath({ filePath, ownerId });
    expect(resolved).toBe(filePath);
    const attachments = await resolveUserOperationalIdentityEmailAttachments({
      payload: { filePath, filename: "OpenBot_投资介绍.pptx" },
      ownerId,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe("OpenBot_投资介绍.pptx");
    expect(attachments[0]?.content.equals(bytes)).toBe(true);
    expect(attachments[0]?.contentType).toContain("presentationml.presentation");
  });

  it("accepts relative workspace file names", async () => {
    const bytes = Buffer.from("relative-deck");
    await seedWorkspaceFile("OpenBot_投资介绍.pptx", bytes);
    const attachments = await resolveUserOperationalIdentityEmailAttachments({
      payload: { filePath: "OpenBot_投资介绍.pptx" },
      ownerId,
    });
    expect(attachments[0]?.content.equals(bytes)).toBe(true);
  });

  it("decodes attachmentBase64 and buffer aliases", async () => {
    const bytes = Buffer.from("hello-deck");
    const attachments = await resolveUserOperationalIdentityEmailAttachments({
      payload: {
        filename: "note.txt",
        buffer: bytes.toString("base64"),
      },
      ownerId,
    });
    expect(attachments[0]?.content.equals(bytes)).toBe(true);
    expect(attachments[0]?.contentType).toBe("text/plain");
  });

  it("rejects filePath outside the owner workspace", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oi-email-att-"));
    process.env.OPENBOT_TENANTS_ROOT = tmpRoot;
    await fs.mkdir(path.join(tmpRoot, "001", "users", ownerId), { recursive: true });
    const outside = path.join(tmpRoot, "001", "users", "other-user", "secret.pptx");
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, "nope");
    await expect(
      resolveUserOperationalIdentityEmailAttachments({
        payload: { filePath: outside },
        ownerId,
      }),
    ).rejects.toThrow(/outside the signed-in user's workspace/);
  });
});
