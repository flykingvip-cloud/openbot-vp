import { html, nothing, type TemplateResult } from "lit";
import { i18n, t } from "../../../../i18n/index.ts";
import { icons } from "../../../icons.ts";
import type { WorkbenchSignalsCapabilityContract } from "./workbench-capability-contracts.ts";
import type {
  WorkbenchScheduleItemView,
  WorkbenchSignalItemOrigin,
  WorkbenchSignalItemRef,
  WorkbenchStewardSuggestionSummary,
} from "./workbench-signals.ts";
import {
  formatScheduleEntryMeta,
  partitionAndSortScheduleItems,
  sortTodosEntriesByUrgency,
} from "./workbench-signals.ts";

export type WorkbenchSignalsSurfaceTone = "ready" | "low" | "meeting" | "high";
export type WorkbenchSignalsSurfaceIconKey =
  | "clipboardCheck"
  | "fileText"
  | "messageSquare"
  | "bell";

export type WorkbenchSignalsSurfaceCard = {
  key: string;
  title: string;
  badgeCount: number;
  primary: string;
  secondary: string;
  timeLabel: string | null;
  pillLabel: string;
  tone: WorkbenchSignalsSurfaceTone;
  iconKey: WorkbenchSignalsSurfaceIconKey;
  actionId: "openCron" | "openTodos";
  /** Auto-extracted clickable item refs rendered as the card body list. */
  entries?: WorkbenchSignalItemRef[];
};

const TODOS_ORIGIN_ORDER: readonly WorkbenchSignalItemOrigin[] = [
  "knowledge",
  "task",
  "collaboration",
  "meeting-notice",
];

const TODOS_ORIGIN_I18N_KEY: Record<WorkbenchSignalItemOrigin, string> = {
  task: "frontstage.workbench.cards.todosOrigin.task",
  collaboration: "frontstage.workbench.cards.todosOrigin.collaboration",
  "meeting-notice": "frontstage.workbench.cards.todosOrigin.meeting",
  knowledge: "frontstage.workbench.cards.todosOrigin.knowledge",
};

const TODOS_ORIGIN_FALLBACK_LABELS: Record<
  "en" | "zh-CN",
  Record<WorkbenchSignalItemOrigin, string>
> = {
  en: {
    task: "Tasks",
    collaboration: "Collaboration",
    "meeting-notice": "Meetings",
    knowledge: "Knowledge",
  },
  "zh-CN": {
    task: "任务",
    collaboration: "协作",
    "meeting-notice": "会议",
    knowledge: "知识库",
  },
};

function resolveTodosOriginLabel(origin: WorkbenchSignalItemOrigin): string {
  const key = TODOS_ORIGIN_I18N_KEY[origin];
  const translated = t(key);
  if (translated !== key) {
    return translated;
  }
  const table =
    i18n.getLocale() === "zh-CN"
      ? TODOS_ORIGIN_FALLBACK_LABELS["zh-CN"]
      : TODOS_ORIGIN_FALLBACK_LABELS.en;
  return table[origin];
}

/** Group todos entries by origin (exported for tests). */
export function groupTodosEntriesByOrigin(entries: WorkbenchSignalItemRef[]): {
  sections: Array<{
    origin: WorkbenchSignalItemOrigin;
    label: string;
    entries: WorkbenchSignalItemRef[];
  }>;
  uncategorized: WorkbenchSignalItemRef[];
} {
  const buckets = new Map<WorkbenchSignalItemOrigin, WorkbenchSignalItemRef[]>();
  for (const origin of TODOS_ORIGIN_ORDER) {
    buckets.set(origin, []);
  }
  const uncategorized: WorkbenchSignalItemRef[] = [];
  for (const entry of entries) {
    if (entry.origin && buckets.has(entry.origin)) {
      buckets.get(entry.origin)?.push(entry);
      continue;
    }
    uncategorized.push(entry);
  }
  const sections = TODOS_ORIGIN_ORDER.flatMap((origin) => {
    const items = buckets.get(origin) ?? [];
    if (items.length === 0) {
      return [];
    }
    return [{ origin, label: resolveTodosOriginLabel(origin), entries: items }];
  });
  return { sections, uncategorized };
}

