import { html, nothing, type TemplateResult } from "lit";

export type OwnedAssetLinkView = {
  sourceId: string;
  displayName: string;
  capabilityId: string;
  version?: string;
};

export function renderOwnedDataAssetLinks(params: {
  links: OwnedAssetLinkView[] | null;
  loading: boolean;
  hrefForSource: (sourceId: string) => string;
}): TemplateResult | typeof nothing {
  if (params.loading) {
    return html`
      <div class="enterprise-data-capability__hint">正在核对数据资产归属…</div>
    `;
  }
  if (!params.links || params.links.length === 0) {
    return nothing;
  }
  return html`
    <section class="enterprise-capability-center-page__asset-links" aria-label="关联数据资产">
      <strong>关联数据资产</strong>
      <ul>
        ${params.links.map(
          (link) => html`
            <li>
              <a href=${params.hrefForSource(link.sourceId)}>${link.displayName}</a>
              <span class="muted">
                ${link.capabilityId}${link.version ? `@${link.version}` : ""}
              </span>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}
