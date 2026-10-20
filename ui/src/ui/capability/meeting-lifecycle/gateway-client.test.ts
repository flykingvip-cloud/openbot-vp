// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C5)
// 强类型 meeting/task RPC 客户端：断言方法名与参数透传（mock transport）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { MinutesDraft } from "./endpoints.ts";
import { createMeetingLifecycleGateway } from "./gateway-client.ts";

const request = vi.fn(async (_method: string, _params?: unknown) => ({}) as unknown);
const client = { request } as unknown as GatewayBrowserClient;
const gateway = createMeetingLifecycleGateway(client);

beforeEach(() => {
  request.mockClear();
});

describe("createMeetingLifecycleGateway", () => {
  it("createMeeting posts to meeting.create with the request body", async () => {
    await gateway.createMeeting({ title: "Sync", startAtMs: 1, attendees: [{ userId: "u2" }] });
    expect(request).toHaveBeenCalledWith("meeting.create", {
      title: "Sync",
      startAtMs: 1,
      attendees: [{ userId: "u2" }],
    });
  });

  it("transitions post the meeting id", async () => {
    await gateway.submitMeeting("m1");
    await gateway.approveMeeting("m1");
    await gateway.startMeeting("m1");
    await gateway.distributeMeeting("m1");
    await gateway.cancelMeeting("m1");
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "meeting.submit",
      "meeting.approve",
      "meeting.start",
      "meeting.distribute",
      "meeting.cancel",
    ]);
    for (const call of request.mock.calls) {
      expect(call[1]).toEqual({ id: "m1" });
    }
  });

  it("approveMeeting forwards confirmation tokens when provided", async () => {
    await gateway.approveMeeting("m1", {
      proposalId: "p1",
      confirmationToken: "tok",
    });
    expect(request).toHaveBeenCalledWith("meeting.approve", {
      id: "m1",
      proposalId: "p1",
      confirmationToken: "tok",
    });
  });

  it("replayMeetingSchedule posts the meeting id", async () => {
    await gateway.replayMeetingSchedule("m1");
    expect(request).toHaveBeenCalledWith("meeting.replay-schedule", { id: "m1" });
  });

  it("minuteMeeting posts id + validated minutes draft", async () => {
    const minutes: MinutesDraft = {
      kind: "minutes_draft",
      summary: "done",
      decisions: [],
      actionItems: [{ kind: "task", title: "follow up", assigneeUserId: "u2" }],
    };
    await gateway.minuteMeeting({ id: "m1", minutes });
    expect(request).toHaveBeenCalledWith("meeting.minute", { id: "m1", minutes });
  });

  it("generateMeetingMinutes posts the transcript and meeting id", async () => {
    await gateway.generateMeetingMinutes({ meetingId: "m1", transcript: "notes" });
    expect(request).toHaveBeenCalledWith("meeting.generate-minutes", {
      meetingId: "m1",
      transcript: "notes",
    });
  });

  it("listMeetings posts an empty body", async () => {
    await gateway.listMeetings();
    expect(request).toHaveBeenCalledWith("meeting.list", {});
  });

  it("task accept/complete post organizationId + id", async () => {
    await gateway.acceptTask({ organizationId: "space-a", id: "t1" });
    await gateway.completeTask({ organizationId: "space-a", id: "t1" });
    expect(request).toHaveBeenNthCalledWith(1, "task.accept", {
      organizationId: "space-a",
      id: "t1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "task.complete", {
      organizationId: "space-a",
      id: "t1",
    });
  });

  it("listTasks omits organizationId when not provided", async () => {
    await gateway.listTasks();
    expect(request).toHaveBeenCalledWith("task.list", {});
    request.mockClear();
    await gateway.listTasks("space-a");
    expect(request).toHaveBeenCalledWith("task.list", { organizationId: "space-a" });
  });

  it("approveMeeting forwards dismissConfirmation when provided", async () => {
    await gateway.approveMeeting("m1", { dismissConfirmation: true });
    expect(request).toHaveBeenCalledWith("meeting.approve", {
      id: "m1",
      dismissConfirmation: true,
    });
  });
});
