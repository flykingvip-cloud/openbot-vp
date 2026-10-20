import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { movePathToTrash } from "../browser/trash.js";
import { resolveStateDir } from "../config/paths.js";
import { danger, info } from "../globals.js";
import { copyToClipboard } from "../infra/clipboard.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

export function resolveBundledWebClipperExtensionRootDir(
  here = path.dirname(fileURLToPath(import.meta.url)),
) {
  let current = here;
  while (true) {
    const candidate = path.join(current, "assets", "web-clipper");
    if (hasManifest(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(here, "../../assets/web-clipper");
}

function installedWebClipperExtensionRootDir(stateDir?: string) {
  return path.join(stateDir ?? resolveStateDir(), "web-clipper", "extension");
}

function hasManifest(dir: string) {
  return fs.existsSync(path.join(dir, "manifest.json"));
}

export async function installWebClipperExtension(opts?: {
  stateDir?: string;
  sourceDir?: string;
}): Promise<{ path: string }> {
  const src = opts?.sourceDir ?? resolveBundledWebClipperExtensionRootDir();
  if (!hasManifest(src)) {
    throw new Error("Bundled web clipper extension is missing. Reinstall OpenBot and try again.");
  }

  const stateDir = opts?.stateDir ?? resolveStateDir();
  const dest = installedWebClipperExtensionRootDir(stateDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    await movePathToTrash(dest).catch(() => {
      const backup = `${dest}.old-${Date.now()}`;
      fs.renameSync(dest, backup);
    });
  }

  await fs.promises.cp(src, dest, { recursive: true });
  if (!hasManifest(dest)) {
    throw new Error("Web clipper extension install failed (manifest.json missing). Try again.");
  }

  return { path: dest };
}

export function registerWebClipperCli(program: Command) {
  const clipper = program
    .command("web-clipper")
    .description("Save web pages into OpenBot knowledge bases");

  const ext = clipper.command("extension").description("Chrome web clipper extension helpers");

  ext
    .command("install")
    .description("Install the web clipper extension to a stable local path")
    .action(async (_opts, cmd) => {
      const parent = (cmd.parent?.parent?.opts?.() ?? {}) as { json?: boolean };
      let installed: { path: string };
      try {
        installed = await installWebClipperExtension();
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
        return;
      }

      if (parent?.json) {
        defaultRuntime.log(JSON.stringify({ ok: true, path: installed.path }, null, 2));
        return;
      }
      const displayPath = shortenHomePath(installed.path);
      defaultRuntime.log(displayPath);
      const copied = await copyToClipboard(installed.path).catch(() => false);
      defaultRuntime.error(
        info(
          [
            copied ? "Copied to clipboard." : "Copy to clipboard unavailable.",
            "Chrome → chrome://extensions → Developer mode → Load unpacked → paste path.",
            `Gateway token: set in extension options (${formatCliCommand("openbot config get gateway.auth.token")}).`,
            formatDocsLink("/tools/web-clipper", "Web clipper docs"),
          ].join("\n"),
        ),
      );
    });

  ext
    .command("path")
    .description("Print the installed web clipper extension directory")
    .action(async (_opts, cmd) => {
      const parent = (cmd.parent?.parent?.opts?.() ?? {}) as { json?: boolean };
      const installed = installedWebClipperExtensionRootDir();
      if (!hasManifest(installed)) {
        defaultRuntime.error(
          danger(
            `Web clipper extension is not installed. Run: ${formatCliCommand("openbot web-clipper extension install")}`,
          ),
        );
        defaultRuntime.exit(1);
        return;
      }
      if (parent?.json) {
        defaultRuntime.log(JSON.stringify({ ok: true, path: installed }, null, 2));
        return;
      }
      defaultRuntime.log(shortenHomePath(installed));
    });
}
