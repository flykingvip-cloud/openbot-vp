import { html } from "lit";
import {
  KEY_ACCOUNT_PREINSTALL_LINE,
  KEY_ACCOUNT_SHIPMENT_BATCHES,
  findSignedPackage,
} from "./fixtures.ts";
import { keyAccountRouteAnchor } from "./render-shared.ts";
import { keyAccountHref } from "./routes.ts";
import { findKeyAccountPartner, listKeyAccountPartners } from "./state.ts";

export function renderShipmentBatches(basePath: string, partnerCode: string | null) {
  const requested = partnerCode ? findKeyAccountPartner(partnerCode) : null;
  const rows = KEY_ACCOUNT_SHIPMENT_BATCHES.filter((batch) =>
    requested ? batch.partnerCode === requested.code : true,
  );
  return html`
    <section data-ka-readonly="shipments">
      <p class="ka-banner">
        渠道出货批次与预装包版本对照。只读。没有设备清单，也不改预装关联。${KEY_ACCOUNT_PREINSTALL_LINE}
      </p>
      ${
        requested
          ? html`<p class="ka-note">当前伙伴：${requested.displayName}（${requested.code}）</p>`
          : html`
              <p class="ka-note">全部伙伴的出货批次。</p>
            `
      }
      <table class="platform-tenants__table">
        <thead>
          <tr>
            <th>批次</th>
            <th>伙伴</th>
            <th>预装包</th>
            <th>版本叙事</th>
            <th>白牌版本</th>
            <th>出货日期</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? html`
                  <tr>
                    <td colspan="7">还没有出货批次。</td>
                  </tr>
                `
              : rows.map((batch) => {
                  const partner = findKeyAccountPartner(batch.partnerCode);
                  const signed = findSignedPackage(batch.packageId);
                  return html`
                    <tr data-ka-shipment=${batch.id}>
                      <td>${batch.id}</td>
                      <td>
                        ${
                          partner
                            ? keyAccountRouteAnchor(
                                keyAccountHref(basePath, "detail", partner.code),
                                `${partner.displayName}（${partner.code}）`,
                                "ka-text-link",
                              )
                            : batch.partnerCode
                        }
                      </td>
                      <td>${batch.packageId}</td>
                      <td>${signed?.versionNarrative ?? "—"}</td>
                      <td>${batch.whiteLabelVersion}</td>
                      <td>${batch.shippedAt}</td>
                      <td>${batch.summary}</td>
                    </tr>
                  `;
                })
          }
        </tbody>
      </table>
      <div class="ka-actions">
        ${listKeyAccountPartners().map((partner) =>
          keyAccountRouteAnchor(
            keyAccountHref(basePath, "shipments", partner.code),
            partner.displayName,
          ),
        )}
        ${keyAccountRouteAnchor(keyAccountHref(basePath, "shipments"), "全部批次")}
      </div>
    </section>
  `;
}
