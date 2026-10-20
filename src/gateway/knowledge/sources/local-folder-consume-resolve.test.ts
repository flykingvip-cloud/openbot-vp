import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertLocalFolderBinding } from "./local-folder-binding-store.js";
import { resolveLocalFolderConsumeSource } from "./local-folder-consume-resolve.js";
import { bindKnowledgeSource } from "./source-binding-store.js";

const tmpRoot = path.join(os.tmpdir(), `openbot-lf-consume-${Math.random().toString(36).slice(2)}`);

describe("resolveLocalFolderConsumeSource", () => {
  let bindingStore: string;
  let sourceStore: string;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    bindingStore = path.join(tmpRoot, "bindings.json");
    sourceStore = path.join(tmpRoot, "sources.json");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves a chat folder id from either the binding id or the source descriptor", () => {
    const descriptor = bindKnowledgeSource(
      {
        kind: "localFolder",
        title: "Notes",
        knowledgeBaseId: "kb-1",
        ownerId: "user-a",
        visibility: "private",
        endpoint: "local-folder://lfb:notes",
        metadata: { bindingId: "lfb:notes", mode: "managed_push" },
      },
      sourceStore,
    );
    const binding = upsertLocalFolderBinding(
      {
        bindingId: "lfb:notes",
        sourceDescriptorId: descriptor.id,
        knowledgeBaseId: "kb-1",
        deviceId: "mac-1",
        mode: "managed_push",
        directoryId: "directory-notes",
        rootPath: "",
        rootLabel: "Notes",
        deletePolicy: "snapshot",
      },
      bindingStore,
    );

    expect(
      resolveLocalFolderConsumeSource({
        knowledgeBaseId: "kb-1",
        folderId: binding.bindingId,
        bindingStorePath: bindingStore,
        sourceBindingStorePath: sourceStore,
      }),
    ).toEqual({
      bindingId: "lfb:notes",
      sourceDescriptorId: descriptor.id,
      knowledgeBaseId: "kb-1",
    });
    expect(
      resolveLocalFolderConsumeSource({
        knowledgeBaseId: "kb-1",
        folderId: descriptor.id,
        bindingStorePath: bindingStore,
        sourceBindingStorePath: sourceStore,
      })?.sourceDescriptorId,
    ).toBe(descriptor.id);
    expect(
      resolveLocalFolderConsumeSource({
        knowledgeBaseId: "kb-other",
        folderId: binding.bindingId,
        bindingStorePath: bindingStore,
        sourceBindingStorePath: sourceStore,
      }),
    ).toBeNull();
  });
});
