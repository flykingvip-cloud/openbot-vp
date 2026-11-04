/** Best-effort local static-slide rendering. Original PPTX bytes are never rewritten.
 * Fixed host commands, not user/config scripts. Native document parsing must run
 * inside the deployment sandbox; this helper alone is not a security sandbox.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PPTX_RENDER_LIMITS = {
  deadlineMs: 30_000,
  inputBytes: 50 * 1024 * 1024,
  pdfBytes: 50 * 1024 * 1024,
  totalPngBytes: 24 * 1024 * 1024,
  pagePngBytes: 4 * 1024 * 1024,
  pages: 60,
} as const;

type CommandResult = { stdout: string };
/** Fixed source-code test ports only. Do not expose through config or RPC. */
export type PptxRenderPorts = {
  run: (
    command: "soffice" | "pdfinfo" | "pdftoppm",
    args: string[],
    timeoutMs: number,
  ) => Promise<CommandResult>;
  now: () => number;
  tempRoot?: string;
  expectedPages?: number;
};

const runNative: PptxRenderPorts["run"] = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      },
      (error, stdout) => (error ? reject(error) : resolve({ stdout })),
    );
  });

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
async function readBounded(file: string, maxBytes: number): Promise<Buffer> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) {
    throw new Error("render output outside byte budget");
  }
  const bytes = await fs.readFile(file);
  if (bytes.length !== stat.size || bytes.length > maxBytes) {
    throw new Error("render output changed");
  }
  return bytes;
}

/** Returns null for missing native tools, invalid files, timeouts or budget excess.
 * Caller may retain the existing explicitly labelled text-only preview fallback.
 * Page images preserve static layout; animation, embedded media and exact font
 * equivalence are intentionally not claimed.
 */
export async function renderPptxStaticSlidesHtml(
  buffer: Buffer,
  title: string,
  overrides: Partial<PptxRenderPorts> = {},
): Promise<string | null> {
  if (!buffer.length || buffer.length > PPTX_RENDER_LIMITS.inputBytes) {
    return null;
  }
  const ports: PptxRenderPorts = { run: runNative, now: Date.now, ...overrides };
  const deadline = ports.now() + PPTX_RENDER_LIMITS.deadlineMs;
  let root: string | undefined;
  const remaining = () => {
    const ms = Math.floor(deadline - ports.now());
    if (ms <= 0) {
      throw new Error("PPTX render deadline exceeded");
    }
    return ms;
  };
  const run: PptxRenderPorts["run"] = async (command, args) => {
    const result = await ports.run(command, args, remaining());
    remaining();
    return result;
  };
  try {
    root = await fs.mkdtemp(path.join(ports.tempRoot ?? os.tmpdir(), "openbot-pptx-render-"));
    const profile = path.join(root, "profile");
    await fs.mkdir(path.join(profile, "user"), { recursive: true });
    // Disable macros in a fresh user profile; this is not an OS/network sandbox.
    await fs.writeFile(
      path.join(profile, "user", "registrymodifications.xcu"),
      '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>',
      "utf8",
    );
    const input = path.join(root, "input.pptx");
    await fs.writeFile(input, buffer, { flag: "wx" });
    await run(
      "soffice",
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--norestore",
        "--convert-to",
        "pdf:impress_pdf_Export",
        "--outdir",
        root,
        input,
      ],
      remaining(),
    );
    const pdf = path.join(root, "input.pdf");
    const pdfBytes = await readBounded(pdf, PPTX_RENDER_LIMITS.pdfBytes);
    if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return null;
    }
    const info = await run("pdfinfo", [pdf], remaining());
    const count = Number(info.stdout.match(/^Pages:\s+(\d+)\s*$/m)?.[1]);
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > PPTX_RENDER_LIMITS.pages ||
      (ports.expectedPages !== undefined && count !== ports.expectedPages)
    ) {
      return null;
    }
    const images: string[] = [];
    let total = 0;
    for (let page = 1; page <= count; page++) {
      const output = path.join(root, `page-${page}`);
      await run(
        "pdftoppm",
        [
          "-f",
          String(page),
          "-l",
          String(page),
          "-singlefile",
          "-png",
          "-scale-to",
          "1600",
          pdf,
          output,
        ],
        remaining(),
      );
      const png = await readBounded(`${output}.png`, PPTX_RENDER_LIMITS.pagePngBytes);
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return null;
      }
      total += png.length;
      if (total > PPTX_RENDER_LIMITS.totalPngBytes) {
        return null;
      }
      images.push(
        `<section><p>第 ${page} / ${count} 页</p><img alt="第 ${page} 页幻灯片" src="data:image/png;base64,${png.toString("base64")}"/></section>`,
      );
      remaining();
    }
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>body{margin:0;padding:16px;background:#eef2f6;color:#14212b;font:14px/1.5 system-ui,sans-serif}h1{font-size:18px}section{margin:0 0 20px}img{display:block;width:100%;height:auto}p{margin:6px 0}</style></head><body><h1>${escapeHtml(title)}</h1><p>PPTX 静态渲染预览 · 字体与原应用可能存在差异；动画和嵌入媒体不在预览范围</p>${images.join("\n")}</body></html>`;
  } catch {
    return null;
  } finally {
    if (root) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  }
}
