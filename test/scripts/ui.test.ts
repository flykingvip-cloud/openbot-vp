import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeWindowsShellArgs, shouldUseShellForCommand } from "../../scripts/ui.js";

describe("scripts/ui windows spawn behavior", () => {
  it("enables shell for Windows command launchers that require cmd.exe", () => {
    expect(
      shouldUseShellForCommand("C:\\Users\\dev\\AppData\\Local\\pnpm\\pnpm.CMD", "win32"),
    ).toBe(true);
    expect(shouldUseShellForCommand("C:\\tools\\pnpm.bat", "win32")).toBe(true);
  });

  it("does not enable shell for non-shell launchers", () => {
    expect(shouldUseShellForCommand("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(false);
    expect(shouldUseShellForCommand("/usr/local/bin/pnpm", "linux")).toBe(false);
  });

  it("allows safe forwarded args when shell mode is required on Windows", () => {
    expect(() =>
      assertSafeWindowsShellArgs(["run", "build", "--filter", "@openclaw/ui"], "win32"),
    ).not.toThrow();
  });

  it("rejects dangerous forwarded args when shell mode is required on Windows", () => {
    expect(() => assertSafeWindowsShellArgs(["run", "build", "evil&calc"], "win32")).toThrow(
      /unsafe windows shell argument/i,
    );
    expect(() => assertSafeWindowsShellArgs(["run", "build", "%PATH%"], "win32")).toThrow(
      /unsafe windows shell argument/i,
    );
  });

  it("does not reject args on non-windows platforms", () => {
    expect(() => assertSafeWindowsShellArgs(["contains&metacharacters"], "linux")).not.toThrow();
  });
});

// Every CLI invocation gets its own HOME, config, dependencies and fake runner.
describe.skipIf(process.platform === "win32")("isolated build output boundary", () => {
  function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ui-boundary-")));
    roots.push(root);
    for (const dir of ["scripts", "ui", "bin", "state", "dist/control-ui", "external"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const name of ["ui.js", "openbot-surface.mjs"]) {
      fs.copyFileSync(
        new URL(`../../scripts/${name}`, import.meta.url),
        path.join(root, "scripts", name),
      );
    }
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "ui/package.json"), "{}");
    for (const name of ["vite", "dompurify"]) {
      const dir = path.join(root, "ui/node_modules", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "index.js"), "");
    }
    fs.writeFileSync(path.join(root, "dist/control-ui/index.html"), "candidate");
    fs.writeFileSync(path.join(root, "external/index.html"), "original");
    fs.writeFileSync(
      path.join(root, "bin/pnpm"),
      `#!${process.execPath}\nprocess.exit(Number(process.env.FIXTURE_EXIT || 0));\n`,
      { mode: 0o755 },
    );
    const target = path.join(root, "external");
    const configure = (value: string) =>
      fs.writeFileSync(
        path.join(root, "state/openbot.json"),
        JSON.stringify({ gateway: { controlUi: { root: value } } }),
      );
    configure(target);
    const run = (env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [path.join(root, "scripts/ui.js"), "build"], {
        env: {
          PATH: path.join(root, "bin"),
          HOME: root,
          OPENBOT_STATE_DIR: path.join(root, "state"),
          ...env,
        },
        encoding: "utf8",
      });
    const explicit = { OPENBOT_CONTROL_UI_SYNC: "1", OPENBOT_CONTROL_UI_SYNC_TARGET: target };
    return {
      root,
      target,
      configure,
      run,
      explicit,
      content: () => fs.readFileSync(path.join(target, "index.html"), "utf8"),
    };
  }
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("default build and legacy force flag leave external output untouched", () => {
    const f = fixture();
    expect(f.run({ OPENBOT_CONTROL_UI_FORCE_SYNC: "1" }).status).toBe(0);
    expect(f.content()).toBe("original");
    expect(fs.readdirSync(f.target)).toEqual(["index.html"]);
  });
  it("does not copy after a failed build", () => {
    const f = fixture();
    expect(f.run({ ...f.explicit, FIXTURE_EXIT: "7" }).status).toBe(7);
    expect(f.content()).toBe("original");
  });
  it("copies only for explicit normalized matching targets", () => {
    const f = fixture();
    expect(
      f.run({ ...f.explicit, OPENBOT_CONTROL_UI_SYNC_TARGET: `${f.target}/../external` }).status,
    ).toBe(0);
    expect(f.content()).toBe("candidate");
  });
  it("preserves pin blocking and explicit force override", () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.target, ".control-ui-sync-pin"), "pinned");
    expect(f.run(f.explicit).status).toBe(0);
    expect(f.content()).toBe("original");
    expect(f.run({ ...f.explicit, OPENBOT_CONTROL_UI_FORCE_SYNC: "1" }).status).toBe(0);
    expect(f.content()).toBe("candidate");
  });
  it.each(["", "/", "relative", "source", "child", "parent", "mismatch", "alias"])(
    "rejects %s before copying",
    (kind) => {
      const f = fixture();
      const src = path.join(f.root, "dist/control-ui");
      const targets: Record<string, string> = {
        "": "",
        "/": "/",
        relative: "relative",
        source: src,
        child: path.join(src, "child"),
        parent: path.dirname(src),
        mismatch: path.join(f.root, "other"),
        alias: path.join(f.root, "alias"),
      };
      if (kind === "alias") {
        fs.symlinkSync(src, targets.alias);
      }
      const target = targets[kind];
      if (kind !== "mismatch") {
        f.configure(target);
      }
      const before = fs.readdirSync(path.join(f.root, "dist"), { recursive: true });
      expect(f.run({ ...f.explicit, OPENBOT_CONTROL_UI_SYNC_TARGET: target }).status).not.toBe(0);
      expect(f.content()).toBe("original");
      expect(fs.readdirSync(path.join(f.root, "dist"), { recursive: true })).toEqual(before);
      expect(fs.existsSync(path.join(f.root, "other"))).toBe(false);
    },
  );
});
