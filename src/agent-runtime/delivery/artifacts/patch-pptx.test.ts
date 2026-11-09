import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { artifactContentHash, patchAuthorizedPptx } from "./patch-pptx.js";
it("only one concurrent editor can replace the same original version", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-cas-"));
  try {
    const file = path.join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Original</a:t></p:sld>',
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync(file, bytes);
    const hash = artifactContentHash(bytes);
    const results = await Promise.all([
      patchAuthorizedPptx(file, hash, [{ index: 1, lines: ["A"] }]),
      patchAuthorizedPptx(file, hash, [{ index: 1, lines: ["B"] }]),
    ]);
    expect(results.map((result) => result.kind).toSorted()).toEqual(["conflict", "saved"]);
    const latest = fs.readFileSync(file);
    expect((await patchAuthorizedPptx(file, hash, [{ index: 1, lines: ["stale"] }])).kind).toBe(
      "conflict",
    );
    expect((await patchAuthorizedPptx(file, "", [{ index: 1, lines: ["unbound"] }])).kind).toBe(
      "invalid",
    );
    expect(fs.readFileSync(file)).toEqual(latest);
    expect(fs.readdirSync(dir)).toEqual(["deck.pptx"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
