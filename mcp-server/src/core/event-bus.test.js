import test from "node:test";
import assert from "node:assert/strict";

import { EventBus } from "./event-bus.js";

test("EventBus replays filtered events after a cursor", () => {
  const bus = new EventBus({ bufferSize: 3 });
  const seen = [];
  bus.subscribe({ wallet: "0xabc", topics: ["session.claimed"] }, (event) => seen.push(event.id));

  bus.publish({ id: "1", topic: "session.claimed", wallet: "0xabc", timestamp: new Date().toISOString() });
  bus.publish({ id: "2", topic: "session.submitted", wallet: "0xabc", timestamp: new Date().toISOString() });
  bus.publish({ id: "3", topic: "session.claimed", wallet: "0xdef", timestamp: new Date().toISOString() });
  bus.publish({ id: "4", topic: "session.claimed", wallet: "0xabc", timestamp: new Date().toISOString() });

  assert.deepEqual(seen, ["1", "4"]);

  const replay = bus.replay({ wallet: "0xabc", topics: ["session.claimed"] }, "2");
  assert.equal(replay.gap, false);
  assert.deepEqual(
    replay.events.map((event) => event.id),
    ["4"]
  );
});

test("EventBus reports gap when cursor is outside the ring buffer", () => {
  const bus = new EventBus({ bufferSize: 2 });
  bus.publish({ id: "a", topic: "alpha", wallet: "0xabc", timestamp: new Date().toISOString() });
  bus.publish({ id: "b", topic: "beta", wallet: "0xabc", timestamp: new Date().toISOString() });
  bus.publish({ id: "c", topic: "gamma", wallet: "0xabc", timestamp: new Date().toISOString() });

  const replay = bus.replay({ wallet: "0xabc" }, "a");
  assert.equal(replay.gap, true);
  assert.deepEqual(
    replay.events.map((event) => event.id),
    ["b", "c"]
  );
});
