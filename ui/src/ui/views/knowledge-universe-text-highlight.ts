import { html, type TemplateResult } from "lit";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split query into non-empty terms (comma / whitespace). */
export function tokenizeSearchHighlightQuery(query: string): string[] {
  return query
    .split(/[\s,，]+/)
    .map((term) => term.trim())
    .filter((term, index, list) => term.length > 0 && list.indexOf(term) === index);
}

/**
 * Wrap case-insensitive query term matches in <mark> for evidence excerpts.
 * Returns plain text when query is empty or no terms match.
 */
export function highlightSearchTerms(text: string, query: string): string | TemplateResult {
  const terms = tokenizeSearchHighlightQuery(query);
  if (terms.length === 0 || !text) {
    return text;
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  if (parts.length <= 1) {
    return text;
  }

  const loweredTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return html`${parts.map((part) =>
    loweredTerms.has(part.toLocaleLowerCase())
      ? html`<mark class="knowledge-universe__search-highlight">${part}</mark>`
      : part,
  )}`;
}
