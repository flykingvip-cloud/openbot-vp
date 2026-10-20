/**
 * P-00 release overview. Read-only health for the artifact train.
 * Catalog edits stay on pricing. This view does not sign or write digests.
 */

import { html } from "lit";
import { keyAccountHref } from "../key-accounts/routes.ts";
import { listSignedAppPreinstallPackages } from "../key-accounts/signed-app-catalog.ts";
import { listKeyAccountPartners } from "../key-accounts/state.ts";
import { platformPricingHref } from "../pricing/route.ts";
import { ledgerEmptyCopy } from "../shared/ledger-empty.ts";
import { followPortHref } from "../shared/surface.ts";
import {
  findArtifactByDigest,
  formatTrainSeq,
  shortDigest,
  type ProductizationChannel,
} from "./fixtures.ts";
import { readProductizationLedgerMode } from "./ledger-mode.ts";
import { PRODUCTIZATION_STRATEGIC_LINE, PRODUCTIZATION_STRATEGIC_REVISION } from "./p1-fixtures.ts";
import { releaseHealthSnapshot } from "./release-health.ts";
import {
  productizationArtifactHref,
  productizationHref,
  productizationReconcileHref,
} from "./routes.ts";

export function renderReleaseOverview(
  basePath: string,
  channels: readonly ProductizationChannel[],
) {
  const pricingHref = platformPricingHref(basePath);
  const empty = ledgerEmptyCopy(readProductizationLedgerMode(), 1, false);
  const health = releaseHealthSnapshot(channels);
  const packages = listSignedAppPreinstallPackages();
  return html`
    <p class="pz-banner" data-productization-strategic=${PRODUCTIZATION_STRATEGIC_REVISION}>
      ${PRODUCTIZATION_STRATEGIC_LINE}
    </p>
    <p class="pz-note" data-pz-module-subtitle="release-train">
      发布与制品 · 版本列车。这里看版本、通道和对账。套餐目录不在本模块编辑。
    </p>
    <p class="pz-actions">
      <a
        data-pz-catalog-link
        href=${pricingHref}
        @click=${(event: MouseEvent) => followPortHref(event, pricingHref)}
        >套餐与定价（授权目录）</a
      >
    </p>
    ${
      empty
        ? html`<p class="pz-note" data-empty-kind=${empty.kind}>${empty.title}。${empty.detail}</p>`
        : html`
            <section class="pz-panel" data-pz-release-health="ready">
              <h2>发布健康</h2>
              <dl class="pz-kv">
                <div>
                  <dt>稳定通道列车</dt>
                  <dd>${health.stableTrainSeq ?? "未指向"} · ${health.stableChannelName ?? "无稳定通道"}</dd>
                </div>
                <div>
                  <dt>通道对齐</dt>
                  <dd>${health.alignedChannelCount}/${health.writableChannels.length} 条云侧通道指向未漂移制品</dd>
                </div>
                <div>
                  <dt>漂移</dt>
                  <dd data-pz-drift-count=${health.drift.length}>${health.drift.length}</dd>
                </div>
                <div>
                  <dt>待晋升</dt>
                  <dd data-pz-pending-count=${health.pending.length}>${health.pending.length}</dd>
                </div>
              </dl>
            </section>
            <section class="pz-panel">
              <h2>发布待办</h2>
              <ul class="pz-diffs">
                ${health.pending.map((artifact) => {
                  const href = productizationArtifactHref(basePath, artifact.digest);
                  return html`<li>
                    <a href=${href} @click=${(event: MouseEvent) => followPortHref(event, href)}
                      >${formatTrainSeq(artifact.trainSeq)} 候选未晋升</a
                    >
                    · ${artifact.versionNarrative}
                  </li>`;
                })}
                ${health.drift.map((artifact) => {
                  const href = productizationReconcileHref(basePath, {
                    trainSeq: artifact.trainSeq,
                    digest: artifact.digest,
                  });
                  return html`<li>
                    <a href=${href} @click=${(event: MouseEvent) => followPortHref(event, href)}
                      >${formatTrainSeq(artifact.trainSeq)} 对账漂移</a
                    >
                    · ${shortDigest(artifact.digest)}
                  </li>`;
                })}
              </ul>
              <p class="pz-actions">
                <a
                  class="btn btn--sm"
                  href=${productizationHref(basePath, "channels")}
                  @click=${(event: MouseEvent) =>
                    followPortHref(event, productizationHref(basePath, "channels"))}
                  >去改通道</a
                >
                <a
                  class="btn btn--sm"
                  href=${productizationHref(basePath, "artifacts")}
                  @click=${(event: MouseEvent) =>
                    followPortHref(event, productizationHref(basePath, "artifacts"))}
                  >制品列车</a
                >
              </p>
              <p class="pz-note">改通道只接受已对账制品。本页不写入野版 digest。</p>
            </section>
            <section class="pz-panel" data-pz-install-impact="readonly">
              <h2>安装引用</h2>
              <p class="pz-note">已签名预装包引用的列车。只读，不写入 digest 台账。</p>
              <ul class="pz-diffs">
                ${packages.map((item) => {
                  const artifact = findArtifactByDigest(item.artifactDigest);
                  const train = artifact ? formatTrainSeq(artifact.trainSeq) : "未对应列车";
                  const owner = listKeyAccountPartners().find((partner) =>
                    partner.packageIds.includes(item.id),
                  );
                  const destination = keyAccountHref(basePath, "preinstall", owner?.code ?? null);
                  const href = artifact
                    ? `${destination}${destination.includes("?") ? "&" : "?"}train=${encodeURIComponent(artifact.trainSeq)}`
                    : destination;
                  return html`<li>
                    ${item.id} · ${train} · ${item.versionNarrative} ·
                    <a href=${href} @click=${(event: MouseEvent) => followPortHref(event, href)}
                      >预装关联</a
                    >
                  </li>`;
                })}
              </ul>
            </section>
          `
    }
  `;
}
