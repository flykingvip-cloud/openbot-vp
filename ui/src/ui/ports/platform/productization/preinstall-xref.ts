/**
 * Read-only "who installed this train" block on an artifact detail page.
 */

import { html } from "lit";
import { keyAccountHref } from "../key-accounts/routes.ts";
import { listSignedAppPreinstallPackages } from "../key-accounts/signed-app-catalog.ts";
import { listKeyAccountPartners } from "../key-accounts/state.ts";
import { followPortHref } from "../shared/surface.ts";
import { formatTrainSeq, type ProductizationArtifact } from "./fixtures.ts";

export function renderArtifactInstallRefs(basePath: string, artifact: ProductizationArtifact) {
  const packages = listSignedAppPreinstallPackages().filter(
    (item) => item.artifactDigest === artifact.digest,
  );
  return html`
    <section class="pz-panel" data-pz-install-xref="readonly">
      <h2>关联的预装（只读）</h2>
      <p class="pz-note">
        这些预装包指向列车 ${formatTrainSeq(artifact.trainSeq)}。交叉引用不写入 digest 台账。预装不等于可用权益。
      </p>
      ${
        packages.length === 0
          ? html`
              <p class="pz-note">还没有预装包引用这条列车。</p>
            `
          : html`<ul class="pz-diffs">
              ${packages.map((item) => {
                const partners = listKeyAccountPartners().filter((partner) =>
                  partner.packageIds.includes(item.id),
                );
                const href = keyAccountHref(basePath, "preinstall", partners[0]?.code ?? null);
                const who =
                  partners.length === 0
                    ? "尚未绑定客户"
                    : partners.map((partner) => partner.displayName).join("、");
                return html`<li>
                  ${item.id} · ${item.versionNarrative} · 已验签 · ${who} ·
                  <a href=${href} @click=${(event: MouseEvent) => followPortHref(event, href)}
                    >打开预装关联</a
                  >
                </li>`;
              })}
            </ul>`
      }
    </section>
  `;
}
