import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChromePrintArgs,
  chromePrintEnv,
  clampTimeoutMs,
  formatPrintResult,
  printHtmlToPdf,
  resolveChromeExecutable,
} from "../../skills/web-extract-html-pdf/scripts/print-pdf.mjs";

const REAL_CHROME = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
].find((candidate) => existsSync(candidate));

function writeFakeChrome(dir: string): string {
  const bin = path.join(dir, "chrome");
  writeFileSync(
    bin,
    `#!/bin/sh
log="$PRINT_PDF_LOG"
out=""
block=0
for arg in "$@"; do
  case "$arg" in
    --print-to-pdf=*) out="\${arg#--print-to-pdf=}" ;;
    --host-resolver-rules=*) block=1 ;;
  esac
done
printf '%s\\n' "$*" >> "$log"
printf 'DBUS_SYSTEM_BUS_ADDRESS=%s\\n' "$DBUS_SYSTEM_BUS_ADDRESS" >> "$log"
if [ "$block" = 1 ]; then
  printf '%%PDF-1.4\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%EOF\\n' > "$out"
  exit 0
fi
if [ "$PRINT_PDF_MODE" = "hang" ]; then
  sleep 30
  exit 0
fi
printf '%%PDF-1.4\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%EOF\\n' > "$out"
exit 0
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe("sandbox html print args", () => {
  it("caps the load wait and does not treat virtual-time-budget as the fix", () => {
    const args = buildChromePrintArgs({
      htmlPath: "/tmp/page.html",
      outPath: "/tmp/out.pdf",
      userDataDir: "/tmp/ud-once",
      timeoutMs: 10_000,
      blockRemoteHosts: false,
    });
    expect(args).toEqual(
      expect.arrayContaining([
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--timeout=10000",
        "--user-data-dir=/tmp/ud-once",
        "--print-to-pdf=/tmp/out.pdf",
        "/tmp/page.html",
      ]),
    );
    expect(args.join(" ")).not.toContain("virtual-time-budget");
    expect(args.at(-1)).toBe("/tmp/page.html");
  });

  it("blocks remote hosts only on the stall retry", () => {
    const args = buildChromePrintArgs({
      htmlPath: "/tmp/page.html",
      outPath: "/tmp/out.pdf",
      userDataDir: "/tmp/ud-retry",
      timeoutMs: 5_000,
      blockRemoteHosts: true,
    });
    expect(args).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
  });

  it("clamps a 120s caller timeout back under the TCP-retransmit window", () => {
    expect(clampTimeoutMs(120_000)).toBe(30_000);
    expect(clampTimeoutMs(undefined)).toBe(10_000);
    expect(clampTimeoutMs(50)).toBe(1_000);
  });

  it("points dbus at a missing socket instead of /run/dbus/system_bus_socket", () => {
    const env = chromePrintEnv({ PATH: "/usr/bin", HOME: "/tmp/home" });
    expect(env.DBUS_SYSTEM_BUS_ADDRESS).toMatch(/^unix:path=/);
    expect(env.DBUS_SYSTEM_BUS_ADDRESS).not.toContain("/run/dbus/system_bus_socket");
    expect(env.DBUS_SESSION_BUS_ADDRESS).toMatch(/^unix:path=/);
    expect(env.PATH).toBe("/usr/bin");
  });
});

describe("chrome executable resolution", () => {
  it("prefers CHROME_BIN, then system chromium, then a Playwright cache", () => {
    const root = mkdtempSync(path.join(tmpdir(), "print-pdf-resolve-"));
    const chromeBin = path.join(root, "explicit");
    writeFileSync(chromeBin, "");
    expect(resolveChromeExecutable({ env: { CHROME_BIN: chromeBin, PATH: "" } })).toBe(chromeBin);

    const binDir = path.join(root, "bin");
    mkdirSync(binDir);
    writeFileSync(path.join(binDir, "chromium"), "");
    writeFileSync(path.join(binDir, "google-chrome"), "");
    expect(resolveChromeExecutable({ env: { PATH: binDir } })).toBe(path.join(binDir, "chromium"));

    const workspace = path.join(root, "ws");
    const oldPw = path.join(workspace, ".pw-browsers", "chromium-1134", "chrome-linux");
    const newPw = path.join(workspace, ".pw-browsers", "chromium-1200", "chrome-linux64");
    mkdirSync(oldPw, { recursive: true });
    mkdirSync(newPw, { recursive: true });
    writeFileSync(path.join(oldPw, "chrome"), "");
    writeFileSync(path.join(newPw, "chrome"), "");
    expect(resolveChromeExecutable({ env: { PATH: "", HOME: "" }, cwd: workspace })).toBe(
      path.join(newPw, "chrome"),
    );
  });
});

describe("printHtmlToPdf", () => {
  it("prints on the first attempt when chrome exits", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "print-pdf-ok-"));
    const log = path.join(root, "log");
    writeFileSync(log, "");
    const html = path.join(root, "page.html");
    writeFileSync(html, "<html><body><p>selectable-text</p></body></html>");
    const out = path.join(root, "out.pdf");
    const result = await printHtmlToPdf({
      htmlPath: html,
      outPath: out,
      timeoutMs: 2_000,
      chromeBin: writeFakeChrome(root),
      env: { ...process.env, PRINT_PDF_LOG: log, PRINT_PDF_MODE: "ok" },
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.blockedRemoteHosts).toBe(false);
    expect(readFileSync(out).subarray(0, 5).toString()).toBe("%PDF-");
    const trace = readFileSync(log, "utf8");
    expect(trace).toContain("--timeout=2000");
    expect(trace).toContain("--no-sandbox");
    expect(trace).toContain("--disable-gpu");
    expect(trace).not.toContain("virtual-time-budget");
    expect(trace).toContain("DBUS_SYSTEM_BUS_ADDRESS=unix:path=/tmp/openbot-print-pdf-no-system-bus");
    expect(formatPrintResult(result)).toContain("print-pdf: ok");
  });

  it("kills a hung print and retries with remote hosts blocked", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "print-pdf-hang-"));
    const log = path.join(root, "log");
    writeFileSync(log, "");
    const html = path.join(root, "page.html");
    writeFileSync(html, "<html><body><p>stalled</p></body></html>");
    const out = path.join(root, "out.pdf");
    const started = Date.now();
    const result = await printHtmlToPdf({
      htmlPath: html,
      outPath: out,
      timeoutMs: 1_000,
      chromeBin: writeFakeChrome(root),
      env: { ...process.env, PRINT_PDF_LOG: log, PRINT_PDF_MODE: "hang" },
    });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.blockedRemoteHosts).toBe(true);
    expect(elapsed).toBeLessThan(8_000);
    expect(readFileSync(out).subarray(0, 5).toString()).toBe("%PDF-");
    const lines = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.includes("--print-to-pdf"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("host-resolver-rules");
    expect(lines[1]).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
    expect(formatPrintResult(result)).toContain("remote subresources stalled");
  });

  it("reports a missing html file without launching chrome", async () => {
    const result = await printHtmlToPdf({
      htmlPath: path.join(tmpdir(), "does-not-exist-print-pdf.html"),
      outPath: path.join(tmpdir(), "missing-out.pdf"),
      chromeBin: "/bin/true",
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error).toMatch(/html not found/);
  });
});

describe("real chrome under a stalled subresource", () => {
  const chromeExists = Boolean(REAL_CHROME);

  it.skipIf(!chromeExists)(
    "writes a PDF before the 120s TCP retransmit window",
    async () => {
      const server = net.createServer((socket) => {
        socket.on("error", () => {});
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("hang server did not bind");
      }
      const root = mkdtempSync(path.join(tmpdir(), "print-pdf-live-"));
      const html = path.join(root, "hang.html");
      writeFileSync(
        html,
        `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="http://127.0.0.1:${address.port}/never.css">
</head><body><p>中文 PDF 探测 selectable-text</p></body></html>`,
      );
      const plain = path.join(root, "plain.html");
      writeFileSync(
        plain,
        `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{font-family:sans-serif}</style></head>
<body><p>中文 PDF 探测 selectable-text</p></body></html>`,
      );
      const stalledOut = path.join(root, "stalled.pdf");
      const plainOut = path.join(root, "plain.pdf");
      try {
        const stalled = await printHtmlToPdf({
          htmlPath: html,
          outPath: stalledOut,
          timeoutMs: 3_000,
          chromeBin: REAL_CHROME,
        });
        expect(stalled.ok).toBe(true);
        expect(stalled.attempts).toBe(1);
        expect(stalled.blockedRemoteHosts).toBe(false);
        expect(stalled.elapsedMs).toBeLessThan(8_000);
        expect(stalled.dbusNoiseLines).toBe(0);
        expect(readFileSync(stalledOut).subarray(0, 5).toString()).toBe("%PDF-");
        expect(stalled.bytes).toBeGreaterThan(1_000);
        expect(stalled.args).toContain("--timeout=3000");
        expect(stalled.args.join(" ")).not.toContain("virtual-time-budget");

        const printed = await printHtmlToPdf({
          htmlPath: plain,
          outPath: plainOut,
          timeoutMs: 8_000,
          chromeBin: REAL_CHROME,
        });
        expect(printed.ok).toBe(true);
        expect(printed.attempts).toBe(1);
        expect(printed.dbusNoiseLines).toBe(0);
        expect(readFileSync(plainOut).subarray(0, 5).toString()).toBe("%PDF-");
        const extracted = await extractPdfText(plainOut);
        if (extracted != null) {
          expect(extracted).toContain("中文 PDF 探测");
          expect(extracted).toContain("selectable-text");
        }
      } finally {
        server.close();
      }
    },
    30_000,
  );
});

function extractPdfText(pdfPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("pdftotext", ["-layout", pdfPath, "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      resolve(code === 0 ? stdout : null);
    });
  });
}
