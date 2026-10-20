import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindKnowledgeSource } from "../knowledge/sources/source-binding-store.js";
import { resolveKnowledgeBaseBoundEnterpriseSourceIds } from "./capability-agent-invoke-runtime.js";

describe("resolveKnowledgeBaseBoundEnterpriseSourceIds", () => {
  let bindingsStorePath = "";

  beforeEach(() => {
    const tmp = path.join(os.tmpdir(), `kb-bound-allowlist-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    bindingsStorePath = path.join(tmp, "bindings.json");
  });

  afterEach(() => {
    fs.rmSync(path.dirname(bindingsStorePath), { recursive: true, force: true });
  });

  it("extracts enterprise-data sourceIds from KB bindings", () => {
    bindKnowledgeSource(
      {
        kind: "external",
        title: "雪球",
        knowledgeBaseId: "kb-1",
        ownerId: "user-1",
        endpoint: "enterprise-data://tenant/t1/source/src-xueqiu?connectorId=c1",
      },
      bindingsStorePath,
    );
    bindKnowledgeSource(
      {
        kind: "api",
        title: "Other API",
        knowledgeBaseId: "kb-1",
        ownerId: "user-1",
        endpoint: "https://api.example.test",
      },
      bindingsStorePath,
    );
    bindKnowledgeSource(
      {
        kind: "external",
        title: "Other space",
        knowledgeBaseId: "kb-2",
        ownerId: "user-1",
        endpoint: "enterprise-data://tenant/t1/source/src-other?connectorId=c2",
      },
      bindingsStorePath,
    );

    expect(resolveKnowledgeBaseBoundEnterpriseSourceIds("kb-1", bindingsStorePath)).toEqual([
      "src-xueqiu",
    ]);
    expect(resolveKnowledgeBaseBoundEnterpriseSourceIds("kb-2", bindingsStorePath)).toEqual([
      "src-other",
    ]);
    expect(resolveKnowledgeBaseBoundEnterpriseSourceIds("kb-missing", bindingsStorePath)).toEqual(
      [],
    );
  });
});
