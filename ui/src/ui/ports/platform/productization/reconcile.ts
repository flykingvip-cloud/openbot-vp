/**
 * Read-only digest reconcile. Every result has `wrote: false`.
 * A digest that is not on the release-train ledger is rejected and never stored.
 */

import {
  findArtifactByDigest,
  findArtifactByImageRef,
  findArtifactByTrain,
  formatTrainSeq,
  normalizeTrainSeq,
  shortDigest,
  type ProductizationArtifact,
} from "./fixtures.ts";

export type ReconcileInput = {
  trainSeq?: string;
  digest?: string;
  imageRef?: string;
};

export type ReconcileCardStatus = "aligned" | "drift" | "rejected";

export type ReconcileCard = {
  id: "provenance" | "image" | "releases";
  title: string;
  status: ReconcileCardStatus;
  value: string;
  detail: string;
};

export type ReconcileCode =
  | "aligned"
  | "drift"
  | "wild-digest"
  | "unknown-train"
  | "unknown-image"
  | "empty"
  | "cross-artifact";

export type ReconcileResult = {
  outcome: "aligned" | "drift" | "rejected";
  code: ReconcileCode;
  summary: string;
  diffs: string[];
  cards: ReconcileCard[];
  /** Productization reconcile never writes the ledger or a channel. */
  wrote: false;
};

const CARD_TITLES = {
  provenance: "provenance SHA",
  image: "镜像 digest",
  releases: "releases 条目",
} as const;

function card(
  id: ReconcileCard["id"],
  status: ReconcileCardStatus,
  value: string,
  detail: string,
): ReconcileCard {
  return { id, title: CARD_TITLES[id], status, value, detail };
}

function rejected(
  code: Exclude<ReconcileCode, "aligned" | "drift" | "cross-artifact">,
  summary: string,
  diffs: string[] = [],
): ReconcileResult {
  return {
    outcome: "rejected",
    code,
    summary,
    diffs,
    wrote: false,
    cards: [
      card("provenance", "rejected", "—", "未纳入台账，不做对账。"),
      card("image", "rejected", "—", "未纳入台账，不做对账。"),
      card("releases", "rejected", "—", "未纳入台账，不做对账。"),
    ],
  };
}

function statusWord(status: ReconcileCardStatus): string {
  switch (status) {
    case "aligned":
      return "一致";
    case "drift":
      return "漂移";
    case "rejected":
      return "拒绝";
  }
}

export function evaluateArtifact(
  artifact: ProductizationArtifact,
  input?: { imageRef?: string },
): ReconcileResult {
  const diffs: string[] = [];
  let imageStatus: ReconcileCardStatus = "aligned";
  let imageValue = artifact.imageDigest;
  let imageDetail = "镜像 digest 与列车记录一致。";
  const requestedImage = input?.imageRef?.trim() ?? "";
  if (requestedImage && requestedImage !== artifact.imageRef) {
    imageStatus = "drift";
    imageValue = requestedImage;
    imageDetail = "输入的镜像引用不属于这条列车记录。";
    diffs.push(`镜像引用：输入 ${requestedImage}，台账 ${artifact.imageRef}`);
  } else if (artifact.imageDigest !== artifact.digest) {
    imageStatus = "drift";
    imageValue = artifact.imageDigest;
    imageDetail = "镜像 digest 与关联制品 digest 不一致。";
    diffs.push(
      `关联 digest：制品 ${shortDigest(artifact.digest)}，镜像 ${shortDigest(artifact.imageDigest)}`,
    );
  } else if (artifact.observedImageDigest !== artifact.imageDigest) {
    imageStatus = "drift";
    imageValue = artifact.observedImageDigest;
    imageDetail = "观测到的镜像 digest 与列车记录不一致。";
    diffs.push(
      `镜像 digest：记录 ${shortDigest(artifact.imageDigest)}，观测 ${shortDigest(artifact.observedImageDigest)}`,
    );
  }

  let releasesStatus: ReconcileCardStatus = "aligned";
  let releasesDetail = "releases 条目与制品 digest 一致，且 LIVE 唯一。";
  if (artifact.releasesDigest !== artifact.digest) {
    releasesStatus = "drift";
    releasesDetail = "releases 条目 digest 与制品 digest 不一致。";
    diffs.push(
      `releases digest：条目 ${shortDigest(artifact.releasesDigest)}，制品 ${shortDigest(artifact.digest)}`,
    );
  }
  if (!artifact.releasesLiveUnique) {
    releasesStatus = "drift";
    releasesDetail = "releases 条目不是唯一 LIVE。";
    diffs.push(`列车 ${formatTrainSeq(artifact.trainSeq)} 的 LIVE 不唯一`);
  }

  const outcome = imageStatus === "drift" || releasesStatus === "drift" ? "drift" : "aligned";
  return {
    outcome,
    code: outcome,
    summary:
      outcome === "aligned"
        ? "三元对齐：provenance SHA、镜像 digest、releases 条目一致，且 LIVE 唯一。"
        : "对账漂移。未写入。请 SaaS 产品化负责人处理。",
    diffs,
    wrote: false,
    cards: [
      card(
        "provenance",
        "aligned",
        artifact.provenanceSha,
        "provenance SHA 来自列车台账，不可手改。",
      ),
      card("image", imageStatus, imageValue, imageDetail),
      card(
        "releases",
        releasesStatus,
        artifact.releasesLiveUnique ? "LIVE 唯一" : "LIVE 不唯一",
        releasesDetail,
      ),
    ],
  };
}

