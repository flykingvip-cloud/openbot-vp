import { describe, expect, it } from "vitest";
import { createAdapterBundle } from "./factory.js";

describe("createAdapterBundle postgres client injection", () => {
  it("rejects connectionString without an injected client", () => {
    expect(() =>
      createAdapterBundle({
        environment: "service",
        metadataBackend: "postgres",
        graphBackend: "memory",
        evidenceBackend: "memory",
        postgres: { connectionString: "postgresql://localhost/db" },
      }),
    ).toThrow(/injected client/);
  });

  it("accepts an injected client for postgres metadata", () => {
    const bundle = createAdapterBundle({
      environment: "service",
      metadataBackend: "postgres",
      graphBackend: "memory",
      evidenceBackend: "memory",
      postgres: {
        client: {
          async query() {
            return { rows: [], rowCount: 0 };
          },
        },
        schema: "cw_test",
      },
    });
    expect(bundle.resolutions[0]?.implementation).toBe("sql-first");
  });
});
