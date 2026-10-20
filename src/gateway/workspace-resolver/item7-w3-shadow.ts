import { scheduleItem7W3CatalogSynthesisShadow as scheduleW3Shadow } from "../../memory/item7-w3-catalog-synthesis.js";

/** Post-synthesis W3 shadow; does not call P4 synthesis symbols (freeze-safe). */
export function scheduleItem7W3CatalogSynthesisShadow(input: {
  ledgerId: string;
  existingResourceId: string | null;
}): void {
  scheduleW3Shadow(input);
}
