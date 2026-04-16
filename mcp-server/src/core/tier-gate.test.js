import test from "node:test";
import assert from "node:assert/strict";

import {
  TIER_REQUIREMENTS,
  nextLockedTier,
  summarizeTierGate,
  tierRequirements
} from "./job-catalog-service.js";

test("TIER_REQUIREMENTS exposes starter/pro/elite with ascending skill gates", () => {
  assert.deepEqual(TIER_REQUIREMENTS, {
    starter: { skill: 0 },
    pro: { skill: 100 },
    elite: { skill: 200 }
  });
  assert.deepEqual(tierRequirements("pro"), { skill: 100 });
});

test("tierRequirements falls back to starter when tier is unknown", () => {
  assert.deepEqual(tierRequirements("bogus"), { skill: 0 });
});

test("summarizeTierGate reports unlocked + empty missing when skill meets the bar", () => {
  const summary = summarizeTierGate("pro", { skill: 150, reliability: 40, economic: 0 });
  assert.equal(summary.tier, "pro");
  assert.equal(summary.unlocked, true);
  assert.deepEqual(summary.requires, { skill: 100 });
  assert.deepEqual(summary.has, { skill: 150, reliability: 40, economic: 0 });
  assert.deepEqual(summary.missing, {});
});

test("summarizeTierGate reports the precise gap when the gate is not met", () => {
  const summary = summarizeTierGate("elite", { skill: 140 });
  assert.equal(summary.unlocked, false);
  assert.deepEqual(summary.missing, { skill: 60 });
});

test("summarizeTierGate treats missing reputation inputs as zero", () => {
  const summary = summarizeTierGate("pro", {});
  assert.equal(summary.unlocked, false);
  assert.deepEqual(summary.missing, { skill: 100 });
  assert.deepEqual(summary.has, { skill: 0, reliability: 0, economic: 0 });
});

test("summarizeTierGate normalises unknown tier names to starter", () => {
  const summary = summarizeTierGate("whatever", { skill: 0 });
  assert.equal(summary.tier, "starter");
  assert.equal(summary.unlocked, true);
});

test("nextLockedTier returns the next rung a wallet has not yet earned", () => {
  // A wallet at skill=50 is starter-unlocked, pro-locked (needs 100).
  const locked = nextLockedTier({ skill: 50 });
  assert.equal(locked.tier, "pro");
  assert.deepEqual(locked.missing, { skill: 50 });
});

test("nextLockedTier returns null once every rung is unlocked", () => {
  assert.equal(nextLockedTier({ skill: 250 }), null);
});

test("nextLockedTier starts from starter when reputation is empty", () => {
  // Starter requires skill >= 0, so starter is unlocked for any wallet.
  // Pro is the first locked rung.
  const locked = nextLockedTier(undefined);
  assert.equal(locked.tier, "pro");
});
