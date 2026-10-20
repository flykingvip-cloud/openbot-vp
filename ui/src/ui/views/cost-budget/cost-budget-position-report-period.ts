export type PositionReportPeriodPreset = "cycle" | "7d" | "30d" | "custom";

export function resolvePositionReportWindow(args: {
  preset: PositionReportPeriodPreset;
  cycleStart?: string | null;
  cycleEnd?: string | null;
  customStart?: string;
  customEnd?: string;
}): { startTime: string; endTime: string } {
  const now = new Date();
  if (args.preset === "custom" && args.customStart && args.customEnd) {
    return {
      startTime: new Date(args.customStart).toISOString(),
      endTime: new Date(args.customEnd).toISOString(),
    };
  }
  if (args.preset === "7d") {
    return {
      startTime: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endTime: now.toISOString(),
    };
  }
  if (args.preset === "30d") {
    return {
      startTime: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endTime: now.toISOString(),
    };
  }
  const cycleEnd = args.cycleEnd ? new Date(args.cycleEnd) : now;
  let cycleStart = args.cycleStart ? new Date(args.cycleStart) : new Date(cycleEnd);
  if (!args.cycleStart) {
    cycleStart = new Date(
      Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth(), 1, 0, 0, 0, 0),
    );
  }
  if (cycleEnd.getTime() <= cycleStart.getTime()) {
    cycleEnd.setTime(cycleStart.getTime() + 24 * 60 * 60 * 1000);
  }
  return {
    startTime: cycleStart.toISOString(),
    endTime: cycleEnd.toISOString(),
  };
}

export function formatReportPeriodLabel(startTime: string, endTime: string): string {
  const start = startTime.slice(0, 10);
  const end = endTime.slice(0, 10);
  return `${start} — ${end}`;
}
