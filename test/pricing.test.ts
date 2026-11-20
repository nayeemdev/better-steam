import { test } from "node:test";
import assert from "node:assert/strict";
import { discountPercent, ratingScore, valueScore, verdictFor } from "../src/pricing.ts";

const now = new Date("2026-11-20T00:00:00Z");
const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

test("a sale at the lowest tracked price is a buy once there is enough history", () => {
  assert.equal(verdictFor({ regular: 2000, current: 1000, lowest: 1000, trackedSince: since(60) }, now), "buy");
});

test("a sale with little history is only reported as a sale", () => {
  assert.equal(verdictFor({ regular: 2000, current: 1000, lowest: 1000, trackedSince: since(5) }, now), "sale");
});

test("a sale close to the low is a good price", () => {
  assert.equal(verdictFor({ regular: 2000, current: 1200, lowest: 1000, trackedSince: since(60) }, now), "good");
});

test("a small sale far above the low means wait", () => {
  assert.equal(verdictFor({ regular: 2000, current: 1800, lowest: 1000, trackedSince: since(60) }, now), "wait");
});

test("full price after past discounts means wait", () => {
  assert.equal(verdictFor({ regular: 2000, current: 2000, lowest: 1000, trackedSince: since(60) }, now), "wait");
});

test("never discounted needs long history, otherwise it is just full price", () => {
  assert.equal(verdictFor({ regular: 2000, current: 2000, lowest: 2000, trackedSince: since(200) }, now), "steady");
  assert.equal(verdictFor({ regular: 2000, current: 2000, lowest: 2000, trackedSince: since(20) }, now), "full");
});

test("discount percent rounds and ignores price rises", () => {
  assert.equal(discountPercent({ regular: 2999, current: 749 }), 75);
  assert.equal(discountPercent({ regular: 1000, current: 1200 }), 0);
  assert.equal(discountPercent({ regular: 0, current: 0 }), 0);
});

test("rating score pulls small review counts toward the prior", () => {
  const few = ratingScore(10, 0);
  const many = ratingScore(100_000, 2_000);
  assert.ok(few < many);
  assert.ok(Math.abs(ratingScore(0, 0) - 0.8) < 1e-9);
});

test("value score prefers better deals at equal rating", () => {
  assert.ok(valueScore(0.9, "buy", 50) > valueScore(0.9, "wait", 0));
});
