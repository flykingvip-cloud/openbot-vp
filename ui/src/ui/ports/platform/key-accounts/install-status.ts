/**
 * Read-only install tracking: which signed preinstall package is bound to
 * which artifact train, and whether that train has drifted.
 * Does not write the productization digest ledger.
 */

import { findArtifactByDigest, formatTrainSeq } from "../productization/fixtures.ts";
import { artifactIsDrift } from "../productization/release-health.ts";
import { KEY_ACCOUNT_SHIPMENT_BATCHES } from "./fixtures.ts";
import { findSignedAppPreinstallPackage } from "./signed-app-catalog.ts";
import type { KeyAccountPartner } from "./state.ts";

export type BoundTrain = {
  packageId: string;
  trainSeq: string;
  trainLabel: string;
  versionNarrative: string;
  digest: string;
  drifted: boolean;
  candidate: boolean;
};

export function boundTrainForPackage(packageId: string): BoundTrain | null {
  const item = findSignedAppPreinstallPackage(packageId);
  if (!item) {
    return null;
  }
  const artifact = findArtifactByDigest(item.artifactDigest);
  if (!artifact || artifact.signature !== "verified") {
    return null;
  }
  return {
    packageId: item.id,
    trainSeq: artifact.trainSeq,
    trainLabel: formatTrainSeq(artifact.trainSeq),
    versionNarrative: artifact.versionNarrative,
    digest: artifact.digest,
    drifted: artifactIsDrift(artifact),
    candidate: artifact.status === "candidate",
  };
}

export function partnerBoundTrains(partner: KeyAccountPartner): BoundTrain[] {
  return partner.packageIds
    .map((id) => boundTrainForPackage(id))
    .filter((item): item is BoundTrain => item !== null);
}

export function partnerInstallValue(partner: KeyAccountPartner): {
  value: string;
  tone: "ready" | "missing" | "drift";
} {
  const trains = partnerBoundTrains(partner);
  if (trains.length === 0) {
    return { value: "未绑定安装", tone: "missing" };
  }
  if (trains.some((train) => train.drifted)) {
    const drifted = trains.filter((train) => train.drifted).map((train) => train.trainLabel);
    return { value: `${drifted.join("、")} 版本漂移`, tone: "drift" };
  }
  const shipments = KEY_ACCOUNT_SHIPMENT_BATCHES.filter(
    (batch) => batch.partnerCode === partner.code,
  );
  if (shipments.length === 0) {
    const labels = trains.map((train) => train.trainLabel).join("、");
    return { value: `${labels} 已绑定，待跟踪`, tone: "missing" };
  }
  const pendingPromote = trains.filter((train) => train.candidate).map((train) => train.trainLabel);
  if (pendingPromote.length > 0) {
    return { value: `${pendingPromote.join("、")} 尚未晋升`, tone: "drift" };
  }
  return {
    value: `已跟踪 ${shipments.map((batch) => batch.id).join("、")}`,
    tone: "ready",
  };
}
