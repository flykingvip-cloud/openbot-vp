import { describe, expect, it } from "vitest";
import { InMemoryCogniWeaveEngine } from "../runtime/in-memory-engine.js";
import { CogniWeaveRestService } from "./service.js";

describe("CogniWeaveRestService", () => {
  const scope = {
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentId: "agent_main",
    visibility: "private" as const,
  };

  it("maps minimal REST frame/reason/write-back flow", async () => {
    const engine = new InMemoryCogniWeaveEngine({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    });
    const service = new CogniWeaveRestService(engine);

    const frameResponse = await service.handleFrameTask({
      rawInput:
        "Current throughput is dropping and the external API is slow. Should we add synchronous retries?",
      scope,
    });
    const reasonResponse = await service.handleReason({
      taskFrame: frameResponse.body,
    });
    const writeResponse = await service.handleWriteBack(
      {
        rawInput:
          "Current throughput is dropping and the external API is slow. Should we add synchronous retries?",
        scope,
        sourceType: "chat",
        sourceSessionId: "sess_rest",
        package: reasonResponse.body,
      },
      {
        headers: {
          "Idempotency-Key": "idem_001",
        },
      },
    );

    expect(frameResponse.status).toBe(200);
    expect(reasonResponse.status).toBe(200);
    expect(writeResponse.status).toBe(200);
    expect(writeResponse.headers["x-cogniweave-journal-id"]).toBeTruthy();
    expect(writeResponse.body.status).toBe("COMPLETED");
  });

  it("maps partial success to HTTP 202 and exposes journal id", async () => {
    class PartialSuccessEngine extends InMemoryCogniWeaveEngine {
      override async writeBack(input: Parameters<InMemoryCogniWeaveEngine["writeBack"]>[0]) {
        const result = await super.writeBack(input);
        return {
          ...result,
          derivedStatus: "DERIVED_OUT_OF_SYNC" as const,
          status: "PARTIAL_SUCCESS" as const,
        };
      }
    }

    const service = new CogniWeaveRestService(
      new PartialSuccessEngine({
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      }),
    );

    const response = await service.handleWriteBack(
      {
        rawInput: "External API is slow and throughput is dropping.",
        scope,
        sourceType: "chat",
      },
      {
        headers: {
          "Idempotency-Key": "idem_partial",
        },
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers["x-cogniweave-journal-id"]).toBeTruthy();
    expect(response.body.status).toBe("PARTIAL_SUCCESS");
  });
});
