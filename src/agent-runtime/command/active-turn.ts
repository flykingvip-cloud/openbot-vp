/** Compatibility exports only. All messages use the unified interaction entry. */
export { handleInteraction as handleActiveTurn } from "./interaction.js";
export type {
  InteractionPorts as ActiveTurnPorts,
  InteractionDisposition as ActiveTurnDisposition,
} from "./interaction.js";
