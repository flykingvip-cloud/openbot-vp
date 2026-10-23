/**
 * Test-only process for Ev3/Ev4. Spawned with tsx. Not a product ingress.
 * Modes:
 *   consume                      — one consume, JSON on stdout
 *   consume-then-sigkill         — consume, claim (persist running), SIGKILL
 *   consume-sigkill-before-claim — consume, SIGKILL before claim
 */
import { claimOguiDecisionResume, consumeOguiDecisionAnswer } from "./ogui-decision-engine.js";

const storePath = process.env.OGUI_CHILD_STORE ?? "";
const sessionKey = process.env.OGUI_CHILD_SESSION ?? "";
const decisionId = process.env.OGUI_CHILD_DECISION ?? "";
const value = process.env.OGUI_CHILD_VALUE ?? "a";
const submissionId = process.env.OGUI_CHILD_SUBMISSION ?? "";
const mode = process.env.OGUI_CHILD_MODE ?? "consume";

function answer() {
  return {
    schema_version: "ogui/v1",
    component_id: "cmp-1",
    submission_id: submissionId,
    decision_id: decisionId,
    decision_version: 1,
    answers: { choice: value },
  };
}

async function main(): Promise<void> {
  const env = { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" };
  if (
    mode === "consume" ||
    mode === "consume-sigkill-before-claim" ||
    mode === "consume-then-sigkill"
  ) {
    const consumed = await consumeOguiDecisionAnswer({
      storePath,
      sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env,
      answer: answer(),
    });
    if (mode === "consume") {
      process.stdout.write(`${JSON.stringify(consumed)}\n`);
      return;
    }
    if (mode === "consume-sigkill-before-claim") {
      process.kill(process.pid, "SIGKILL");
      return;
    }
    await claimOguiDecisionResume({
      storePath,
      sessionKey,
      decisionId,
      lifecycleEnabled: true,
    });
    process.kill(process.pid, "SIGKILL");
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

main().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
