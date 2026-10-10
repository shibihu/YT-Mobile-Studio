import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_END_LAG_DAYS,
  DAILY_METRICS,
  clampDays,
  dateRange,
  normalizeReportRows,
  sumMetricTotals
} from "../lib/metrics.js";

test("clampDays applies defaults and bounds", () => {
  assert.equal(clampDays(undefined), 28);
  assert.equal(clampDays("not-a-number"), 28);
  assert.equal(clampDays(0), 7);
  assert.equal(clampDays(-5), 7);
  assert.equal(clampDays(3), 7);
  assert.equal(clampDays(28), 28);
  assert.equal(clampDays(90), 90);
  assert.equal(clampDays(500), 90);
});

test("dateRange ends two days before today and keeps the requested day count", () => {
  const now = new Date("2026-01-30T12:00:00Z");
  const range = dateRange(28, now);
  assert.equal(range.endDate, "2026-01-28");
  assert.equal(range.startDate, "2026-01-01");
  assert.equal(range.days, 28);
  assert.equal(range.endLagDays, ANALYTICS_END_LAG_DAYS);

  const start = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  const inclusiveDays = Math.round((end - start) / 86400000) + 1;
  assert.equal(inclusiveDays, 28);
});

test("dateRange clamps invalid day input and handles month boundaries", () => {
  const now = new Date("2026-03-02T00:00:00Z");
  const range = dateRange("garbage", now);
  assert.equal(range.days, 28);
  assert.equal(range.endDate, "2026-02-28");
  assert.equal(range.startDate, "2026-02-01");

  const clamped = dateRange(400, now);
  assert.equal(clamped.days, 90);
  assert.equal(clamped.startDate, "2025-12-01");
});

test("normalizeReportRows maps rows onto headers", () => {
  const { headers, rows } = normalizeReportRows(
    [{ name: "day" }, { name: "views" }, { name: "likes" }],
    [["2026-01-01", 10, 2], ["2026-01-02", 5, 1]]
  );
  assert.deepEqual(headers, ["day", "views", "likes"]);
  assert.deepEqual(rows, [
    { day: "2026-01-01", views: 10, likes: 2 },
    { day: "2026-01-02", views: 5, likes: 1 }
  ]);
});

test("normalizeReportRows returns empty output when headers are missing", () => {
  assert.deepEqual(normalizeReportRows(undefined, [[1, 2]]), { headers: [], rows: [] });
  assert.deepEqual(normalizeReportRows([], [["2026-01-01", 3]]), { headers: [], rows: [] });
  assert.deepEqual(normalizeReportRows([{ name: "day" }], undefined), { headers: ["day"], rows: [] });
});

test("sumMetricTotals aggregates numeric rows", () => {
  const rows = [
    { views: 10, estimatedMinutesWatched: "25", likes: 2 },
    { views: 5, estimatedMinutesWatched: 10, likes: 0 },
    { views: 0, estimatedMinutesWatched: 0, likes: 1 }
  ];
  const totals = sumMetricTotals(rows, ["views", "estimatedMinutesWatched", "likes"]);
  assert.equal(totals.views, 15);
  assert.equal(totals.estimatedMinutesWatched, 35);
  assert.equal(totals.likes, 3);
});

test("sumMetricTotals returns null for metrics the API did not return", () => {
  const rows = [{ views: 7 }];
  const totals = sumMetricTotals(rows, ["views", "comments", "shares"]);
  assert.equal(totals.views, 7);
  assert.equal(totals.comments, null);
  assert.equal(totals.shares, null);
});

test("sumMetricTotals keeps genuine zeros and skips null cells", () => {
  const rows = [{ views: 0, likes: null, comments: "" }];
  const totals = sumMetricTotals(rows, ["views", "likes", "comments"]);
  assert.equal(totals.views, 0, "a real 0 must not become null");
  assert.equal(totals.likes, null, "all-null cells mean unavailable, not zero");
  assert.equal(totals.comments, null);
});

test("sumMetricTotals ignores non-numeric cells", () => {
  const rows = [{ views: 12 }, { views: "n/a" }, { views: NaN }, { views: null }];
  const totals = sumMetricTotals(rows, ["views"]);
  assert.equal(totals.views, 12);
});

test("sumMetricTotals returns null for every metric when there are no rows", () => {
  const totals = sumMetricTotals([], DAILY_METRICS);
  for (const metric of DAILY_METRICS) {
    assert.equal(totals[metric], null, `${metric} must be unavailable, not 0`);
  }
  assert.deepEqual(sumMetricTotals(undefined, DAILY_METRICS), totals);
});

test("daily report pipeline distinguishes missing metric from zero metric", () => {
  // Simulates an Analytics response where subscribersLost was not returned.
  const columnHeaders = [
    { name: "day", dataType: "STRING" },
    { name: "views", dataType: "INTEGER" },
    { name: "subscribersGained", dataType: "INTEGER" }
  ];
  const apiRows = [["2026-01-27", 0, 3], ["2026-01-28", 4, 0]];
  const { headers, rows } = normalizeReportRows(columnHeaders, apiRows);
  const totals = sumMetricTotals(rows, DAILY_METRICS);

  assert.equal(totals.views, 4, "0-view days are real data and still sum");
  assert.equal(totals.subscribersGained, 3);
  assert.equal(totals.subscribersLost, null, "metric absent from headers stays null");
  assert.equal(totals.likes, null);
  assert.ok(headers.includes("day"));
  assert.equal(rows.length, 2);
});
