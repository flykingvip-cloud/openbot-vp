/**
 * Evidence harness for ARTIFACT_GRANT_MVP.
 * Run: node_modules/.bin/tsx scripts/verify-artifact-grant-mvp.ts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactGrantService } from "../src/artifact-grant/index.js";

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verify-artifact-grant-"));
  const service = createArtifactGrantService({ rootDir: root });
  const steps: Array<{ name: string; ok: boolean; detail?: string }> = [];

  const published = await service.publish({
    userId: "user-demo",
    publisherAgentId: "bot-writer",
    name: "quarterly-review.md",
    contentType: "text/markdown",
    content: "# Q review\nPlease check section 2.",
  });
  steps.push({
    name: "publish",
    ok: published.ok,
    detail: published.ok ? published.artifact.artifactId : published.reason,
  });

  if (!published.ok) {
    throw new Error("publish failed");
  }

  const grant = await service.createGrant({
    userId: "user-demo",
    publisherAgentId: "bot-writer",
    artifactId: published.artifact.artifactId,
    granteeAgentId: "bot-reviewer",
    ttlMs: 120_000,
    singleUse: false,
  });
  steps.push({
    name: "createGrant",
    ok: grant.ok,
    detail: grant.ok ? grant.grant.grantId : grant.reason,
  });
  if (!grant.ok) {
    throw new Error("createGrant failed");
  }

  const redeemOk = await service.redeem({
    userId: "user-demo",
    actorAgentId: "bot-reviewer",
    grantId: grant.grant.grantId,
  });
  steps.push({
    name: "redeem_grantee",
    ok: Boolean(redeemOk.ok && redeemOk.text?.includes("section 2")),
    detail: redeemOk.ok ? "content_ok" : redeemOk.reason,
  });

  const redeemWrong = await service.redeem({
    userId: "user-demo",
    actorAgentId: "bot-intruder",
    grantId: grant.grant.grantId,
  });
  steps.push({
    name: "deny_wrong_agent",
    ok: !redeemWrong.ok && redeemWrong.reason === "not_grantee",
    detail: redeemWrong.ok ? "unexpected_ok" : redeemWrong.reason,
  });

  const revoked = await service.revoke({
    userId: "user-demo",
    actorAgentId: "bot-writer",
    grantId: grant.grant.grantId,
  });
  steps.push({ name: "revoke", ok: revoked.ok });

  const afterRevoke = await service.redeem({
    userId: "user-demo",
    actorAgentId: "bot-reviewer",
    grantId: grant.grant.grantId,
  });
  steps.push({
    name: "deny_revoked",
    ok: !afterRevoke.ok && afterRevoke.reason === "revoked",
    detail: afterRevoke.ok ? "unexpected_ok" : afterRevoke.reason,
  });

  const allOk = steps.every((s) => s.ok);
  const report = { landing: "ARTIFACT_GRANT_MVP", root, allOk, steps };
  console.log(JSON.stringify(report, null, 2));
  await fs.rm(root, { recursive: true, force: true });
  if (!allOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
