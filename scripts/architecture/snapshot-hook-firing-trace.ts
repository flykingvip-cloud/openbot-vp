import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureTraceByName, type HookFiringTrace } from "./hook-firing-scenarios.js";

const SCENARIO_NAMES = [
  "before_agent_start_empty_registry",
  "before_model_resolve_priority_override",
  "before_prompt_build_prepend_concat",
  "before_agent_start_legacy_compat_merge",
  "message_received_parallel_two_plugins",
  "subagent_spawning_sequential_merge",
  "before_tool_call_block_takes_priority",
];

async function main(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outPath = path.join(
    repoRoot,
    ".kiro/specs/gateway-plugins-monolith-decomposition/baseline",
    "hooks-firing-trace.json",
  );

  const traces: HookFiringTrace[] = [];
  for (const scenario of SCENARIO_NAMES) {
    traces.push(await captureTraceByName(scenario));
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(traces, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, outPath)} (${traces.length} scenarios)`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
