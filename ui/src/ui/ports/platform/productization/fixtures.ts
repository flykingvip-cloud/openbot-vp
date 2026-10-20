/**
 * Demo fixtures for the platform productization console (P-01..P-04).
 * These are not production signatures, not CI image digests, and not a write API.
 * Digests are ledger keys only — there is no signing key material here.
 */

export type KernelSurface = "full";

export type ArtifactStatus = "candidate" | "promoted" | "retired";

export type SignatureStatus = "verified" | "unsigned" | "mismatch";

export type ProductizationArtifact = {
  digest: string;
  versionNarrative: string;
  surfaces: readonly KernelSurface[];
  signature: SignatureStatus;
  trainSeq: string;
  promotedAt: string | null;
  status: ArtifactStatus;
  provenanceSha: string;
  imageRef: string;
  imageDigest: string;
  observedImageDigest: string;
  releasesDigest: string;
  releasesLiveUnique: boolean;
  channelIds: readonly string[];
  timeline: readonly { at: string; label: string }[];
  surfaceProof: string;
};

export type ChannelKind = "cloud-release" | "joint-review" | "fleet-mirror";

export type ProductizationChannel = {
  id: string;
  name: string;
  description: string;
  kind: ChannelKind;
  currentDigest: string;
  updatedAt: string;
  /** Fleet mirrors stay read-only. They are not an OEM ship channel. */
  writable: boolean;
};

export const PRODUCTIZATION_DEMO_NOTICE =
  "演示夹具。不是生产签名材料，也不是 SaaS 发布列车的真实镜像 digest。只展示发布列车台账内的条目，不提供野版录入。";

const sha40 = (seed: string) =>
  seed
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .padEnd(40, "0")
    .slice(0, 40);

const digestFor = (seed: string) => `sha256:${sha40(seed).padEnd(64, "0").slice(0, 64)}`;

const aligned112 = digestFor("a11ce112");
const aligned109 = digestFor("a11ce109");
const drift108 = digestFor("a11ce108");
const retired101 = digestFor("a11ce101");
const drift108Release = digestFor("a11ce108rel");

function freezeArtifact(artifact: ProductizationArtifact): ProductizationArtifact {
  return Object.freeze({
    ...artifact,
    surfaces: Object.freeze([...artifact.surfaces]),
    channelIds: Object.freeze([...artifact.channelIds]),
    timeline: Object.freeze(artifact.timeline.map((entry) => Object.freeze({ ...entry }))),
  });
}

export const PRODUCTIZATION_ARTIFACTS: readonly ProductizationArtifact[] = Object.freeze([
  freezeArtifact({
    digest: aligned112,
    versionNarrative: "2026.10.x",
    surfaces: ["full"],
    signature: "verified",
    trainSeq: "112",
    promotedAt: "2026-10-09 14:20",
    status: "promoted",
    provenanceSha: sha40("prov112"),
    imageRef: "registry.example.invalid/openbot/kernel:train-112",
    imageDigest: digestFor("image112"),
    observedImageDigest: digestFor("image112"),
    releasesDigest: aligned112,
    releasesLiveUnique: true,
    channelIds: ["stable-cloud", "fleet-hw-stable"],
    timeline: [
      { at: "2026-10-08 09:00", label: "进入候选" },
      { at: "2026-10-09 14:20", label: "晋升到云发布通道 stable-cloud" },
    ],
    surfaceProof: "full：SaaS 主路径基线对齐。",
  }),
  freezeArtifact({
    digest: aligned109,
    versionNarrative: "2026.10.x-rc.1",
    surfaces: ["full"],
    signature: "verified",
    trainSeq: "109",
    promotedAt: null,
    status: "candidate",
    provenanceSha: sha40("prov109"),
    imageRef: "registry.example.invalid/openbot/kernel:train-109",
    imageDigest: digestFor("image109"),
    observedImageDigest: digestFor("image109"),
    releasesDigest: aligned109,
    releasesLiveUnique: true,
    channelIds: ["candidate-cloud", "joint-review-oct"],
    timeline: [{ at: "2026-10-07 11:10", label: "进入候选，尚未晋升" }],
    surfaceProof: "full：SaaS 主路径基线对齐。",
  }),
  freezeArtifact({
    digest: drift108,
    versionNarrative: "2026.10.x-drift",
    surfaces: ["full"],
    signature: "verified",
    trainSeq: "108",
    promotedAt: "2026-10-06 18:05",
    status: "promoted",
    provenanceSha: sha40("prov108"),
    imageRef: "registry.example.invalid/openbot/kernel:train-108",
    imageDigest: digestFor("image108"),
    observedImageDigest: digestFor("image108obs"),
    releasesDigest: drift108Release,
    releasesLiveUnique: false,
    channelIds: [],
    timeline: [
      { at: "2026-10-06 18:05", label: "晋升后镜像 digest 与 releases 条目漂移" },
      { at: "2026-10-06 18:40", label: "只读告警，未改通道指向" },
    ],
    surfaceProof: "full：镜像 digest 与列车条目漂移（只读）。这条漂移不改变 SaaS 主路径。",
  }),
  freezeArtifact({
    digest: retired101,
    versionNarrative: "2026.9.x",
    surfaces: ["full"],
    signature: "verified",
    trainSeq: "101",
    promotedAt: "2026-09-18 10:00",
    status: "retired",
    provenanceSha: sha40("prov101"),
    imageRef: "registry.example.invalid/openbot/kernel:train-101",
    imageDigest: digestFor("image101"),
    observedImageDigest: digestFor("image101"),
    releasesDigest: retired101,
    releasesLiveUnique: true,
    channelIds: [],
    timeline: [
      { at: "2026-09-18 10:00", label: "晋升" },
      { at: "2026-10-01 09:30", label: "废弃，不再作为通道指向" },
    ],
    surfaceProof: "full：历史基线。废弃条目只读，不能再被通道选中。",
  }),
]);

