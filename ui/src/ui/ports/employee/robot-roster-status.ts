/**
 * Why the settings robots tab is empty.
 *
 * unbound: signed-in employee has no position (invite without a bind is an anomaly).
 * query_failed: the agents.list query did not succeed.
 * sync_failed: the position is bound, but the list has not arrived.
 * zero: the position is bound and the list succeeded with no position bots.
 * ready: the list has position bots, or there is nothing to explain.
 */
export type RobotRosterStatus = "ready" | "unbound" | "zero" | "query_failed" | "sync_failed";

export function resolveRobotRosterStatus(params: {
  signedIn: boolean;
  employeeAccessPresent: boolean;
  currentSeatId: string | null | undefined;
  connected: boolean;
  agentsListPresent: boolean;
  agentsError: string | null | undefined;
  positionBotCount: number;
}): RobotRosterStatus {
  const seatId = params.currentSeatId?.trim() ?? "";
  if (params.signedIn && params.employeeAccessPresent && !seatId) {
    return "unbound";
  }
  if (params.agentsError?.trim()) {
    return "query_failed";
  }
  if (!params.agentsListPresent) {
    return params.connected && seatId ? "sync_failed" : "query_failed";
  }
  if (params.signedIn && !seatId && params.positionBotCount === 0) {
    return "unbound";
  }
  if (seatId && params.positionBotCount === 0) {
    return "zero";
  }
  return "ready";
}

export function robotRosterEmptyCopy(status: RobotRosterStatus | null | undefined): string {
  switch (status) {
    case "unbound":
      return "当前账号尚未绑定岗位。邀请已成功却没有岗位是异常，请联系管理员重新指定岗位。";
    case "query_failed":
      return "机器人列表查询失败，请稍后重试。";
    case "sync_failed":
      return "岗位已绑定，机器人列表还没有同步完成。请刷新后再看。";
    case "zero":
      return "这个岗位下还没有机器人。";
    default:
      return "还没有可管理的机器人。可在左侧 AI 助手旁创建。";
  }
}
