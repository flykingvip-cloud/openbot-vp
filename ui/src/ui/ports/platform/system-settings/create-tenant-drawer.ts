/**
 * Platform Create-Tenant Drawer
 *
 * 兼容旧版平台「创建租户」入口。
 *
 * 入口约定：
 *   - 新的平台端创建租户入口直达 `/platform/tenants#create-formal-advanced`。
 *   - 旧链接 `/platform/tenants#open-create-tenant` 自动重写到完整创建页。
 *   - 直接调用方仍可使用 `openPlatformCreateTenantDrawer()` / `closePlatformCreateTenantDrawer()`
 *     打开兼容 Drawer，但新平台入口不再使用它。
 *
 * 渲染：`renderPlatformCreateTenantDrawer(props)` 应该被挂到 platform shell 顶层，
 * 这样无论用户在哪个 tab 都能打开。
 */

import { html, nothing } from "lit";
import { pathForTab } from "../../../navigation.ts";
import { pushAppHistoryState, replaceAppHistoryState } from "../../../request-app-rerender.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { requestPlatformSurfaceRerender } from "../shared/surface.ts";
import {
  renderPlatformCreateTenantWorkspace,
  resolvePlatformCreateTenantInviteCode,
} from "./page.ts";

export const PLATFORM_CREATE_TENANT_HASH_TOKEN = "#open-create-tenant";
const PLATFORM_TENANT_FULL_CREATE_HASH = "#create-formal-advanced";

let createTenantDrawerOpen = false;
// Tracks whether the next render is a fresh open (so we can clear stale invite
// codes from the previous run before the workspace re-renders the result block).
let pendingFreshOpen = false;

function requestPlatformRerender() {
  requestPlatformSurfaceRerender();
}

/**
 * 旧版 hash 曾经打开 quick-trial Drawer。现在平台端创建租户必须直达完整创建页，
 * 因此把历史链接自动迁移到新的正式入口。
 */
function syncCreateTenantDrawerFromHash() {
  if (typeof window === "undefined") {
    return;
  }
  if (window.location.hash !== PLATFORM_CREATE_TENANT_HASH_TOKEN) {
    return;
  }
  const { pathname, search } = window.location;
  replaceAppHistoryState(`${pathname}${search}${PLATFORM_TENANT_FULL_CREATE_HASH}`);
  createTenantDrawerOpen = false;
  pendingFreshOpen = false;
}

export function openPlatformCreateTenantDrawer() {
  if (!createTenantDrawerOpen) {
    pendingFreshOpen = true;
  }
  createTenantDrawerOpen = true;
  requestPlatformRerender();
}

export function closePlatformCreateTenantDrawer() {
  createTenantDrawerOpen = false;
  pendingFreshOpen = false;
  requestPlatformRerender();
}

export function isPlatformCreateTenantDrawerOpen() {
  return createTenantDrawerOpen;
}

export function renderPlatformCreateTenantDrawer(props: PlatformSurfaceProps) {
  syncCreateTenantDrawerFromHash();
  if (!createTenantDrawerOpen) {
    return nothing;
  }
  // Fresh open → clear residue from previous run so the success block (Tenant
  // ID / 激活码 / 链接) doesn't reappear before the user submits anything.
  if (pendingFreshOpen) {
    pendingFreshOpen = false;
    props.authPanelProps?.onInviteCodeChange?.("");
  }
  const fullCreateHref = `${pathForTab("platformTenants", props.basePath)}${PLATFORM_TENANT_FULL_CREATE_HASH}`;
  const createSuccess = Boolean(resolvePlatformCreateTenantInviteCode(props.authPanelProps));
  return html`
    <div
      class="model-assets-drawer-overlay platform-create-tenant-drawer-overlay ${
        createSuccess ? "platform-create-tenant-drawer-overlay--success" : ""
      }"
      role="dialog"
      aria-modal="true"
      aria-label="创建租户"
      @click=${() => closePlatformCreateTenantDrawer()}
    >
      <aside
        class="model-assets-drawer platform-create-tenant-drawer ${
          createSuccess ? "platform-create-tenant-drawer--success" : ""
        }"
        @click=${(event: Event) => event.stopPropagation()}
      >
        ${
          createSuccess
            ? nothing
            : html`
                <div class="model-assets-drawer__header">
                  <div class="model-assets-drawer__title">创建租户</div>
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${() => closePlatformCreateTenantDrawer()}
                  >
                    关闭
                  </button>
                </div>
              `
        }
        <div class="model-assets-drawer__body">
          ${renderPlatformCreateTenantWorkspace(props, { quickOnly: true })}
          ${
            createSuccess
              ? nothing
              : html`
                  <div class="platform-create-tenant-drawer__advanced-link">
                    需要正式企业或高级创建？
                    <a
                      href=${fullCreateHref}
                      @click=${(event: MouseEvent) => {
                        event.preventDefault();
                        if (typeof window === "undefined") {
                          return;
                        }
                        closePlatformCreateTenantDrawer();
                        pushAppHistoryState(fullCreateHref);
                      }}
                    >
                      打开完整创建页 →
                    </a>
                  </div>
                `
          }
        </div>
      </aside>
    </div>
  `;
}
