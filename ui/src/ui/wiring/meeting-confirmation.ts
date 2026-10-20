/**
 * Control-ui shell wiring for meeting pause-release confirmation.
 * Keeps app.ts off the direct controllers/meeting-confirmation import.
 */

import type { adaptSpacesLoadCapabilityState } from "../capability/view-state.ts";
import {
  cancelMeetingPendingConfirmation,
  clearMeetingConfirmRelease,
  confirmMeetingPendingApproval,
  syncMeetingPendingConfirmation,
} from "../controllers/meeting-confirmation.ts";

export type {
  MeetingConfirmRelease,
  MeetingPendingConfirmation,
} from "../controllers/meeting-confirmation.ts";

type ShellSpacesLoadState = ReturnType<typeof adaptSpacesLoadCapabilityState>;

type MeetingConfirmResumeHost = {
  resumeMeetingConfirmConversation?: (continuation: {
    userMessage: string;
  }) => void | Promise<void>;
} & ShellSpacesLoadState;

export async function syncShellMeetingPendingConfirmation(
  state: ShellSpacesLoadState,
): Promise<void> {
  await syncMeetingPendingConfirmation(state as never);
}

export async function confirmShellMeetingPendingApproval(
  state: ShellSpacesLoadState,
  resumeConversation: (userMessage: string) => Promise<unknown>,
): Promise<void> {
  const host = state as never as MeetingConfirmResumeHost;
  host.resumeMeetingConfirmConversation = async (continuation) => {
    await resumeConversation(continuation.userMessage);
  };
  await confirmMeetingPendingApproval(host as never);
}

export function cancelShellMeetingPendingConfirmation(state: ShellSpacesLoadState): void {
  void cancelMeetingPendingConfirmation(state as never);
}

export function dismissShellMeetingConfirmRelease(state: ShellSpacesLoadState): void {
  clearMeetingConfirmRelease(state as never);
}
