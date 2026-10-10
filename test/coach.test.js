import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateComparison,
  compareHealthSnapshots,
  analyzeWorkingPatterns,
  validateCitations,
  ContentCoachEngine
} from "../coach.js";

test("calculateComparison handles non-zero baseline correctly", () => {
  const result = calculateComparison(150, 100);
  assert.equal(result.current, 150);
  assert.equal(result.previous, 100);
  assert.equal(result.absoluteChange, 50);
  assert.equal(result.percentChange, 50);
});

test("calculateComparison handles zero baseline without division by zero error", () => {
  const posBaseline = calculateComparison(50, 0);
  assert.equal(posBaseline.absoluteChange, 50);
  assert.equal(posBaseline.percentChange, 100);

  const zeroBaseline = calculateComparison(0, 0);
  assert.equal(zeroBaseline.absoluteChange, 0);
  assert.equal(zeroBaseline.percentChange, 0);

  const negBaseline = calculateComparison(-10, 0);
  assert.equal(negBaseline.absoluteChange, -10);
  assert.equal(negBaseline.percentChange, -100);
});

test("compareHealthSnapshots computes comparison matrix across metrics", () => {
  const currTotals = {
    views: 1000,
    estimatedMinutesWatched: 5000,
    likes: 80,
    comments: 20,
    shares: 10,
    subscribersGained: 15,
    subscribersLost: 5
  };

  const prevTotals = {
    views: 800,
    estimatedMinutesWatched: 4000,
    likes: 60,
    comments: 10,
    shares: 5,
    subscribersGained: 10,
    subscribersLost: 2
  };

  const currRange = { startDate: "2025-02-01", endDate: "2025-02-28", days: 28 };
  const prevRange = { startDate: "2025-01-04", endDate: "2025-01-31", days: 28 };

  const snapshot = compareHealthSnapshots(currTotals, prevTotals, currRange, prevRange);

  assert.equal(snapshot.comparisons.views.absoluteChange, 200);
  assert.equal(snapshot.comparisons.views.percentChange, 25);
  assert.equal(snapshot.comparisons.netSubscribers.current, 10);
  assert.equal(snapshot.comparisons.netSubscribers.previous, 8);
  assert.equal(snapshot.comparisons.netSubscribers.absoluteChange, 2);
  assert.equal(snapshot.comparisons.netSubscribers.percentChange, 25);
});

test("analyzeWorkingPatterns identifies top videos and observable patterns without claiming causation", () => {
  const videos = [
    { video: "vid1", title: "Top Video 1", views: "5000", likes: "250", publishedAt: new Date().toISOString() },
    { video: "vid2", title: "Video 2", views: "1000", likes: "10", publishedAt: "2024-01-01T00:00:00Z" }
  ];

  const result = analyzeWorkingPatterns(videos, { views: 6000 });

  assert.equal(result.topVideos.length, 2);
  assert.equal(result.topVideos[0].id, "vid1");
  assert.equal(result.avgViewsPerVideo, 3000);
  assert.ok(result.observablePatterns.length > 0);
  assert.ok(result.observablePatterns[0].disclaimer.includes("Correlation is not causation") || result.observablePatterns[0].disclaimer.includes("Higher view count reflects"));
});

test("validateCitations keeps valid video IDs and filters invalid IDs", () => {
  const validVideos = [{ id: "v1", title: "Video 1" }, { id: "v2", title: "Video 2" }];
  const items = [
    { workingTitle: "Idea 1", citations: ["v1", "v999"] },
    { workingTitle: "Idea 2", citations: ["invalid_id"] }
  ];

  const validated = validateCitations(items, validVideos);
  assert.deepEqual(validated[0].citations, ["v1"]);
  assert.deepEqual(validated[1].citations, []);
});

test("ContentCoachEngine manages saved ideas per user channel ID securely", () => {
  const coach = new ContentCoachEngine();
  const channelA = "channel_A";
  const channelB = "channel_B";

  const idea = { id: "idea_100", workingTitle: "Test Idea 100", topicSummary: "Testing" };

  coach.saveIdea(channelA, idea);

  assert.equal(coach.getSavedIdeas(channelA).length, 1);
  assert.equal(coach.getSavedIdeas(channelA)[0].workingTitle, "Test Idea 100");

  // Verify Channel B cannot see Channel A's saved ideas
  assert.equal(coach.getSavedIdeas(channelB).length, 0);

  // Delete idea for Channel A
  coach.deleteSavedIdea(channelA, "idea_100");
  assert.equal(coach.getSavedIdeas(channelA).length, 0);
});

test("ContentCoachEngine fallback mode generates grounded heuristic ideas when unconfigured", async () => {
  const coach = new ContentCoachEngine(); // no GEMINI_API_KEY set
  assert.equal(coach.isConfigured(), false);

  const channel = { id: "chan_1", title: "Tech Channel" };
  const snapshot = { comparisons: { views: { current: 1000 } } };
  const workingPatterns = { observablePatterns: [] };
  const videos = [{ video: "v1", title: "Intro to Node.js" }];

  const res = await coach.generateContentIdeas(channel, snapshot, workingPatterns, videos);
  assert.equal(res.provider, "fallback_heuristic");
  assert.ok(res.ideas.length >= 3);
  assert.ok(res.ideas[0].workingTitle.length > 0);
});
