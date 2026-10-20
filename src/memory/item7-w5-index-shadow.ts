import { scheduleItem7W5IndexShadow as scheduleW5Shadow } from "./item7-w5-index-last.js";

/** Post-index W5 shadow; does not call resolveAgentWorkspaceDir / syncMemoryFiles. */
export function scheduleItem7W5IndexShadow(input: {
  ledgerId: string;
  handleResourceId: string | null;
}): void {
  scheduleW5Shadow(input);
}
