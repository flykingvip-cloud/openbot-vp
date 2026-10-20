import { describe, expect, it } from "vitest";
import {
  buildActiveCiteUri,
  buildDeliverableCiteUri,
  buildDocumentCiteUri,
  parseCiteUri,
} from "./cite.js";

describe("ke cite", () => {
  it("round-trips document ku:// URIs including section", () => {
    const uri = buildDocumentCiteUri({
      kbId: "kb 1",
      docId: "doc/a",
      versionId: "v3",
      section: "2.1",
    });
    expect(uri).toBe("ku://kb/kb%201/doc/doc%2Fa@v3#2.1");
    expect(parseCiteUri(uri)).toEqual({
      kind: "document",
      kbId: "kb 1",
      docId: "doc/a",
      versionId: "v3",
      section: "2.1",
    });
  });

  it("parses deliverable and active URIs emitted by resolve-engine", () => {
    const deliverable = buildDeliverableCiteUri({
      workspaceId: "ws1",
      deliverableId: "d9",
      versionId: "1710000000000",
    });
    expect(parseCiteUri(deliverable)).toEqual({
      kind: "deliverable",
      workspaceId: "ws1",
      deliverableId: "d9",
      versionId: "1710000000000",
    });

    const active = buildActiveCiteUri({
      sourceId: "src-1",
      requestPath: "/v1/items?token=secret#frag",
    });
    expect(active).toBe("ku://active/src-1/v1/items");
    expect(parseCiteUri(active)).toEqual({
      kind: "active",
      sourceId: "src-1",
      route: "/v1/items",
    });
  });

  it("returns null for unknown schemes", () => {
    expect(parseCiteUri("https://example.com/doc")).toBeNull();
    expect(parseCiteUri("ku://other/x")).toBeNull();
  });
});
