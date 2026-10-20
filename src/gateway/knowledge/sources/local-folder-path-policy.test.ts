import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalFolderRootPathAllowed } from "./local-folder-path-policy.js";

describe("local-folder-path-policy", () => {
  const dataRoot = path.join(os.tmpdir(), "OpenBot-policy-test");
  const cfg = { data: { root: dataRoot, mode: "local" as const } };
  const env = { ...process.env, OPENBOT_DATA_ROOT: dataRoot };

  it("rejects relative paths", () => {
    const result = assertLocalFolderRootPathAllowed({
      rootPath: ".",
      cfg,
      env,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("path_not_absolute");
    }
  });

  it("rejects paths outside Data Space without explicit approval", () => {
    const result = assertLocalFolderRootPathAllowed({
      rootPath: path.join(os.tmpdir(), "outside-openbot"),
      cfg,
      env,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("path_outside_data_space");
    }
  });

  it("allows paths under Data Space", () => {
    const inside = path.join(dataRoot, "notes");
    const result = assertLocalFolderRootPathAllowed({
      rootPath: inside,
      cfg,
      env,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.withinDataRoot).toBe(true);
      expect(result.resolvedPath).toBe(path.resolve(inside));
    }
  });

  it("allows outside path only with allowOutsideDataRoot", () => {
    const outside = path.join(os.tmpdir(), "outside-openbot-approved");
    const denied = assertLocalFolderRootPathAllowed({
      rootPath: outside,
      cfg,
      env,
    });
    expect(denied.ok).toBe(false);
    const allowed = assertLocalFolderRootPathAllowed({
      rootPath: outside,
      allowOutsideDataRoot: true,
      cfg,
      env,
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.withinDataRoot).toBe(false);
    }
  });
});

describe("managed_push rootPath isolation", () => {
  it("upsertLocalFolderBinding strips rootPath for managed_push", async () => {
    const { upsertLocalFolderBinding, getLocalFolderBinding, deleteLocalFolderBinding } =
      await import("./local-folder-binding-store.js");
    const storePath = path.join(os.tmpdir(), `lfb-managed-${Date.now()}.json`);
    const binding = upsertLocalFolderBinding(
      {
        sourceDescriptorId: "src-1",
        knowledgeBaseId: "kb-1",
        deviceId: "device-abc",
        mode: "managed_push",
        directoryId: "directory-managed-root-path-test",
        rootPath: "/Users/someone/secret-notes",
        rootLabel: "Notes",
      },
      storePath,
    );
    expect(binding.rootPath).toBe("");
    expect(getLocalFolderBinding(binding.bindingId, storePath)?.rootPath).toBe("");
    deleteLocalFolderBinding(binding.bindingId, storePath);
  });
});
