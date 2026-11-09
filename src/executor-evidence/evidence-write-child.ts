/** Isolation child for the last-disk-slot race. No network. */
import fs from "node:fs";
import { writeBoundedEvidenceFile } from "./model-call-evidence.js";

process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
const [storeRoot, fileName, bytes, outFile] = process.argv.slice(2);
const result = writeBoundedEvidenceFile(storeRoot ?? "", fileName ?? "x.json", {
  pad: "z".repeat(Number(bytes) || 1),
});
fs.writeFileSync(outFile ?? "", `${JSON.stringify({ result })}\n`);
