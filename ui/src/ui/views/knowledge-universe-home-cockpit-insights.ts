/**
 * Home cockpit insights builder — stub until full knowledge-universe WIP lands.
 * Returns null so the governance ticker falls back to action suggestions only.
 */

import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import type { KnowledgeDetailInsights } from "./knowledge-universe-detail-insights.ts";

export function buildHomeCockpitInsights(
  _surface: WorkbenchKnowledgeSurface,
): KnowledgeDetailInsights | null {
  return null;
}