export function isReconciledChannelTarget(artifact: ProductizationArtifact): boolean {
  return (
    artifact.signature === "verified" &&
    artifact.status !== "retired" &&
    evaluateArtifact(artifact).outcome === "aligned"
  );
}

export function listReconciledChannelTargets(
  artifacts: readonly ProductizationArtifact[],
): ProductizationArtifact[] {
  return artifacts.filter((artifact) => isReconciledChannelTarget(artifact));
}

export function reconcileQuery(input: ReconcileInput): ReconcileResult {
  const trainSeq = normalizeTrainSeq(input.trainSeq ?? "");
  const digest = input.digest?.trim() ?? "";
  const imageRef = input.imageRef?.trim() ?? "";
  if (!trainSeq && !digest && !imageRef) {
    return rejected("empty", "请输入列车序号、digest 或镜像引用后再对账。");
  }

  if (digest && !findArtifactByDigest(digest)) {
    return rejected("wild-digest", "拒绝野版 digest：不在发布列车台账中，未写入任何制品或通道。", [
      `digest ${digest} 不在列车台账`,
    ]);
  }

  const byTrain = trainSeq ? findArtifactByTrain(trainSeq) : undefined;
  if (trainSeq && !byTrain) {
    return rejected("unknown-train", "列车序号不在台账中。拒绝当作野版录入，未写入。", [
      `列车 ${formatTrainSeq(trainSeq)} 不存在`,
    ]);
  }

  const byDigest = digest ? findArtifactByDigest(digest) : undefined;
  const byImage = imageRef ? findArtifactByImageRef(imageRef) : undefined;
  if (imageRef && !byImage && !byTrain && !byDigest) {
    return rejected("unknown-image", "镜像引用不在发布列车台账中。拒绝野版，未写入。", [
      `镜像引用 ${imageRef} 不在列车台账`,
    ]);
  }

  const owners = [...new Set([byTrain, byDigest, byImage].filter((item) => item != null))];
  if (owners.length > 1) {
    return {
      outcome: "drift",
      code: "cross-artifact",
      summary: "列车序号、digest 与镜像引用没有指向同一制品。未写入。",
      diffs: owners.map(
        (artifact) => `${formatTrainSeq(artifact.trainSeq)} · ${shortDigest(artifact.digest)}`,
      ),
      wrote: false,
      cards: [
        card("provenance", "drift", "不一致", "输入落在不同制品上。"),
        card("image", "drift", "不一致", "输入落在不同制品上。"),
        card("releases", "drift", "不一致", "输入落在不同制品上。"),
      ],
    };
  }

  const artifact = owners[0];
  if (!artifact) {
    return rejected("unknown-train", "没有可对账的列车条目。未写入。");
  }
  return evaluateArtifact(artifact, { imageRef: imageRef || undefined });
}

export function formatReconcileReport(result: ReconcileResult): string {
  const lines = [
    "OpenBot 产品化 digest 对账报告（演示夹具）",
    `结果: ${result.outcome}`,
    `代码: ${result.code}`,
    result.summary,
    "未写入库。",
    "",
    ...result.cards.map(
      (item) => `${item.title}: ${statusWord(item.status)} · ${item.value} · ${item.detail}`,
    ),
  ];
  if (result.diffs.length > 0) {
    lines.push("", "差分:");
    for (const diff of result.diffs) {
      lines.push(`- ${diff}`);
    }
  }
  return lines.join("\n");
}

export function readReconcileQuery(search: string): ReconcileInput {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    trainSeq: params.get("train") ?? "",
    digest: params.get("digest") ?? "",
    imageRef: params.get("image") ?? "",
  };
}
