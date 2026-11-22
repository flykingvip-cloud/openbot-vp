import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { TaskActivitySnapshot } from "../../../../src/shared/task-activity.ts";
import { parseTaskActivitySnapshot, resolveTaskActivityLine } from "./task-activity-state.ts";

type ActivityClient = { request: (method: string, params?: unknown) => Promise<unknown> };
export class ChatTaskActivity extends LitElement {
  static properties = {
    sessionKey: { type: String },
    client: { attribute: false },
    connected: { type: Boolean },
    runId: { type: String },
    snapshot: { state: true },
    readFailed: { state: true },
  };
  sessionKey = "";
  client: ActivityClient | null = null;
  connected = false;
  runId: string | null = null;
  private snapshot: TaskActivitySnapshot | null = null;
  private readFailed = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  static styles = css`
    :host {
      display: block;
    }
    .activity {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      padding: 4px 12px;
      font-size: 12px;
      color: var(--muted, #667085);
    }
    .dot {
      width: 6px;
      height: 6px;
      flex: 0 0 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .moving {
      animation: task-activity-pulse 1.6s ease-in-out infinite;
    }
    @keyframes task-activity-pulse {
      50% {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .moving {
        animation: none;
      }
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    this.restart();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    this.clearTimer();
  }
  protected updated(changed: PropertyValues) {
    if (
      changed.has("sessionKey") ||
      changed.has("client") ||
      changed.has("connected") ||
      changed.has("runId")
    ) {
      if (changed.has("sessionKey") || changed.has("client")) {
        this.snapshot = null;
      }
      this.restart();
    }
  }
  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = null;
  }
  private restart() {
    const generation = ++this.generation;
    this.clearTimer();
    if (!this.isConnected || !this.connected || !this.client || !this.sessionKey.trim()) {
      return;
    }
    void this.refresh(generation);
  }
  private async refresh(generation: number) {
    const sessionKey = this.sessionKey;
    try {
      const raw = await this.client?.request("task.activity.get", { sessionKey });
      if (generation !== this.generation || !this.isConnected || this.sessionKey !== sessionKey) {
        return;
      }
      const snapshot = parseTaskActivitySnapshot(raw, sessionKey);
      this.readFailed = snapshot === null;
      if (snapshot) {
        this.snapshot = snapshot;
      }
    } catch {
      if (generation !== this.generation || !this.isConnected) {
        return;
      }
      this.readFailed = true;
    }
    if (generation === this.generation && this.isConnected) {
      this.timer = setTimeout(() => void this.refresh(generation), 5_000);
    }
  }
  protected render() {
    const line = resolveTaskActivityLine({
      sessionKey: this.sessionKey,
      snapshot: this.snapshot,
      connected: this.connected,
      readFailed: this.readFailed,
      nowMs: Date.now(),
    });
    return line
      ? html`<div class="activity" role="status" aria-live="polite" aria-atomic="true" data-phase=${line.phase}>
      <span aria-hidden="true" class=${line.animate ? "dot moving" : "dot"}></span><span>${line.text}</span>
    </div>`
      : nothing;
  }
}
if (typeof customElements !== "undefined" && !customElements.get("chat-task-activity")) {
  customElements.define("chat-task-activity", ChatTaskActivity);
}
declare global {
  interface HTMLElementTagNameMap {
    "chat-task-activity": ChatTaskActivity;
  }
}
