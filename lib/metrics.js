// Pure helpers for YouTube Analytics report handling.
// Kept free of googleapis/express so they can be unit tested directly.

// YouTube Analytics reports lag real time. We end the range this many days
// before "today" so recent (incomplete) days are not presented as final.
export const ANALYTICS_END_LAG_DAYS = 2;

export const DEFAULT_DAYS = 28;
export const MIN_DAYS = 7;
export const MAX_DAYS = 90;

export const DAILY_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost"
];

export const VIDEO_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "likes",
  "comments",
  "shares",
  "subscribersGained"
];

export function clampDays(input) {
  const days = Number.parseInt(input, 10);
  if (!Number.isFinite(days)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, days));
}

export function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

export function dateRange(daysInput, now = new Date()) {
  const days = clampDays(daysInput);
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() - ANALYTICS_END_LAG_DAYS);
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    startDate: formatDateUTC(start),
    endDate: formatDateUTC(end),
    days,
    endLagDays: ANALYTICS_END_LAG_DAYS
  };
}

export function normalizeReportRows(columnHeaders, rows) {
  const headers = (columnHeaders ?? [])
    .map((header) => header?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
  if (headers.length === 0) return { headers: [], rows: [] };
  const source = Array.isArray(rows) ? rows : [];
  return {
    headers,
    rows: source.map((row) =>
      Object.fromEntries(headers.map((name, index) => [name, Array.isArray(row) ? row[index] : undefined]))
    )
  };
}

// Sums numeric cells per metric. Returns null when the metric was not
// returned by the API (or no numeric cell was seen), so callers can show
// "unavailable" instead of a fabricated 0. A genuine all-zero report keeps 0.
export function sumMetricTotals(rows, metrics) {
  const source = Array.isArray(rows) ? rows : [];
  const totals = {};
  for (const metric of metrics) {
    let sum = 0;
    let seen = false;
    for (const row of source) {
      const raw = row?.[metric];
      if (raw == null || raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      sum += value;
      seen = true;
    }
    totals[metric] = seen ? sum : null;
  }
  return totals;
}
