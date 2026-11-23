import { test } from "node:test";
import assert from "node:assert/strict";
import { shareMeta } from "../src/share.ts";

const now = new Date("2026-11-23T00:00:00Z");
const base = { id: 4435490, name: "Call of Duty: Modern Warfare 4", headerPath: "0c49/header.jpg", positive: 900, negative: 100 };

test("share text includes price, discount, verdict and reviews", () => {
  const meta = shareMeta({ ...base, price: { currency: "USD", regular: 6999, current: 3499, lowest: 3499, trackedSince: "2026-11-20T00:00:00Z" } }, now);
  assert.equal(meta.title, "Call of Duty: Modern Warfare 4 on Better Steam");
  assert.equal(meta.description, "US$34.99, 50% off. On sale. 90% positive from 1,000 reviews.");
  assert.equal(meta.image, "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4435490/0c49/header.jpg");
});

test("share text still works without a price or reviews", () => {
  const meta = shareMeta({ ...base, headerPath: null, positive: 0, negative: 0, price: null }, now);
  assert.equal(meta.description, "See whether this game is worth buying today.");
  assert.ok(meta.image.endsWith("/4435490/header.jpg"));
});