function scheduleItemsToEntries(
  scheduleItems: WorkbenchScheduleItemView[],
): WorkbenchSignalItemRef[] {
  return scheduleItems.map((item) => {
    const meta = formatScheduleEntryMeta(item.startAtMs);
    return { id: item.id, title: item.title, ...(meta ? { meta } : {}) };
  });
}

function foldZhDisplay(value: string): string {
  return value.replace(/識/g, "识").replace(/庫/g, "库").replace(/務/g, "务").replace(/協/g, "协");
}

const TODOS_ORIGIN_ALIASES: Record<WorkbenchSignalItemOrigin, string[]> = {
  task: ["任务", "任務", "Tasks"],
  collaboration: ["协作", "協作", "Collaboration"],
  "meeting-notice": ["会议", "會議", "Meetings"],
  knowledge: ["知识库", "知識庫", "Knowledge"],
};

export function shouldShowTodosOriginChip(
  title: string,
  originLabel: string | undefined,
  origin?: WorkbenchSignalItemOrigin,
): boolean {
  const candidates = [
    originLabel?.trim() ?? "",
    ...(origin ? TODOS_ORIGIN_ALIASES[origin] : []),
  ].filter(Boolean);
  if (candidates.length === 0) {
    return false;
  }
  const foldedTitle = foldZhDisplay(title.trim());
  return !candidates.some((label) => foldedTitle.startsWith(foldZhDisplay(label)));
}

