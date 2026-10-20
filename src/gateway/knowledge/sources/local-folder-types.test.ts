import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLocalFolderBindingId,
  getLocalFolderBinding,
  upsertLocalFolderBinding,
} from "./local-folder-binding-store.js";
import type {
  LocalFolderBinding,
  LocalFolderBindRequest,
  SourceDocumentLink,
} from "./local-folder-types.js";
import { isActiveSourceKind, resolveSourcePlane } from "./source-descriptor.js";

const tmpRoot = path.join(os.tmpdir(), `openbot-lf-types-${Math.random().toString(36).slice(2)}`);

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("localFolder three-layer types (P0)", () => {
  it("marks localFolder as passive (not active source.bind plane)", () => {
    expect(resolveSourcePlane("localFolder")).toBe("passive");
    expect(isActiveSourceKind("localFolder")).toBe(false);
  });

  it("keeps absolute path only on LocalFolderBinding, not on bind response shape", () => {
    const binding: LocalFolderBinding = {
      bindingId: "lfb-1",
      sourceDescriptorId: "src-local-1",
      knowledgeBaseId: "kb-1",
      deviceId: "dev-1",
      mode: "local_index",
      rootPath: "/Users/example/Notes",
      rootLabel: "Notes",
      includeGlobs: ["**/*"],
      excludeGlobs: ["**/.git/**"],
      deletePolicy: "snapshot",
      watcherEnabled: true,
      status: "idle",
    };
    expect(binding.rootPath.startsWith("/")).toBe(true);
    expect(binding.rootLabel).toBe("Notes");

    const link: SourceDocumentLink = {
      sourceDescriptorId: binding.sourceDescriptorId,
      docId: "doc-1",
      relativePath: "daily/2026-07-14.md",
      state: "active",
      lastSeenAt: Date.now(),
    };
    expect(link.relativePath.includes(":")).toBe(false);
    expect(link.relativePath.startsWith("/")).toBe(false);
  });

  it("bind request carries opaque directory identity for managed_push", () => {
    const req: LocalFolderBindRequest = {
      knowledgeBaseId: "kb-1",
      rootLabel: "Notes",
      directoryId: "directory-team-1",
      deviceId: "device-1",
      mode: "managed_push",
    };
    expect(req.directoryId).toBe("directory-team-1");
    expect(req.rootPath).toBeUndefined();
  });

  it("keys managed bindings by directoryId, not a colliding display label", () => {
    const common = {
      knowledgeBaseId: "kb-1",
      deviceId: "device-1",
      rootPath: "",
      rootLabel: "Notes",
      mode: "managed_push" as const,
    };
    const first = buildLocalFolderBindingId({ ...common, directoryId: "directory-a" });
    const second = buildLocalFolderBindingId({ ...common, directoryId: "directory-b" });
    const rebound = buildLocalFolderBindingId({
      ...common,
      rootLabel: "Renamed Notes",
      directoryId: "directory-a",
    });
    expect(first).not.toBe(second);
    expect(rebound).toBe(first);
  });

  it("persists directoryId and keeps same-directory rebind idempotent", () => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    const storePath = path.join(tmpRoot, "bindings.json");
    const first = upsertLocalFolderBinding(
      {
        sourceDescriptorId: "source-1",
        knowledgeBaseId: "kb-1",
        deviceId: "device-1",
        mode: "managed_push",
        directoryId: "directory-team-1",
        rootPath: "",
        rootLabel: "Team notes",
      },
      storePath,
    );
    const rebound = upsertLocalFolderBinding(
      {
        sourceDescriptorId: "source-1",
        knowledgeBaseId: "kb-1",
        deviceId: "device-1",
        mode: "managed_push",
        directoryId: "directory-team-1",
        rootPath: "",
        rootLabel: "Team notes renamed",
      },
      storePath,
    );
    expect(first.revision).toBe(1);
    expect(rebound.bindingId).toBe(first.bindingId);
    expect(rebound.directoryId).toBe("directory-team-1");
    expect(rebound.revision).toBe(2);
    expect(getLocalFolderBinding(first.bindingId, storePath)).toMatchObject({
      bindingId: first.bindingId,
      directoryId: "directory-team-1",
      rootLabel: "Team notes renamed",
      revision: 2,
    });
  });
});
