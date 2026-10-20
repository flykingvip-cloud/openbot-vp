import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostWorkspaceEditTool, createHostWorkspaceWriteTool } from "./pi-tools.read.js";

describe("desktop save is not a workspace write", () => {
  it("returns the node exec command instead of a sandbox escape", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-desktop-save-"));
    try {
      const writeTool = createHostWorkspaceWriteTool(root, { workspaceOnly: true });
      let message = "";
      try {
        await writeTool.execute("w1", {
          path: "/Users/daniel/Desktop/整理清单.txt",
          content: "alpha",
        });
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toContain('host "node"');
      expect(message).toContain('"$HOME/Desktop/整理清单.txt"');
      expect(message).toContain("alpha");
      expect(message).not.toContain("Path escapes sandbox root");

      await writeTool.execute("w2", { path: "notes.txt", content: "inside" });
      expect(await fs.readFile(path.join(root, "notes.txt"), "utf8")).toBe("inside");

      const editTool = createHostWorkspaceEditTool(root, { workspaceOnly: true });
      await expect(
        editTool.execute("e1", {
          path: "~/Desktop/notes.txt",
          oldText: "a",
          newText: "b",
        }),
      ).rejects.toThrow(/Do not call write or edit/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
