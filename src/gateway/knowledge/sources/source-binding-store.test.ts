// @vitest-environment node
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bindKnowledgeSource,
  listKnowledgeSourceBindings,
  unbindKnowledgeSource,
} from "./source-binding-store.js";
import { resolveSourcePlane } from "./source-descriptor.js";

let storePath: string;

beforeEach(() => {
  storePath = `/tmp/openbot-source-bind-${Math.random().toString(36).slice(2)}.json`;
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

describe("source descriptor plane", () => {
  it("classifies active (runtime) vs passive (indexed) source kinds", () => {
    expect(resolveSourcePlane("api")).toBe("active");
    expect(resolveSourcePlane("external")).toBe("active");
    expect(resolveSourcePlane("capability")).toBe("active");
    expect(resolveSourcePlane("upload")).toBe("passive");
    expect(resolveSourcePlane("web")).toBe("passive");
    expect(resolveSourcePlane("dataset")).toBe("passive");
    expect(resolveSourcePlane("enterprise")).toBe("passive");
  });
});

describe("source binding store", () => {
  it("binds an active source as register-only and is idempotent per kb+kind+endpoint", () => {
    const first = bindKnowledgeSource(
      {
        kind: "api",
        title: "CRM API",
        knowledgeBaseId: "kb-1",
        ownerId: "user-a",
        endpoint: "https://api.example.com/crm",
      },
      storePath,
    );
    expect(first.plane).toBe("active");
    expect(first.id.startsWith("src:")).toBe(true);

    const second = bindKnowledgeSource(
      {
        kind: "api",
        title: "CRM API renamed",
        knowledgeBaseId: "kb-1",
        ownerId: "user-a",
        endpoint: "https://api.example.com/crm",
      },
      storePath,
    );
    expect(second.id).toBe(first.id);
    expect(listKnowledgeSourceBindings({ knowledgeBaseId: "kb-1" }, storePath)).toHaveLength(1);
  });

  it("lists by knowledge base and owner, and unbinds", () => {
    bindKnowledgeSource(
      {
        kind: "external",
        title: "S3 export",
        knowledgeBaseId: "kb-1",
        ownerId: "user-a",
        endpoint: "s3://bucket/export",
      },
      storePath,
    );
    bindKnowledgeSource(
      {
        kind: "api",
        title: "BI metrics",
        knowledgeBaseId: "kb-2",
        ownerId: "user-a",
        endpoint: "https://bi.example.com",
      },
      storePath,
    );
    expect(listKnowledgeSourceBindings({ ownerId: "user-a" }, storePath)).toHaveLength(2);
    const kb2 = listKnowledgeSourceBindings({ knowledgeBaseId: "kb-2" }, storePath);
    expect(kb2).toHaveLength(1);
    const id = kb2[0]?.id ?? "";
    expect(unbindKnowledgeSource(id, storePath)).toBe(true);
    expect(listKnowledgeSourceBindings({ ownerId: "user-a" }, storePath)).toHaveLength(1);
    expect(unbindKnowledgeSource("src:does-not-exist", storePath)).toBe(false);
  });
});
