import { LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { whenGatewayReady } from "../../../supervisor/supervisor-gateway-utils.ts";
import {
  renderEnterpriseMemoryGovernancePanel,
  type EnterpriseMemoryGovernancePanelState,
} from "./enterprise-memory-governance-surface.ts";
import { renderEnterpriseRetentionPolicyPanel } from "./enterprise-retention-policy-surface.ts";

type OverviewResponse = {
  overview?: {
    privacyNote?: string;
    seats?: Array<{
      seatId: string;
      title: string;
      scopes: Array<{ scopeId: string; transferClass: "inheritable" | "review_required" }>;
    }>;
  };
};

@customElement("enterprise-memory-governance-card")
export class EnterpriseMemoryGovernanceCard extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";

  @state() private panel: EnterpriseMemoryGovernancePanelState = { loading: true };

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client") || changed.has("tenantId")) {
      void this.refresh();
    }
  }

  private async refresh() {
    if (!this.client || !this.tenantId.trim()) {
      this.panel = { loading: false, seats: [] };
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.panel = { loading: true, error: null };
    try {
      const result = await this.client.request<OverviewResponse>(
        "enterprise-memory.governance.overview",
        { tenantId: this.tenantId.trim() },
      );
      this.panel = {
        loading: false,
        privacyNote: result.overview?.privacyNote ?? null,
        seats: result.overview?.seats ?? [],
      };
    } catch (err) {
      this.panel = {
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        seats: [],
      };
    }
  }

  render() {
    if (!this.client || !this.tenantId.trim()) {
      return nothing;
    }
    return renderEnterpriseMemoryGovernancePanel(this.panel);
  }
}

@customElement("enterprise-retention-policy-card")
export class EnterpriseRetentionPolicyCard extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";

  @state() private loading = true;
  @state() private saving = false;
  @state() private error: string | null = null;
  @state() private message: string | null = null;
  @state() private activeDays = 30;
  @state() private archiveDays = 180;
  @state() private deleteAfterDays = 365;
  @state() private complianceProfile: "standard" | "financial" | "custom" = "standard";

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client") || changed.has("tenantId")) {
      void this.refresh();
    }
  }

  private async refresh() {
    if (!this.client || !this.tenantId.trim()) {
      this.loading = false;
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const result = await this.client.request<{
        resolved?: {
          activeDays?: number;
          archiveDays?: number;
          deleteAfterDays?: number;
          complianceProfile?: "standard" | "financial" | "custom";
        };
      }>("enterprise-memory.governance.retention.get", {
        tenantId: this.tenantId.trim(),
      });
      this.activeDays = result.resolved?.activeDays ?? 30;
      this.archiveDays = result.resolved?.archiveDays ?? 180;
      this.deleteAfterDays = result.resolved?.deleteAfterDays ?? 365;
      this.complianceProfile = result.resolved?.complianceProfile ?? "standard";
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async save() {
    if (!this.client || !this.tenantId.trim()) {
      return;
    }
    this.saving = true;
    this.message = null;
    this.error = null;
    try {
      await this.client.request("enterprise-memory.governance.retention.update", {
        tenantId: this.tenantId.trim(),
        complianceProfile: this.complianceProfile,
        conversation: {
          activeDays: this.activeDays,
          archiveDays: this.archiveDays,
          deleteAfterDays: this.deleteAfterDays,
        },
      });
      this.message = "保留策略已保存。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  render() {
    if (!this.client || !this.tenantId.trim()) {
      return nothing;
    }
    return renderEnterpriseRetentionPolicyPanel({
      loading: this.loading,
      error: this.error,
      message: this.message,
      activeDays: this.activeDays,
      archiveDays: this.archiveDays,
      deleteAfterDays: this.deleteAfterDays,
      complianceProfile: this.complianceProfile,
      saving: this.saving,
      onActiveDaysChange: (value) => {
        this.activeDays = value;
      },
      onArchiveDaysChange: (value) => {
        this.archiveDays = value;
      },
      onDeleteAfterDaysChange: (value) => {
        this.deleteAfterDays = value;
      },
      onComplianceProfileChange: (value) => {
        this.complianceProfile = value;
      },
      onSave: () => void this.save(),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "enterprise-memory-governance-card": EnterpriseMemoryGovernanceCard;
    "enterprise-retention-policy-card": EnterpriseRetentionPolicyCard;
  }
}
