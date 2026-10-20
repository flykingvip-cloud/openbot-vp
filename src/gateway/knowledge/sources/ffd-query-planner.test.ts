import { describe, expect, it } from "vitest";
import { planFfdQuery } from "./ffd-query-planner.js";

describe("planFfdQuery", () => {
  it("plans a minimal historical query", () => {
    expect(planFfdQuery("查询 600519.SH 在 2026-06-01 的收盘价和成交量")).toEqual({
      method: "POST",
      path: "/api/query",
      body: {
        function: "history",
        codes: "600519.SH",
        indicators: "close,volume",
        start_date: "2026-06-01",
        end_date: "2026-06-01",
        options: "CPS:1",
      },
    });
  });

  it("routes five-minute data to intraday", () => {
    expect(planFfdQuery("查询 600519.SH 2026-06-26 的5分钟收盘价")?.body).toMatchObject({
      function: "intraday",
      params: "Fill:Previous,Interval:5",
      start_date: "2026-06-26 09:30:00",
      end_date: "2026-06-26 15:00:00",
    });
  });

  it("does not guess a historical date", () => {
    expect(planFfdQuery("查询 600519.SH 历史收盘价")).toBeNull();
  });
});
