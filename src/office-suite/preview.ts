import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { xmlEscape } from "./xml.js";

export type NativePreview = {
  available: boolean;
  pageCount?: number;
  pngs?: Buffer[];
  nonWhiteRatio?: number;
  reason?: string;
};

const MACRO_DISABLE =
  '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>';

export function previewHtml(title: string, sections: { heading: string; body: string }[]): string {
  const body = sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2><pre>${escapeHtml(section.body)}</pre></section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{margin:0;padding:24px;font:15px/1.55 "Segoe UI","Microsoft YaHei",sans-serif;background:#f4f6f8;color:#14212b}main{max-width:920px;margin:0 auto}section{background:#fff;border:1px solid #d7dee7;border-radius:12px;padding:16px 18px;margin:0 0 12px}h1{font-size:20px}h2{font-size:14px;margin:0 0 8px}pre{white-space:pre-wrap;margin:0;font:14px/1.5 inherit}</style>
</head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return xmlEscape(value);
}

export async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", [command], (error) => resolve(!error));
  });
}

/** LibreOffice headless render. Returns null-shaped availability when the binary is absent. */
export async function renderOfficeToPngs(
  bytes: Buffer,
  extension: "docx" | "pptx" | "xlsx" | "pdf",
): Promise<NativePreview> {
  if (!(await commandExists("soffice")) || !(await commandExists("pdftoppm"))) {
    return {
      available: false,
      reason: "未安装 LibreOffice 或 Poppler，像素预览不可用。结构化预览仍然可用。",
    };
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-office-preview-"));
  try {
    const profile = path.join(root, "profile");
    await fs.mkdir(path.join(profile, "user"), { recursive: true });
    await fs.writeFile(
      path.join(profile, "user", "registrymodifications.xcu"),
      MACRO_DISABLE,
      "utf8",
    );
    const input = path.join(root, `input.${extension}`);
    await fs.writeFile(input, bytes);
    if (extension !== "pdf") {
      await run("soffice", [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        root,
        input,
      ]);
    }
    const pdf = extension === "pdf" ? input : path.join(root, "input.pdf");
    const info = await run("pdfinfo", [pdf]);
    const pageCount = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
    await run("pdftoppm", [
      "-png",
      "-r",
      "72",
      "-f",
      "1",
      "-l",
      String(Math.min(pageCount || 1, 4)),
      pdf,
      path.join(root, "page"),
    ]);
    const names = (await fs.readdir(root)).filter((name) => name.endsWith(".png")).toSorted();
    const pngs: Buffer[] = [];
    for (const name of names) {
      pngs.push(await fs.readFile(path.join(root, name)));
    }
    const nonWhiteRatio = pngs[0] ? pngNonWhiteRatio(pngs[0]) : 0;
    return { available: true, pageCount, pngs, nonWhiteRatio };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "render failed",
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.toString() || error.message));
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

/** Samples a PNG's IDAT-independent signature and uncompressed ratio via a tiny decoder for 8-bit RGB/RGBA. */
export function pngNonWhiteRatio(png: Buffer): number {
  if (png.length < 8 || png[0] !== 0x89) {
    return 0;
  }
  const zlib = inflatePng(png);
  if (!zlib) {
    return png.length > 500 ? 0.01 : 0;
  }
  let colored = 0;
  let total = 0;
  const step = Math.max(1, Math.floor(zlib.length / 4000));
  for (let i = 0; i < zlib.length; i += step) {
    total += 1;
    if ((zlib[i] ?? 255) < 250) {
      colored += 1;
    }
  }
  return total === 0 ? 0 : colored / total;
}

function inflatePng(png: Buffer): Buffer | null {
  const chunks: Buffer[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  while (offset + 8 < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9] ?? 6;
    }
    if (type === "IDAT") {
      chunks.push(data);
    }
    if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0 || chunks.length === 0) {
    return null;
  }
  try {
    const inflated = inflateSync(Buffer.concat(chunks));
    const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 0;
    if (!channels) {
      return inflated;
    }
    const stride = width * channels;
    const rows: Buffer[] = [];
    let cursor = 0;
    let prev = Buffer.alloc(stride);
    for (let row = 0; row < height; row += 1) {
      const filter = inflated[cursor] ?? 0;
      cursor += 1;
      const raw = Buffer.from(inflated.subarray(cursor, cursor + stride));
      cursor += stride;
      if (filter === 1) {
        for (let i = 0; i < raw.length; i += 1) {
          raw[i] = ((raw[i] ?? 0) + (raw[i - channels] ?? 0)) & 0xff;
        }
      } else if (filter === 2) {
        for (let i = 0; i < raw.length; i += 1) {
          raw[i] = ((raw[i] ?? 0) + (prev[i] ?? 0)) & 0xff;
        }
      }
      rows.push(raw);
      prev = raw;
    }
    return Buffer.concat(rows);
  } catch {
    return null;
  }
}
