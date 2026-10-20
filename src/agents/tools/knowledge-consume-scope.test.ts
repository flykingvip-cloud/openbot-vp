import { describe, expect, it } from "vitest";
import {
  fileIdFromKnowledgeObjectId,
  isKnowledgeTargetInConsumeScope,
  resolveKnowledgeConsumeSearchScope,
} from "./knowledge-consume-scope.js";

describe("knowledge consume scope", () => {
  it("extracts personal and document object ids", () => {
    expect(fileIdFromKnowledgeObjectId("obj:personal:skill_c0550e28c46b")).toBe(
      "skill_c0550e28c46b",
    );
    expect(fileIdFromKnowledgeObjectId("obj:doc:doc-resume")).toBe("doc-resume");
    expect(fileIdFromKnowledgeObjectId("obj:kb:kb_personal")).toBeNull();
  });

  it("treats a selected file as focused docs and does not treat folders as docs", () => {
    expect(
      resolveKnowledgeConsumeSearchScope([
        { type: "knowledge-file", id: "skill_c0550e28c46b", parentId: "kb_personal" },
      ]),
    ).toEqual({
      focused: true,
      knowledgeBaseIds: ["kb_personal"],
      docIds: ["skill_c0550e28c46b"],
    });
    expect(
      resolveKnowledgeConsumeSearchScope([
        { type: "folder", id: "lfb-design", parentId: "kb_product" },
      ]),
    ).toEqual({
      focused: true,
      knowledgeBaseIds: ["kb_product"],
      docIds: [],
    });
  });

  it("keeps file focus on the selected document and rejects other files", () => {
    const scope = resolveKnowledgeConsumeSearchScope([
      { type: "knowledge-file", id: "skill_c0550e28c46b", parentId: "kb_personal" },
    ]);
    expect(
      isKnowledgeTargetInConsumeScope(scope, {
        objectId: "obj:personal:skill_c0550e28c46b",
        docId: "skill_c0550e28c46b",
      }),
    ).toBe(true);
    expect(
      isKnowledgeTargetInConsumeScope(scope, {
        objectId: "obj:doc:doc-resume",
        docId: "doc-resume",
        knowledgeBaseId: "kb_a478311b33eb7f81",
      }),
    ).toBe(false);
  });
});
