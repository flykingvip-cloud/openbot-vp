import { html, nothing, type TemplateResult } from "lit";
import type { MentionChipData } from "../../../../../src/organization/mention-types.js";

export interface MentionChipProps {
  chip: MentionChipData;
  roleName?: string;
  online?: boolean;
  selected?: boolean;
  tooltip?: string;
  onRemove?: (chip: MentionChipData) => void;
}

export interface MentionChipKeydownParams {
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">;
  chip: MentionChipData;
  onRemove?: (chip: MentionChipData) => void;
}

export function toMentionChipPlainText(chip: MentionChipData): string {
  return `@${chip.displayName}`;
}

export function getMentionChipTooltip(props: MentionChipProps): string {
  if (props.tooltip) {
    return props.tooltip;
  }
  const parts = [
    props.roleName,
    typeof props.online === "boolean" ? (props.online ? "在线" : "离线") : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

export function handleMentionChipKeydown(params: MentionChipKeydownParams): boolean {
  if (params.event.key !== "Backspace" && params.event.key !== "Delete") {
    return false;
  }

  params.event.preventDefault();
  params.event.stopPropagation();
  params.onRemove?.(params.chip);
  return true;
}

export function renderMentionChip(props: MentionChipProps): TemplateResult {
  const chipText = toMentionChipPlainText(props.chip);
  const tooltip = getMentionChipTooltip(props);
  const classes = [
    "mention-chip",
    props.chip.isAll ? "mention-chip--all" : "mention-chip--agent",
    props.selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return html`
    <span
      class=${classes}
      role="button"
      tabindex="0"
      aria-label=${`Remove mention: ${props.chip.displayName}`}
      contenteditable="false"
      data-mention-id=${props.chip.mention_id}
      data-agent-id=${props.chip.agentId}
      data-plain-text=${chipText}
      title=${tooltip || nothing}
      @keydown=${(event: KeyboardEvent) =>
        handleMentionChipKeydown({
          event,
          chip: props.chip,
          onRemove: props.onRemove,
        })}
    >
      <span class="mention-chip__text">${chipText}</span>
    </span>
  `;
}