export const PRODUCTIZATION_CHANNELS: readonly ProductizationChannel[] = Object.freeze([
  Object.freeze({
    id: "stable-cloud",
    name: "云发布稳定",
    description: "SaaS 云侧稳定通道。指向必须是已对账制品。",
    kind: "cloud-release",
    currentDigest: aligned112,
    updatedAt: "2026-10-09 14:22",
    writable: true,
  }),
  Object.freeze({
    id: "candidate-cloud",
    name: "云发布候选",
    description: "云侧候选通道，只接受列车内已对账制品。",
    kind: "cloud-release",
    currentDigest: aligned109,
    updatedAt: "2026-10-07 11:12",
    writable: true,
  }),
  Object.freeze({
    id: "joint-review-oct",
    name: "十月联审",
    description: "产品化与 SaaS 联审通道。Fleet 镜像不在这里改指向。",
    kind: "joint-review",
    currentDigest: aligned109,
    updatedAt: "2026-10-07 16:40",
    writable: true,
  }),
  Object.freeze({
    id: "fleet-hw-stable",
    name: "Fleet 镜像（非主路径）",
    description: "只读镜像。不是 OEM 出货通道。license-cloud 不是近端必经控制面。",
    kind: "fleet-mirror",
    currentDigest: aligned112,
    updatedAt: "2026-10-09 14:22",
    writable: false,
  }),
]);

export const DEMO_CHANNEL_SAVE_STAMP = "2026-10-09 16:40";

export function digestHex(digest: string): string {
  const trimmed = digest.trim();
  return (trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed).toLowerCase();
}

export function shortDigest(digest: string): string {
  return `${digestHex(digest).slice(0, 12)}…`;
}

export function formatTrainSeq(trainSeq: string): string {
  return `seq-${trainSeq}`;
}

export function normalizeTrainSeq(raw: string): string {
  return raw.trim().replace(/^seq-/i, "");
}

export function findArtifactByDigest(ref: string): ProductizationArtifact | undefined {
  const hex = digestHex(ref);
  if (!hex) {
    return undefined;
  }
  return PRODUCTIZATION_ARTIFACTS.find((artifact) => digestHex(artifact.digest) === hex);
}

export function findArtifactByTrain(trainSeq: string): ProductizationArtifact | undefined {
  const normalized = normalizeTrainSeq(trainSeq);
  if (!normalized) {
    return undefined;
  }
  return PRODUCTIZATION_ARTIFACTS.find((artifact) => artifact.trainSeq === normalized);
}

export function findArtifactByImageRef(imageRef: string): ProductizationArtifact | undefined {
  const normalized = imageRef.trim();
  if (!normalized) {
    return undefined;
  }
  return PRODUCTIZATION_ARTIFACTS.find((artifact) => artifact.imageRef === normalized);
}

export function channelKindLabel(kind: ChannelKind): string {
  switch (kind) {
    case "cloud-release":
      return "云发布";
    case "joint-review":
      return "联审";
    case "fleet-mirror":
      return "Fleet 镜像（非主路径）";
  }
}

export function artifactStatusLabel(status: ArtifactStatus): string {
  switch (status) {
    case "candidate":
      return "候选";
    case "promoted":
      return "正式";
    case "retired":
      return "废弃";
  }
}

export function signatureLabel(status: SignatureStatus): string {
  switch (status) {
    case "verified":
      return "已验签";
    case "unsigned":
      return "未签名";
    case "mismatch":
      return "不一致";
  }
}

export function surfaceOptionLabel(surface: KernelSurface): string {
  return `${surface}（SaaS 主路径）`;
}

export function surfaceLabel(surfaces: readonly KernelSurface[]): string {
  return surfaces.map((surface) => surfaceOptionLabel(surface)).join(" + ");
}

export type ArtifactSurfaceFilter = "all" | KernelSurface;
export type ArtifactStatusFilter = "all" | ArtifactStatus;

export function filterArtifacts(
  artifacts: readonly ProductizationArtifact[],
  query: { surface: ArtifactSurfaceFilter; status: ArtifactStatusFilter; keyword: string },
): ProductizationArtifact[] {
  const keyword = query.keyword.trim().toLowerCase();
  return artifacts.filter((artifact) => {
    if (query.surface !== "all" && !artifact.surfaces.includes(query.surface)) {
      return false;
    }
    if (query.status !== "all" && artifact.status !== query.status) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const haystack = [
      artifact.digest,
      artifact.versionNarrative,
      artifact.trainSeq,
      formatTrainSeq(artifact.trainSeq),
      surfaceLabel(artifact.surfaces),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
}
