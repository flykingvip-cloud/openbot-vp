import { describe, expect, it } from "vitest";
import { createCogniWeaveRuntime } from "../index.js";

describe("createCogniWeaveRuntime", () => {
  it("creates a connected engine, service, and server", () => {
    const runtime = createCogniWeaveRuntime({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });

    expect(runtime.engine).toBeDefined();
    expect(runtime.service).toBeDefined();
    expect(runtime.server).toBeDefined();
    expect(runtime.config.metadataBackend).toBe("memory");
  });
});
