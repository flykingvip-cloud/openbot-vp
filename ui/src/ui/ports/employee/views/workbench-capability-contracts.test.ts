import { describe, expect, it, vi } from "vitest";
import { buildWorkbenchSignalsCapabilityContract } from "./workbench-capability-contracts.ts";

describe("buildWorkbenchSignalsCapabilityContract onOpenSignalEntry", () => {
  it("opens a 待治理 deliverable todos entry via the governance-object detail opener", () => {
    const onOpenGovernanceObjectDetail = vi.fn();
    const onOpenAssistantSettings = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenGovernanceObjectDetail,
      onOpenAssistantSettings,
    });
    contract.onOpenSignalEntry?.("todos", "governance:deliv-42");
    expect(onOpenGovernanceObjectDetail).toHaveBeenCalledWith("deliverable", "deliv-42");
    expect(onOpenAssistantSettings).not.toHaveBeenCalled();
  });

  it("routes task todos entries to the steward hub", () => {
    const onOpenGovernanceObjectDetail = vi.fn();
    const onOpenAssistantSettings = vi.fn();
    const onOpenCollaborationSpace = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenGovernanceObjectDetail,
      onOpenAssistantSettings,
      onOpenCollaborationSpace,
    });
    contract.onOpenSignalEntry?.("todos", "task:assignment-1");
    expect(onOpenGovernanceObjectDetail).not.toHaveBeenCalled();
    expect(onOpenCollaborationSpace).not.toHaveBeenCalled();
    expect(onOpenAssistantSettings).toHaveBeenCalledTimes(1);
  });

  it("routes invite todos entries to the collaboration invite opener", () => {
    const onOpenAssistantSettings = vi.fn();
    const onOpenCollaborationInvite = vi.fn();
    const onOpenCollaborationSpace = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenAssistantSettings,
      onOpenCollaborationInvite,
      onOpenCollaborationSpace,
    });
    contract.onOpenSignalEntry?.("todos", "invite:bot:colleague-space:market-assistant");
    expect(onOpenCollaborationInvite).toHaveBeenCalledWith({
      kind: "bot",
      groupId: "colleague-space",
      subjectId: "market-assistant",
    });
    expect(onOpenCollaborationSpace).not.toHaveBeenCalled();
    expect(onOpenAssistantSettings).not.toHaveBeenCalled();
  });

  it("routes each card key to its section opener by default", () => {
    const onOpenCron = vi.fn();
    const onOpenAssistantSettings = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenCron,
      onOpenAssistantSettings,
    });
    contract.onOpenSignalEntry?.("schedule", "sched-1");
    contract.onOpenSignalEntry?.("todos", "unknown-fallback");
    expect(onOpenCron).toHaveBeenCalledTimes(1);
    // Bare ids without collaboration opener fall back to steward section.
    expect(onOpenAssistantSettings).toHaveBeenCalledTimes(1);
  });

  it("routes a schedule entry to onOpenScheduleEntry and a collaboration entry to onOpenCollaborationSpace", () => {
    const onOpenScheduleEntry = vi.fn();
    const onOpenCollaborationSpace = vi.fn();
    const onOpenCron = vi.fn();
    const onOpenAssistantSettings = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenScheduleEntry,
      onOpenCollaborationSpace,
      onOpenCron,
      onOpenAssistantSettings,
    });
    contract.onOpenSignalEntry?.("schedule", "cron:job-7");
    contract.onOpenSignalEntry?.("todos", "grp-42");
    expect(onOpenScheduleEntry).toHaveBeenCalledWith("cron:job-7");
    expect(onOpenCollaborationSpace).toHaveBeenCalledWith("grp-42");
    expect(onOpenCron).not.toHaveBeenCalled();
    expect(onOpenAssistantSettings).not.toHaveBeenCalled();
  });

  it("routes ledger-gate todos entries to the cron task detail", () => {
    const onOpenScheduleEntry = vi.fn();
    const onOpenAssistantSettings = vi.fn();
    const onOpenCron = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenScheduleEntry,
      onOpenAssistantSettings,
      onOpenCron,
    });
    contract.onOpenSignalEntry?.("todos", "ledger-gate:job-7");
    expect(onOpenScheduleEntry).toHaveBeenCalledWith("cron:job-7");
    expect(onOpenAssistantSettings).not.toHaveBeenCalled();
  });

  it("routes meeting-notice todos entries to meeting invite review (chat confirm mirror)", () => {
    const onOpenCollaborationSpace = vi.fn();
    const onOpenAssistantSettings = vi.fn();
    const onOpenMeetingInviteReview = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenCollaborationSpace,
      onOpenAssistantSettings,
      onOpenMeetingInviteReview,
    });
    contract.onOpenSignalEntry?.("todos", "meeting:invite-review");
    expect(onOpenCollaborationSpace).not.toHaveBeenCalled();
    expect(onOpenMeetingInviteReview).toHaveBeenCalledTimes(1);
    expect(onOpenAssistantSettings).not.toHaveBeenCalled();
  });

  it("routes knowledge conflict todos entries to the steward suggestion opener", () => {
    const onOpenStewardSuggestion = vi.fn();
    const onOpenGovernanceObjectDetail = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenStewardSuggestion,
      onOpenGovernanceObjectDetail,
    });
    contract.onOpenSignalEntry?.("todos", "governance:conflict");
    expect(onOpenStewardSuggestion).toHaveBeenCalledWith("conflict");
    expect(onOpenGovernanceObjectDetail).not.toHaveBeenCalled();
  });

  it("exposes onOpenStewardSuggestion from the contract source", () => {
    const onOpenStewardSuggestion = vi.fn();
    const contract = buildWorkbenchSignalsCapabilityContract({
      onOpenStewardSuggestion,
    });
    contract.onOpenStewardSuggestion?.("attention");
    expect(onOpenStewardSuggestion).toHaveBeenCalledWith("attention");
  });
});
