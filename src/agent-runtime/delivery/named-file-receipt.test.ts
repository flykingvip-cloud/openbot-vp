import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canClaimNamedFileDelivery,
  collectNamedFileReceipts,
  candidateNamedFilesFromTurn,
  namedFilesFromAcceptance,
  namedFileReceiptsToArtifactFields,
  registerNamedFileReceipt,
} from "./named-file-receipt.js";

const dirs: string[] = [];

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "named-file-receipt-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("named file delivery receipt", () => {
  it("extracts an explicit filename from a Pack1-style request", () => {
    expect(
      candidateNamedFilesFromTurn([
        "请制作一个 Markdown 文件，文件名为 onboarding-checklist.md，内容是一份简短的新员工入职检查清单。",
      ]),
    ).toEqual(["onboarding-checklist.md"]);
  });

  it("parses 交付文件 acceptance into a workspace-relative name", () => {
    expect(namedFilesFromAcceptance(["交付文件 onboarding-checklist.md", "语义质量"])).toEqual([
      "onboarding-checklist.md",
    ]);
    expect(namedFilesFromAcceptance(["交付文件 ../escape.md"])).toEqual([]);
  });

  it("proves disk write, registration, preview, and download authorization agree", () => {
    const workspaceDir = tempWorkspace();
    const relativePath = "onboarding-checklist.md";
    const body = "# 入职清单\n\n- 账号开通\n";
    fs.writeFileSync(path.join(workspaceDir, relativePath), body, "utf8");

    const receipt = registerNamedFileReceipt({ workspaceDir, relativePath });
    expect(receipt.accessible).toBe(true);
    if (!receipt.accessible) {
      return;
    }
    expect(canClaimNamedFileDelivery(receipt)).toBe(true);
    expect(receipt.byteLength).toBe(Buffer.byteLength(body));
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(receipt.absolutePath, "utf8")).toBe(body);

    const fields = namedFileReceiptsToArtifactFields([receipt], { timestamp: 1 });
    const meta = (fields.artifact?.providerMetadata ?? {}) as Record<string, unknown>;
    expect(meta.workspaceFilename).toBe(relativePath);
    expect(meta.settleConfirmed).toBe(true);
    expect(meta.artifactSha256).toBe(receipt.sha256);
    expect(meta.downloadAuthorization).toEqual({
      kind: "workspace_file",
      relativePath,
      sha256: receipt.sha256,
      byteLength: receipt.byteLength,
    });
    const onDisk = fs.readFileSync(receipt.absolutePath);
    expect(createHash("sha256").update(onDisk).digest("hex")).toBe(
      (meta.downloadAuthorization as { sha256: string }).sha256,
    );
  });

  it("does not let a prose claim outrun a missing or empty file", () => {
    const workspaceDir = tempWorkspace();
    const missing = registerNamedFileReceipt({
      workspaceDir,
      relativePath: "onboarding-checklist.md",
    });
    expect(missing).toMatchObject({ accessible: false, reason: "missing" });
    expect(canClaimNamedFileDelivery(missing)).toBe(false);
    expect(namedFileReceiptsToArtifactFields([missing])).toEqual({});

    fs.writeFileSync(path.join(workspaceDir, "empty.md"), "");
    const empty = registerNamedFileReceipt({ workspaceDir, relativePath: "empty.md" });
    expect(empty).toMatchObject({ accessible: false, reason: "empty" });
    expect(canClaimNamedFileDelivery(empty)).toBe(false);
  });

  it("collects only accessible receipts from a candidate list", () => {
    const workspaceDir = tempWorkspace();
    fs.writeFileSync(path.join(workspaceDir, "ok.md"), "ok\n");
    const receipts = collectNamedFileReceipts({
      workspaceDir,
      relativePaths: ["ok.md", "missing.md", "ok.md"],
    });
    expect(receipts).toHaveLength(2);
    expect(receipts.filter((item) => item.accessible)).toHaveLength(1);
    expect(namedFileReceiptsToArtifactFields(receipts).artifact).toBeTruthy();
  });
});
