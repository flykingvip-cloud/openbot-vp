import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  PPTX_RENDER_LIMITS,
  renderPptxStaticSlidesHtml,
  type PptxRenderPorts,
} from "./office-pptx-render.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});
async function fixture(pages = 2) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-render-test-"));
  roots.push(root);
  const commands: Array<{ command: string; args: string[]; timeout: number }> = [];
  let clock = 100;
  const run: PptxRenderPorts["run"] = vi.fn(async (command, args, timeout) => {
    commands.push({ command, args, timeout });
    clock += 100;
    if (command === "soffice") {
      const out = args[args.indexOf("--outdir") + 1];
      await fs.writeFile(path.join(out, "input.pdf"), "%PDF-1.7\nmock");
    }
    if (command === "pdfinfo") {
      return { stdout: `Pages: ${pages}\n` };
    }
    if (command === "pdftoppm") {
      await fs.writeFile(`${args.at(-1)}.png`, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    }
    return { stdout: "" };
  });
  return {
    root,
    commands,
    run,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
it("uses fixed argv, isolated profiles and ordered static pages without mutating original bytes", async () => {
  const f = await fixture();
  const original = Buffer.from("mock original PPTX");
  const copy = Buffer.from(original);
  const html = await renderPptxStaticSlidesHtml(original, '<Deck & "title">', {
    run: f.run,
    now: f.now,
    tempRoot: f.root,
  });
  expect(html).toContain("&lt;Deck &amp; &quot;title&quot;&gt;");
  expect(html).toContain("第 1 / 2 页");
  expect(html).toContain("第 2 / 2 页");
  expect(html).toContain("data:image/png;base64,");
  expect(original).toEqual(copy);
  expect(f.commands.map((x) => x.command)).toEqual(["soffice", "pdfinfo", "pdftoppm", "pdftoppm"]);
  expect(f.commands[0].args[0]).toMatch(/^-env:UserInstallation=file:.*profile$/);
  expect(f.commands[0].args).toContain("pdf:impress_pdf_Export");
  expect(f.commands[2].args.slice(0, 5)).toEqual(["-f", "1", "-l", "1", "-singlefile"]);
  expect(f.commands.map((x) => x.timeout)).toEqual([30000, 29900, 29800, 29700]);
  expect(await fs.readdir(f.root)).toEqual([]);
});
it("returns null and cleans temporary files when a native capability is missing", async () => {
  const f = await fixture();
  const run = vi.fn(async () => {
    throw new Error("ENOENT");
  });
  expect(
    await renderPptxStaticSlidesHtml(Buffer.from("pptx"), "Deck", { run, tempRoot: f.root }),
  ).toBeNull();
  expect(await fs.readdir(f.root)).toEqual([]);
});
it("uses one deadline instead of granting a fresh timeout to every command", async () => {
  const f = await fixture();
  const run: PptxRenderPorts["run"] = async (...args) => {
    const result = await f.run(...args);
    f.advance(PPTX_RENDER_LIMITS.deadlineMs);
    return result;
  };
  expect(
    await renderPptxStaticSlidesHtml(Buffer.from("pptx"), "Deck", {
      run,
      now: f.now,
      tempRoot: f.root,
    }),
  ).toBeNull();
  expect(f.commands).toHaveLength(1);
  expect(await fs.readdir(f.root)).toEqual([]);
});
it("rejects page overflow before rasterizing any slide", async () => {
  const f = await fixture(PPTX_RENDER_LIMITS.pages + 1);
  expect(
    await renderPptxStaticSlidesHtml(Buffer.from("pptx"), "Deck", { run: f.run, tempRoot: f.root }),
  ).toBeNull();
  expect(f.commands.map((x) => x.command)).toEqual(["soffice", "pdfinfo"]);
  expect(await fs.readdir(f.root)).toEqual([]);
});
it("rejects malformed image output and cleans all derivatives", async () => {
  const f = await fixture(1);
  const run: PptxRenderPorts["run"] = async (command, args, timeout) => {
    const result = await f.run(command, args, timeout);
    if (command === "pdftoppm") {
      await fs.writeFile(`${args.at(-1)}.png`, "not png");
    }
    return result;
  };
  expect(
    await renderPptxStaticSlidesHtml(Buffer.from("pptx"), "Deck", { run, tempRoot: f.root }),
  ).toBeNull();
  expect(await fs.readdir(f.root)).toEqual([]);
});
it("refuses empty input without invoking native processes", async () => {
  const f = await fixture();
  expect(await renderPptxStaticSlidesHtml(Buffer.alloc(0), "Deck", { run: f.run })).toBeNull();
  expect(f.commands).toEqual([]);
});
it("rejects raster output beyond the per-page byte budget", async () => {
  const f = await fixture(1);
  const run: PptxRenderPorts["run"] = async (command, args, timeout) => {
    const result = await f.run(command, args, timeout);
    if (command === "pdftoppm") {
      await fs.writeFile(`${args.at(-1)}.png`, Buffer.alloc(PPTX_RENDER_LIMITS.pagePngBytes + 1));
    }
    return result;
  };
  expect(
    await renderPptxStaticSlidesHtml(Buffer.from("pptx"), "Deck", { run, tempRoot: f.root }),
  ).toBeNull();
  expect(await fs.readdir(f.root)).toEqual([]);
});
it("rejects a PDF that omitted original presentation slides", async () => {
  const f = await fixture(1);
  expect(
    await renderPptxStaticSlidesHtml(Buffer.from("pptx"), "Deck", {
      run: f.run,
      now: f.now,
      tempRoot: f.root,
      expectedPages: 2,
    }),
  ).toBeNull();
  expect(f.commands.map((entry) => entry.command)).toEqual(["soffice", "pdfinfo"]);
});
