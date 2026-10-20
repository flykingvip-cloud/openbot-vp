import { describe, expect, it } from "vitest";
import { createAdapterBundle } from "./factory.js";

describe("createAdapterBundle", () => {
  it("resolves in-memory adapters for memory backends", () => {
    const bundle = createAdapterBundle({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });

    expect(bundle.resolutions.map((item) => item.implementation)).toEqual([
      "in-memory",
      "in-memory",
      "in-memory",
    ]);
  });

  it("resolves named backend skeletons for postgres/neo4j/pgvector", () => {
    const bundle = createAdapterBundle({
      environment: "service",
      metadataBackend: "postgres",
      graphBackend: "neo4j",
      evidenceBackend: "s3",
      vectorBackend: "pgvector",
    });

    expect(bundle.resolutions[0]?.descriptor.capabilities).toContain("canonical-write");
    expect(bundle.resolutions[0]?.descriptor.capabilities).toContain("schema-bootstrap");
    expect(bundle.resolutions[0]?.implementation).toBe("sql-first");
    expect(bundle.resolutions[1]?.descriptor.capabilities).toContain("path-query");
    expect(bundle.resolutions[1]?.descriptor.capabilities).toContain("schema-bootstrap");
    expect(bundle.resolutions[2]?.descriptor.capabilities).toContain("similarity-search");
    expect(bundle.resolutions[2]?.descriptor.capabilities).toContain("schema-bootstrap");
    expect(bundle.resolutions[2]?.implementation).toBe("sql-first");
  });

  it("requires an explicit path for local metadata backend", () => {
    expect(() =>
      createAdapterBundle({
        environment: "local",
        metadataBackend: "local",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      }),
    ).toThrow('metadataBackend "local" requires metadataStorePath');
  });
});
