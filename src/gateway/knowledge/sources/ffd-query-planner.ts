export type FfdQueryPlan = {
  method: "POST";
  path: "/api/query";
  body: Record<string, string>;
};

function extractCode(query: string): string | null {
  const qualified = query.match(/\b(\d{6}\.(?:SH|SZ|BJ))\b/i)?.[1];
  if (qualified) {
    return qualified.toUpperCase();
  }
  const bare = query.match(/(?:^|\D)(\d{6})(?:\D|$)/)?.[1];
  if (!bare) {
    return null;
  }
  if (bare.startsWith("6")) {
    return `${bare}.SH`;
  }
  if (bare.startsWith("0") || bare.startsWith("3")) {
    return `${bare}.SZ`;
  }
  if (bare.startsWith("4") || bare.startsWith("8")) {
    return `${bare}.BJ`;
  }
  return null;
}

function extractDates(query: string): string[] {
  return [...query.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
}

function priceIndicators(query: string, intraday: boolean): string {
  const fields: string[] = [];
  const mappings: Array<[RegExp, string]> = [
    [/开盘|open/i, "open"],
    [/最高|high/i, "high"],
    [/最低|low/i, "low"],
    [/收盘|close/i, "close"],
    [/成交量|volume/i, "volume"],
    [/成交额|amount|\bamt\b/i, intraday ? "amount" : "amt"],
  ];
  for (const [pattern, field] of mappings) {
    if (pattern.test(query)) {
      fields.push(field);
    }
  }
  return [...new Set(fields.length ? fields : ["close"])].join(",");
}

export function planFfdQuery(query: string): FfdQueryPlan | null {
  const code = extractCode(query);
  if (!code) {
    return null;
  }
  const dates = extractDates(query);
  const isIntraday = /分钟|分时|intraday|[15]\s*分钟/i.test(query);
  const isRealtime = /实时|最新价|快照|realtime/i.test(query);

  if (isRealtime) {
    return {
      method: "POST",
      path: "/api/query",
      body: {
        function: "realtime_quote",
        codes: code,
        indicators: "latest;changeRatio;volume;amount",
      },
    };
  }
  if (dates.length === 0) {
    return null;
  }
  if (isIntraday) {
    const interval = /5\s*分钟/i.test(query) ? "5" : "1";
    const start = `${dates[0]} 09:30:00`;
    const end = `${dates[1] ?? dates[0]} 15:00:00`;
    return {
      method: "POST",
      path: "/api/query",
      body: {
        function: "intraday",
        codes: code,
        indicators: priceIndicators(query, true),
        start_date: start,
        end_date: end,
        params: `Fill:Previous,Interval:${interval}`,
      },
    };
  }
  const adjust = /前复权/.test(query) ? "CPS:2" : /后复权/.test(query) ? "CPS:3" : "CPS:1";
  return {
    method: "POST",
    path: "/api/query",
    body: {
      function: "history",
      codes: code,
      indicators: priceIndicators(query, false),
      start_date: dates[0],
      end_date: dates[1] ?? dates[0],
      options: adjust,
    },
  };
}
