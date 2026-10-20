/**
 * Locks dissolve-broadcast behavior for auto-archive notices.
 * A non-finite archivedAtMs skips the broadcast. The RPC still returns the
 * original payload. A finite archivedAtMs still broadcasts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMembers = vi.hoisted(() => vi.fn());

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../collaboration-learning.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collaboration-learning.js")>();
  return {
    ...actual,
    updateGatewayCollaborationSpaceMembers: (...args: unknown[]) => updateMembers(...args),
  };
});

const { spacesHandlers } = await import("./spaces.js");

const membersParams = {
  groupId: "grp_notice",
  members: { humans: [], bots: [] },
};

async function updateMembersAndCapture(payload: Record<string, unknown>) {
  updateMembers.mockResolvedValue(payload);
  const respond = vi.fn();
  const broadcast = vi.fn();
  await spacesHandlers["collaboration.spaces.members.update"]({
    req: {} as never,
    params: membersParams,
    respond: respond as never,
    client: { connect: {} } as never,
    isWebchatConnect: () => false,
    context: { broadcast } as never,
  });
  return { respond, broadcast };
}

describe("collaboration space auto-archive dissolve broadcast", () => {
  beforeEach(() => {
    updateMembers.mockReset();
  });

  it("skips the dissolve broadcast when archivedAtMs is not a finite number", async () => {
    const payload = {
      autoArchived: true,
      archivedAtMs: "1700000000000",
      notificationMessage: "archived",
      space: { title: "Notice" },
    };
    const { respond, broadcast } = await updateMembersAndCapture(payload);

    expect(updateMembers).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(true, payload, undefined);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("broadcasts dissolve when archivedAtMs is a finite number", async () => {
    const payload = {
      autoArchived: true,
      archivedAtMs: 1_700_000_000_000,
      notificationMessage: "archived",
      space: { title: "Notice" },
    };
    const { respond, broadcast } = await updateMembersAndCapture(payload);

    expect(respond).toHaveBeenCalledWith(true, payload, undefined);
    expect(broadcast).toHaveBeenCalledWith(
      "collaboration.space.dissolved",
      expect.objectContaining({
        groupId: "grp_notice",
        title: "Notice",
        message: "archived",
        dissolvedAtMs: 1_700_000_000_000,
      }),
    );
  });
});
