/**
 * Child process for recheck / notify durability proofs.
 * Started by recheck-notify-hardening.test.ts and then exited or killed.
 * Does not open a gateway or a production channel.
 */
import fs from "node:fs";
import type { OpenBotConfig } from "../config/config.js";
import { deliverCorrectionNotice } from "./correction-notify.js";
import { withDurableJsonLock } from "./durable-json-file.js";
import { recheckObservationFilePath, recordRecheckObservation } from "./recheck-observation.js";

type NotifyPayload = {
  agentDir: string;
  agentId: string;
  taskId: string;
  negatedOutcomeVersion: number;
  correctionOutcomeVersion: number;
  judgement: string;
  subjectRef: string;
  verifiedPlatformUserId: string;
  callerTenantId?: string;
  sentLog: string;
};

function writeResult(outFile: string, value: unknown): void {
  fs.writeFileSync(outFile, `${JSON.stringify(value)}\n`, "utf8");
}

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === "record") {
    const [rootDir, taskId, versionText, status, outFile] = args;
    if (!rootDir || !taskId || !versionText || !outFile) {
      throw new Error("record requires <root> <taskId> <version> <status> <outFile>");
    }
    if (status !== "incomplete" && status !== "completed") {
      throw new Error("record status must be incomplete or completed");
    }
    const result = await recordRecheckObservation({
      rootDir,
      taskId,
      outcomeVersion: Number(versionText),
      status,
    });
    writeResult(outFile, result);
    return;
  }
  if (command === "hold-lock") {
    const [rootDir, taskId, readyPath] = args;
    if (!rootDir || !taskId || !readyPath) {
      throw new Error("hold-lock requires <root> <taskId> <readyPath>");
    }
    const filePath = recheckObservationFilePath(rootDir, taskId);
    await withDurableJsonLock(filePath, async () => {
      fs.writeFileSync(readyPath, "ready\n", "utf8");
      await new Promise<void>(() => {
        // Active timer so the process stays up while the parent kills it.
        setInterval(() => undefined, 1_000);
      });
    });
    return;
  }
  if (command === "notify") {
    const [payloadPath, outFile] = args;
    if (!payloadPath || !outFile) {
      throw new Error("notify requires <payload> <outFile>");
    }
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8")) as NotifyPayload;
    const cfg = {
      agents: { list: [{ id: payload.agentId, agentDir: payload.agentDir }] },
    } as unknown as OpenBotConfig;
    const result = await deliverCorrectionNotice({
      enabled: true,
      cfg,
      agentId: payload.agentId,
      taskId: payload.taskId,
      negatedOutcomeVersion: payload.negatedOutcomeVersion,
      correctionOutcomeVersion: payload.correctionOutcomeVersion,
      judgement: payload.judgement,
      revisionKind: "correction",
      subjectRef: payload.subjectRef,
      ...(payload.callerTenantId ? { callerTenantId: payload.callerTenantId } : {}),
      verifiedPlatformUserId: payload.verifiedPlatformUserId,
      mappingVerified: false,
      send: () => {
        fs.appendFileSync(payload.sentLog, "sent\n", "utf8");
        return { accepted: true };
      },
    });
    writeResult(outFile, result);
    return;
  }
  throw new Error(`unknown command ${command ?? ""}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
