import type { PositionAttributionResult } from "./position-attribution.ts";

type DailyRow = {
  date: string;
  orgSeatId: string;
  positionTitle: string;
  teamLabel: string;
  agentId: string;
  usageQuantity: number;
  usageCostCents: number;
};

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toCsvRow(values: Array<string | number | undefined | null>): string {
  return values
    .map((value) => {
      if (value === undefined || value === null) {
        return "";
      }
      return csvEscape(String(value));
    })
    .join(",");
}

export function formatPositionSummaryCsv(
  attribution: PositionAttributionResult,
  options: { dataSource: string; includeSessionEstimate?: boolean },
): string {
  const rows = [
    toCsvRow([
      "cycleStart",
      "cycleEnd",
      "dataSource",
      "teamLabel",
      "positionTitle",
      "orgSeatId",
      "memberUserId",
      "billingRole",
      "seatCostCents",
      "usageCostCents",
      "totalCostCents",
      "usageQuantity",
      "agentId",
      "agentUsageQuantity",
      "agentUsageCostCents",
      "unallocatedUsageQuantity",
      "unallocatedUsageCostCents",
    ]),
  ];

  for (const position of attribution.rows) {
    if (position.agents.length === 0) {
      rows.push(
        toCsvRow([
          attribution.cycleStart,
          attribution.cycleEnd,
          options.dataSource,
          position.teamLabel,
          position.positionTitle,
          position.orgSeatId,
          position.memberUserId ?? "",
          position.billingRole ?? "",
          position.seatCostCents,
          position.usageCostCents,
          position.totalCostCents,
          position.usageQuantity,
          "",
          "",
          "",
          position.unallocatedAgentUsageQuantity,
          position.unallocatedAgentUsageCostCents,
        ]),
      );
      continue;
    }
    for (const agent of position.agents) {
      rows.push(
        toCsvRow([
          attribution.cycleStart,
          attribution.cycleEnd,
          options.dataSource,
          position.teamLabel,
          position.positionTitle,
          position.orgSeatId,
          position.memberUserId ?? "",
          position.billingRole ?? "",
          position.seatCostCents,
          position.usageCostCents,
          position.totalCostCents,
          position.usageQuantity,
          agent.agentId,
          agent.usageQuantity,
          agent.usageCostCents,
          position.unallocatedAgentUsageQuantity,
          position.unallocatedAgentUsageCostCents,
        ]),
      );
    }
  }

  return rows.join("\n");
}

export function formatPositionDailyCsv(
  dailyRows: DailyRow[],
  cycleStart: string,
  cycleEnd: string,
  dataSource: string,
): string {
  const rows = [
    toCsvRow([
      "cycleStart",
      "cycleEnd",
      "dataSource",
      "date",
      "teamLabel",
      "positionTitle",
      "orgSeatId",
      "agentId",
      "usageQuantity",
      "usageCostCents",
    ]),
  ];
  for (const entry of dailyRows) {
    rows.push(
      toCsvRow([
        cycleStart,
        cycleEnd,
        dataSource,
        entry.date,
        entry.teamLabel,
        entry.positionTitle,
        entry.orgSeatId,
        entry.agentId,
        entry.usageQuantity,
        entry.usageCostCents,
      ]),
    );
  }
  return rows.join("\n");
}
