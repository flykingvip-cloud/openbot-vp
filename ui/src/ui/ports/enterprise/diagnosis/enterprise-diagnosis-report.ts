import { html, nothing, type TemplateResult } from "lit";
import {
  parseDiagnoseReportActions,
  type DiagnoseReportActionChip,
} from "../../diagnosis/diagnosis-conversation-action.ts";

export { parseDiagnoseReportActions, type DiagnoseReportActionChip };

export type DiagnoseReportLine =
  | { kind: "kv"; label: string; value: string }
  | { kind: "text"; value: string }
  | { kind: "subhead"; value: string };

export type DiagnoseReportSection = {
  heading: string;
  lines: DiagnoseReportLine[];
};

export type DiagnoseReportArticle = {
  title: string;
  sections: DiagnoseReportSection[];
};

const SECTION_RE = /^[一二三四五六七八]、.+$/;
const KV_RE = /^([^：\n]{1,12})：(.+)$/;
const IDENTITY_RE = /^(IDENTITY|USER)\s+(.+)$/;

export function parseDiagnoseReportArticle(text: string): DiagnoseReportArticle {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const chunks = normalized.split(/\n(?=[一二三四五六七八]、)/);
  const title = chunks[0]?.split("\n")[0]?.trim() || "【诊断报告】";
  const sections: DiagnoseReportSection[] = [];
  for (const chunk of chunks) {
    const rawLines = chunk.split("\n").map((line) => line.trimEnd());
    const first = rawLines[0]?.trim() ?? "";
    if (!SECTION_RE.test(first)) {
      continue;
    }
    sections.push({
      heading: first,
      lines: classifyLines(rawLines.slice(1)),
    });
  }
  return { title, sections };
}

function classifyLines(rawLines: string[]): DiagnoseReportLine[] {
  const lines: DiagnoseReportLine[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const identity = line.match(IDENTITY_RE);
    if (identity) {
      lines.push({ kind: "kv", label: identity[1], value: identity[2] });
      continue;
    }
    const kv = line.match(KV_RE);
    if (kv && !kv[1].includes(" ")) {
      lines.push({ kind: "kv", label: kv[1], value: kv[2] });
      continue;
    }
    if (isSubhead(line)) {
      lines.push({ kind: "subhead", value: line });
      continue;
    }
    lines.push({ kind: "text", value: line });
  }
  return lines;
}

export function renderEnterpriseDiagnosisReport(
  text: string,
  onRunConversationAction?: (action: DiagnoseReportActionChip) => void,
): TemplateResult {
  const article = parseDiagnoseReportArticle(text);
  const actions = parseDiagnoseReportActions(text);
  return html`
    <article class="enterprise-diagnosis__article" data-testid="diagnosis-report-article">
      <pre class="enterprise-diagnosis__sr-only" data-testid="diagnosis-report-text">${text}</pre>
      <h2 class="enterprise-diagnosis__article-title">${article.title}</h2>
      ${article.sections.map(
        (section) => html`
          <section class="enterprise-diagnosis__article-section">
            <h3 class="enterprise-diagnosis__article-heading">${section.heading}</h3>
            <div class="enterprise-diagnosis__article-body">
              ${section.lines.map((line) => renderLine(line))}
            </div>
          </section>
        `,
      )}
      ${
        actions.length > 0
          ? html`
              <div class="enterprise-diagnosis__actions enterprise-diagnosis__actions--wrap">
                ${actions.map(
                  (action) => html`
                    <button
                      type="button"
                      class="btn btn--sm"
                      data-testid="diagnosis-action-run"
                      title=${
                        action.handoffChannel === "diagnosed_agent_session"
                          ? "交给被诊断数字人（1:1 会话，不是协作小组）"
                          : "在大白对话发送，由管家执行"
                      }
                      @click=${() => onRunConversationAction?.(action)}
                    >
                      ${action.title}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing
      }
    </article>
  `;
}

function isSubhead(line: string): boolean {
  return line === "扫描范围" || (line.length <= 24 && !line.includes("：") && !/[。；]/.test(line));
}

function renderLine(line: DiagnoseReportLine): TemplateResult {
  if (line.kind === "kv") {
    return html`
      <div class="enterprise-diagnosis__kv-row enterprise-diagnosis__article-row">
        <span class="enterprise-diagnosis__label">${line.label}</span>
        <span class="enterprise-diagnosis__value">${line.value}</span>
      </div>
    `;
  }
  if (line.kind === "subhead") {
    return html`<p class="enterprise-diagnosis__article-subhead">${line.value}</p>`;
  }
  return html`<p class="enterprise-diagnosis__article-prose">${line.value}</p>`;
}