function renderEntryRow(
  entry: WorkbenchSignalItemRef,
  onOpenEntry: (entryId: string) => void,
  options?: { originLabel?: string; timed?: boolean },
) {
  const timed = options?.timed === true && Boolean(entry.meta);
  const showOrigin = shouldShowTodosOriginChip(entry.title, options?.originLabel, entry.origin);
  const entryClass = [
    "employee-workbench__signal-card-entry",
    timed ? "employee-workbench__signal-card-entry--timed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return html`
    <li
      class=${entryClass}
      role="button"
      tabindex="0"
      title=${entry.title}
      @click=${(event: Event) => {
        event.stopPropagation();
        onOpenEntry(entry.id);
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpenEntry(entry.id);
      }}
    >
      ${
        timed
          ? html`<span class="employee-workbench__signal-card-entry-meta">${entry.meta}</span>`
          : html`
              <span class="employee-workbench__signal-card-entry-dot" aria-hidden="true"></span>
            `
      }
      ${
        showOrigin
          ? html`<span class="employee-workbench__signal-card-entry-origin"
              >${options?.originLabel}</span
            >`
          : nothing
      }
      <span class="employee-workbench__signal-card-entry-title">${entry.title}</span>
      ${
        !timed && entry.meta
          ? html`<span class="employee-workbench__signal-card-entry-meta">${entry.meta}</span>`
          : nothing
      }
    </li>
  `;
}

function renderScheduleEntryList(
  upcoming: WorkbenchScheduleItemView[],
  onOpenEntry: (entryId: string) => void,
) {
  if (upcoming.length === 0) {
    return nothing;
  }
  const upcomingEntries = scheduleItemsToEntries(upcoming);
  return html`
    <ul class="employee-workbench__signal-card-entries">
      ${upcomingEntries.map((entry) => renderEntryRow(entry, onOpenEntry, { timed: true }))}
    </ul>
  `;
}

function renderTodosEntryList(
  entries: WorkbenchSignalItemRef[],
  onOpenEntry: (entryId: string) => void,
) {
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <ul class="employee-workbench__signal-card-entries">
      ${entries.map((entry) =>
        renderEntryRow(entry, onOpenEntry, {
          originLabel: entry.origin ? resolveTodosOriginLabel(entry.origin) : undefined,
        }),
      )}
    </ul>
  `;
}

function renderEmptyCardBody(primary: string, secondary: string) {
  return html`
    <div class="employee-workbench__signal-card-summary">
      <div class="employee-workbench__signal-card-primary">${primary}</div>
      ${
        secondary
          ? html`<div class="employee-workbench__signal-card-secondary">${secondary}</div>`
          : nothing
      }
    </div>
  `;
}

/** CJK short titles use upright vertical rail copy; Latin/long titles stay horizontal. */
export function resolveParallelRailLabelMode(title: string): "vertical" | "horizontal" {
  const trimmed = title.trim();
  if (!trimmed) {
    return "horizontal";
  }
  if (i18n.getLocale() === "zh-CN") {
    return "vertical";
  }
  const cjkCount = Array.from(trimmed).filter((char) => /\p{Script=Han}/u.test(char)).length;
  if (cjkCount >= trimmed.length * 0.5 && trimmed.length <= 6) {
    return "vertical";
  }
  return "horizontal";
}

function renderParallelCard(
  card: WorkbenchSignalsSurfaceCard,
  body: TemplateResult | typeof nothing,
  headerSummary: string | null,
  options: { empty: boolean },
) {
  const railLabelMode = resolveParallelRailLabelMode(card.title);
  const cardClass = [
    "employee-workbench__signal-card",
    "employee-workbench__signal-card--parallel",
    options.empty ? "employee-workbench__signal-card--empty" : "",
    `employee-workbench__signal-card--${card.tone}`,
  ]
    .filter(Boolean)
    .join(" ");

  return html`
    <article class=${cardClass} aria-label=${card.title}>
      <div
        class="employee-workbench__signal-card-rail employee-workbench__signal-card-rail--${railLabelMode}"
      >
        <div class="employee-workbench__signal-card-icon">${icons[card.iconKey]}</div>
        <div
          class="employee-workbench__signal-card-rail-label employee-workbench__signal-card-rail-label--${railLabelMode}"
        >
          ${card.title}
        </div>
      </div>
      <div class="employee-workbench__signal-card-main">
        ${
          headerSummary
            ? html`<div class="employee-workbench__signal-section-summary">${headerSummary}</div>`
            : nothing
        }
        <div class="employee-workbench__signal-card-body">${body}</div>
      </div>
    </article>
  `;
}

export function renderWorkbenchSignalsSurface(
  cards: WorkbenchSignalsSurfaceCard[],
  capability: WorkbenchSignalsCapabilityContract,
  _stewardSuggestion?: WorkbenchStewardSuggestionSummary | null,
  scheduleItems: WorkbenchScheduleItemView[] = [],
) {
  if (cards.length === 0) {
    return nothing;
  }

  const scheduleCard = cards.find((card) => card.key === "schedule");
  const todosCard = cards.find((card) => card.key === "todos");
  const todosRaw = todosCard?.entries ?? [];
  const todosSorted = sortTodosEntriesByUrgency(todosRaw);
  const { upcoming } = partitionAndSortScheduleItems(scheduleItems);
  const nowMs = Date.now();
  const upcomingOnly = upcoming.filter((item) => item.startAtMs >= nowMs);
  const scheduleHasEntries = upcomingOnly.length > 0;
  const todosHasEntries = todosSorted.length > 0;
  const gridClass = [
    "employee-workbench__signals-grid",
    "employee-workbench__signals-grid--flat",
    "employee-workbench__signals-grid--parallel",
  ].join(" ");

  const openScheduleEntry = (entryId: string) => {
    if (capability.onOpenSignalEntry) {
      capability.onOpenSignalEntry("schedule", entryId);
      return;
    }
    capability.onOpenCron?.();
  };

  const openTodosEntry = (entryId: string) => {
    if (capability.onOpenSignalEntry) {
      capability.onOpenSignalEntry("todos", entryId);
      return;
    }
    capability.onOpenAssistantSettings?.();
  };

  return html`
    <section
      class="employee-workbench__signals-overview employee-workbench__signals-overview--flat"
    >
      <div class=${gridClass}>
        ${
          scheduleCard
            ? renderParallelCard(
                scheduleCard,
                scheduleHasEntries
                  ? renderScheduleEntryList(upcomingOnly, openScheduleEntry)
                  : renderEmptyCardBody(scheduleCard.primary, scheduleCard.secondary),
                null,
                { empty: !scheduleHasEntries },
              )
            : nothing
        }
        ${
          todosCard
            ? renderParallelCard(
                todosCard,
                todosHasEntries
                  ? renderTodosEntryList(todosSorted, openTodosEntry)
                  : renderEmptyCardBody(todosCard.primary, todosCard.secondary),
                null,
                { empty: !todosHasEntries },
              )
            : nothing
        }
      </div>
    </section>
  `;
}

/** @deprecated Accordion removed; kept as no-op for older tests/callers. */
export function getExpandedCardKey(): string | null {
  return null;
}

/** @deprecated Accordion removed; kept as no-op for older tests/callers. */
export function resetExpandedCardKey(): void {
  // no-op
}
