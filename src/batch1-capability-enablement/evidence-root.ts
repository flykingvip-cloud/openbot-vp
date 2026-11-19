import os from "node:os";
import path from "node:path";

/** Portable evidence output; operators may select a durable directory explicitly. */
export const BATCH1_EVIDENCE_ROOT =
  process.env.OPENBOT_BATCH1_EVIDENCE_DIR?.trim() ||
  path.join(os.tmpdir(), "openbot-batch1-evidence");
