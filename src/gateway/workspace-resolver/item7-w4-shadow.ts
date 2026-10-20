import { scheduleItem7W4StewardHelperShadow as scheduleW4Shadow } from "../../memory/item7-w4-steward-helpers.js";

/** Post-helper W4 shadow; does not call P5 steward helper symbols (freeze-safe). */
export function scheduleItem7W4StewardHelperShadow(input: {
  ledgerId: string;
  catalogResourceId: string | null;
}): void {
  scheduleW4Shadow(input);
}
