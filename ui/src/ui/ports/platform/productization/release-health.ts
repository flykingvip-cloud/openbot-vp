/**
 * Read-only release-health snapshot for the delivery overview.
 * Counts come from the demo artifact ledger and the in-memory channel list.
 * Nothing here promotes a train or writes a digest.
 */

import {
  PRODUCTIZATION_ARTIFACTS,
  findArtifactByDigest,
  formatTrainSeq,
  type ProductizationArtifact,
  type ProductizationChannel,
} from "./fixtures.ts";

export type ReleaseHealth = {
  stableTrainSeq: string | null;
  stableChannelName: string | null;
  drift: readonly ProductizationArtifact[];
  pending: readonly ProductizationArtifact[];
  writableChannels: readonly ProductizationChannel[];
  alignedChannelCount: number;
};

/**
 * Version drift operators act on: observed image, releases digest, or LIVE uniqueness.
 * Reconcile still compares image digest with the artifact digest (different objects on
 * every demo train). That card stays on the reconcile page and is not a row highlight.
 */
export function artifactIsDrift(artifact: ProductizationArtifact): boolean {
  return (
    artifact.observedImageDigest !== artifact.imageDigest ||
    artifact.releasesDigest !== artifact.digest ||
    !artifact.releasesLiveUnique
  );
}

function channelPointsAtStableArtifact(channel: ProductizationChannel): boolean {
  const artifact = findArtifactByDigest(channel.currentDigest);
  if (!artifact) {
    return false;
  }
  return (
    artifact.signature === "verified" && artifact.status !== "retired" && !artifactIsDrift(artifact)
  );
}

export function releaseHealthSnapshot(channels: readonly ProductizationChannel[]): ReleaseHealth {
  const drift = PRODUCTIZATION_ARTIFACTS.filter((artifact) => artifactIsDrift(artifact));
  const pending = PRODUCTIZATION_ARTIFACTS.filter((artifact) => artifact.status === "candidate");
  const stable = channels.find((channel) => channel.id === "stable-cloud");
  const stableArtifact = stable ? findArtifactByDigest(stable.currentDigest) : undefined;
  const writableChannels = channels.filter((channel) => channel.writable);
  const alignedChannelCount = writableChannels.filter((channel) =>
    channelPointsAtStableArtifact(channel),
  ).length;
  return {
    stableTrainSeq: stableArtifact ? formatTrainSeq(stableArtifact.trainSeq) : null,
    stableChannelName: stable?.name ?? null,
    drift,
    pending,
    writableChannels,
    alignedChannelCount,
  };
}
