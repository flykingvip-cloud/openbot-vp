import { createCostBudgetGateway } from "../../capability/cost-budget-billing/gateway-client.ts";
import type { ExportPositionReportRequest } from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";

export function downloadTextFile(filename: string, content: string, type = "text/plain"): void {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportPositionReportCsv(
  client: GatewayBrowserClient,
  req: ExportPositionReportRequest,
): Promise<void> {
  const gw = createCostBudgetGateway(client);
  const result = await gw.exportPositionReport(req);
  downloadTextFile(result.filename, result.content, result.contentType);
}
