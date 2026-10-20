import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SANDBOX_PINNED_MUTATION_PYTHON,
  buildPinnedMutationShellScript,
} from "./fs-bridge-mutation-helper.js";

async function withTempRoot<T>(prefix: string, run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function runMutation(args: string[], input?: string) {
  return spawnSync("python3", ["-c", SANDBOX_PINNED_MUTATION_PYTHON, ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Same argv/stdin shape production uses: `sh -c SCRIPT name ...args` + stdin payload. */
function runProductionMutationScript(args: string[], input?: string | Buffer) {
  const script = buildPinnedMutationShellScript();
  return spawnSync("sh", ["-c", script, "moltbot-sandbox-fs", ...args], {
    input,
    // Omit encoding so stdout/stderr stay Buffers (matches docker exec -i bytes).
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("sandbox pinned mutation helper", () => {
  it("writes through a pinned directory fd", async () => {
    await withTempRoot("openclaw-mutation-helper-", async (root) => {
      const workspace = path.join(root, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      const result = runMutation(["write", workspace, "nested/deeper", "note.txt", "1"], "hello");

      expect(result.status).toBe(0);
      await expect(
        fs.readFile(path.join(workspace, "nested", "deeper", "note.txt"), "utf8"),
      ).resolves.toBe("hello");
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlink-parent writes instead of materializing a temp file outside the mount",
    async () => {
      await withTempRoot("openclaw-mutation-helper-", async (root) => {
        const workspace = path.join(root, "workspace");
        const outside = path.join(root, "outside");
        await fs.mkdir(workspace, { recursive: true });
        await fs.mkdir(outside, { recursive: true });
        await fs.symlink(outside, path.join(workspace, "alias"));

        const result = runMutation(["write", workspace, "alias", "escape.txt", "0"], "owned");

        expect(result.status).not.toBe(0);
        await expect(fs.readFile(path.join(outside, "escape.txt"), "utf8")).rejects.toThrow();
      });
    },
  );

  it.runIf(process.platform !== "win32")("rejects symlink segments during mkdirp", async () => {
    await withTempRoot("openclaw-mutation-helper-", async (root) => {
      const workspace = path.join(root, "workspace");
      const outside = path.join(root, "outside");
      await fs.mkdir(workspace, { recursive: true });
      await fs.mkdir(outside, { recursive: true });
      await fs.symlink(outside, path.join(workspace, "alias"));

      const result = runMutation(["mkdirp", workspace, "alias/nested"]);

      expect(result.status).not.toBe(0);
      await expect(fs.readFile(path.join(outside, "nested"), "utf8")).rejects.toThrow();
    });
  });

  it.runIf(process.platform !== "win32")("remove unlinks the symlink itself", async () => {
    await withTempRoot("openclaw-mutation-helper-", async (root) => {
      const workspace = path.join(root, "workspace");
      const outside = path.join(root, "outside");
      await fs.mkdir(workspace, { recursive: true });
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(path.join(outside, "secret.txt"), "classified", "utf8");
      await fs.symlink(path.join(outside, "secret.txt"), path.join(workspace, "link.txt"));

      const result = runMutation(["remove", workspace, "", "link.txt", "0", "0"]);

      expect(result.status).toBe(0);
      await expect(fs.readlink(path.join(workspace, "link.txt"))).rejects.toThrow();
      await expect(fs.readFile(path.join(outside, "secret.txt"), "utf8")).resolves.toBe(
        "classified",
      );
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlink destination parents during rename",
    async () => {
      await withTempRoot("openclaw-mutation-helper-", async (root) => {
        const workspace = path.join(root, "workspace");
        const outside = path.join(root, "outside");
        await fs.mkdir(workspace, { recursive: true });
        await fs.mkdir(outside, { recursive: true });
        await fs.writeFile(path.join(workspace, "from.txt"), "payload", "utf8");
        await fs.symlink(outside, path.join(workspace, "alias"));

        const result = runMutation([
          "rename",
          workspace,
          "",
          "from.txt",
          workspace,
          "alias",
          "escape.txt",
          "1",
        ]);

        expect(result.status).not.toBe(0);
        await expect(fs.readFile(path.join(workspace, "from.txt"), "utf8")).resolves.toBe(
          "payload",
        );
        await expect(fs.readFile(path.join(outside, "escape.txt"), "utf8")).rejects.toThrow();
      });
    },
  );

  it("production shell script keeps stdin payload (non-empty write)", async () => {
    await withTempRoot("openclaw-mutation-helper-", async (root) => {
      const workspace = path.join(root, "workspace");
      await fs.mkdir(workspace, { recursive: true });
      const payload = "SKILL.md body — must survive production script shape\n".repeat(20);

      const result = runProductionMutationScript(
        ["write", workspace, "skills/comment-reply-post", "SKILL.md", "1"],
        payload,
      );

      expect(result.status, Buffer.from(result.stderr ?? "").toString("utf8")).toBe(0);
      const written = await fs.readFile(
        path.join(workspace, "skills", "comment-reply-post", "SKILL.md"),
      );
      expect(written.byteLength).toBe(Buffer.byteLength(payload));
      expect(written.toString("utf8")).toBe(payload);
    });
  });

  it("production shell script overwrites a prior non-empty file without zeroing", async () => {
    await withTempRoot("openclaw-mutation-helper-", async (root) => {
      const workspace = path.join(root, "workspace");
      const target = path.join(workspace, "skills", "comment-reply-post", "SKILL.md");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "hello from exec\n", "utf8");
      const payload = "# replaced by write tool\nfull skill body\n";

      const result = runProductionMutationScript(
        ["write", workspace, "skills/comment-reply-post", "SKILL.md", "1"],
        payload,
      );

      expect(result.status, Buffer.from(result.stderr ?? "").toString("utf8")).toBe(0);
      await expect(fs.readFile(target, "utf8")).resolves.toBe(payload);
      expect((await fs.stat(target)).size).toBeGreaterThan(0);
    });
  });

  it.runIf(process.platform !== "win32")(
    "copies directories across different mount roots during rename fallback",
    async () => {
      await withTempRoot("openclaw-mutation-helper-", async (root) => {
        const sourceRoot = path.join(root, "source");
        const destRoot = path.join(root, "dest");
        await fs.mkdir(path.join(sourceRoot, "dir", "nested"), { recursive: true });
        await fs.mkdir(destRoot, { recursive: true });
        await fs.writeFile(path.join(sourceRoot, "dir", "nested", "file.txt"), "payload", "utf8");

        const result = runMutation(["rename", sourceRoot, "", "dir", destRoot, "", "moved", "1"]);

        expect(result.status).toBe(0);
        await expect(
          fs.readFile(path.join(destRoot, "moved", "nested", "file.txt"), "utf8"),
        ).resolves.toBe("payload");
        await expect(fs.stat(path.join(sourceRoot, "dir"))).rejects.toThrow();
      });
    },
  );
});
