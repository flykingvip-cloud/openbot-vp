/**
 * 权限与治理 → 记忆范围面板。
 */

import { html, type TemplateResult } from "lit";

export type MemoryScopeRow = {
  displayName: string;
  scopePolicyId: string;
  scopeType: string;
};

export type MemoryScopePanelProps = {
  scopes: MemoryScopeRow[];
  loading: boolean;
  loaded: boolean;
};

export function renderMemoryScopePanel(props: MemoryScopePanelProps): TemplateResult {
  if (props.loading && !props.loaded) {
    return html`
      <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
        <div class="enterprise-data-capability__hint" aria-busy="true">记忆范围加载中…</div>
      </section>
    `;
  }
  if (props.scopes.length === 0) {
    return html`
      <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
        <div class="edc-empty">
          <strong>暂无记忆范围策略</strong>
          <p class="muted">可在授权策略中绑定记忆范围。</p>
        </div>
      </section>
    `;
  }
  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      <table class="edc-console-table edc-console-table--lean">
        <thead>
          <tr>
            <th>名称</th>
            <th>标识</th>
            <th>范围类型</th>
          </tr>
        </thead>
        <tbody>
          ${props.scopes.map(
            (scope) => html`
              <tr>
                <td>${scope.displayName}</td>
                <td><code>${scope.scopePolicyId}</code></td>
                <td>${scope.scopeType}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </section>
  `;
}
