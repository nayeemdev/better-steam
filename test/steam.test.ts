import { test } from "node:test";
import assert from "node:assert/strict";
import { profilePath } from "../src/steam.ts";

test("profile links, IDs and custom names resolve to a profile path", () => {
  assert.equal(profilePath("https://steamcommunity.com/profiles/76561197960287930/"), "profiles/76561197960287930");
  assert.equal(profilePath("76561197960287930"), "profiles/76561197960287930");
  assert.equal(profilePath("https://steamcommunity.com/id/gabelogannewell/games"), "id/gabelogannewell");
  assert.equal(profilePath("  gabelogannewell "), "id/gabelogannewell");
});

test("anything else is rejected", () => {
  assert.equal(profilePath(""), null);
  assert.equal(profilePath("https://example.com/some page"), null);
  assert.equal(profilePath("a"), null);
});
