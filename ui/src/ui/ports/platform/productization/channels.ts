/**
 * In-memory cloud-channel edits for the P0 demo.
 * Fleet channels stay read-only. Digests outside the reconciled ledger are rejected
 * and do not change state.
 */

import {
  DEMO_CHANNEL_SAVE_STAMP,
  PRODUCTIZATION_ARTIFACTS,
  PRODUCTIZATION_CHANNELS,
  findArtifactByDigest,
  shortDigest,
  type ChannelKind,
  type ProductizationChannel,
} from "./fixtures.ts";
import { isReconciledChannelTarget, listReconciledChannelTargets } from "./reconcile.ts";

export type ProductizationDemoState = {
  channels: ProductizationChannel[];
};

export type ChannelSaveInput = {
  channelId: string | null;
  name: string;
  description: string;
  kind: ChannelKind;
  digest: string;
  confirmed: boolean;
  idFactory?: () => string;
};

export type ChannelSaveCode =
  | "wild-digest"
  | "unreconciled"
  | "fleet-readonly"
  | "fleet-create-forbidden"
  | "confirm-required"
  | "invalid-name"
  | "missing-channel";

export type ChannelSaveResult =
  | { ok: true; channelId: string }
  | { ok: false; code: ChannelSaveCode; message: string };

export function createProductizationDemoState(): ProductizationDemoState {
  return {
    channels: PRODUCTIZATION_CHANNELS.map((channel) => ({ ...channel })),
  };
}

export function reconciledChannelTargets() {
  return listReconciledChannelTargets(PRODUCTIZATION_ARTIFACTS);
}

export function saveChannelPointer(
  state: ProductizationDemoState,
  input: ChannelSaveInput,
): { state: ProductizationDemoState; result: ChannelSaveResult } {
  const fail = (code: ChannelSaveCode, message: string) => ({
    state,
    result: { ok: false as const, code, message },
  });

  if (input.kind !== "cloud-release" && input.kind !== "joint-review") {
    return fail(
      "fleet-create-forbidden",
      "Fleet 镜像不能在平台端新建或改指向。它不是 OEM 出货通道。",
    );
  }

  const existing = input.channelId
    ? state.channels.find((channel) => channel.id === input.channelId)
    : undefined;
  if (input.channelId && !existing) {
    return fail("missing-channel", "通道不存在。平台端不能凭空登记列车外通道。");
  }
  if (existing && (!existing.writable || existing.kind === "fleet-mirror")) {
    return fail(
      "fleet-readonly",
      "Fleet 镜像只读。license-cloud 不是近端必经控制面，本页不改指向。",
    );
  }

  const name = input.name.trim();
  if (!name) {
    return fail("invalid-name", "请填写通道名。");
  }

  const artifact = findArtifactByDigest(input.digest);
  if (!artifact) {
    return fail("wild-digest", "拒绝野版 digest：不在发布列车台账中，未写入通道。");
  }
  if (!isReconciledChannelTarget(artifact)) {
    return fail("unreconciled", "只能指向已对账、已验签且未废弃的制品。");
  }
  if (!input.confirmed) {
    return fail(
      "confirm-required",
      `保存须二次确认：通道将指向已对账制品 ${shortDigest(artifact.digest)}。`,
    );
  }

  const next: ProductizationChannel = {
    id: existing?.id ?? input.idFactory?.() ?? `cloud-demo-${state.channels.length + 1}`,
    name,
    description: input.description.trim(),
    kind: input.kind,
    currentDigest: artifact.digest,
    updatedAt: DEMO_CHANNEL_SAVE_STAMP,
    writable: true,
  };
  const channels = existing
    ? state.channels.map((channel) => (channel.id === existing.id ? next : channel))
    : [...state.channels, next];
  return { state: { channels }, result: { ok: true, channelId: next.id } };
}
