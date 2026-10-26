import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import type { TaskOutcomeRecord } from "./types.js";

const agentDir = process.argv[2]!;
const recordPath = process.argv[3]!;
const barrier = process.argv[4]!;
const id = process.argv[5]!;

while (!fs.existsSync(barrier)) {
  // busy wait
}

const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as TaskOutcomeRecord;
const out = publishEvolutionFromTaskOutcome(cfg, "bot", record);
fs.writeFileSync(
  path.join(path.dirname(barrier), `growth-race-${id}.json`),
  JSON.stringify(out),
  "utf8",
);
