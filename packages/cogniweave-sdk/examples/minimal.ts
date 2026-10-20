import { InMemoryCogniWeaveEngine } from "../src/index.js";

async function main(): Promise<void> {
  const engine = new InMemoryCogniWeaveEngine({
    environment: "local",
    metadataBackend: "memory",
    graphBackend: "memory",
    evidenceBackend: "memory",
    vectorBackend: "memory",
  });

  const scope = {
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentId: "agent_main",
    visibility: "private" as const,
  };

  const rawInput =
    "Current throughput is dropping and the external API is very slow. Should we add synchronous retries or move to async buffering?";

  const task = await engine.frameTask(rawInput, { scope });
  const pkg = await engine.reason(task);
  const writeResult = await engine.writeBack({
    rawInput,
    scope,
    sourceType: "chat",
    sourceSessionId: "sess_001",
    package: pkg,
  });
  const trace = await engine.tracePackage(pkg.packageId, { scope });

  console.log("Task type:", task.taskType);
  console.log("Answer:", pkg.answer.summary);
  console.log("Write status:", writeResult.status);
  console.log("Template:", trace.selectedTemplate);
  console.log("Supporting atoms:", trace.supportingAtoms.map((atom) => atom.atomType).join(", "));
}

void main();
