import test from "node:test";
import assert from "node:assert/strict";

import { _resetConfigCacheForTests, apiUrl, getConfig } from "./config.js";

function withGlobalWindow(config, fn) {
  const hadWindow = typeof globalThis.window !== "undefined";
  const previous = globalThis.window;
  globalThis.window = { __AVERRAY_CONFIG__: config };
  _resetConfigCacheForTests();
  try {
    return fn();
  } finally {
    if (hadWindow) {
      globalThis.window = previous;
    } else {
      delete globalThis.window;
    }
    _resetConfigCacheForTests();
  }
}

test("getConfig returns defaults when window.__AVERRAY_CONFIG__ is absent", () => {
  _resetConfigCacheForTests();
  const config = getConfig();
  assert.equal(config.apiBaseUrl, "/api");
  assert.equal(config.sentryDsn, "");
  assert.equal(config.chainId, 0);
  assert.equal(config.debug, false);
});

test("getConfig normalises and trims the apiBaseUrl", () => {
  withGlobalWindow({ apiBaseUrl: "https://api.example.com/" }, () => {
    assert.equal(getConfig().apiBaseUrl, "https://api.example.com");
  });
});

test("getConfig falls back to /api when apiBaseUrl is empty string", () => {
  withGlobalWindow({ apiBaseUrl: "" }, () => {
    assert.equal(getConfig().apiBaseUrl, "/api");
  });
});

test("apiUrl joins paths against the configured base", () => {
  withGlobalWindow({ apiBaseUrl: "https://api.example.com" }, () => {
    assert.equal(apiUrl("/jobs"), "https://api.example.com/jobs");
    assert.equal(apiUrl("jobs"), "https://api.example.com/jobs");
    assert.equal(apiUrl(""), "https://api.example.com");
  });
});

test("getConfig clamps sentryTracesSampleRate into [0, 1]", () => {
  withGlobalWindow({ sentryTracesSampleRate: 5 }, () => {
    assert.equal(getConfig().sentryTracesSampleRate, 1);
  });
  withGlobalWindow({ sentryTracesSampleRate: -1 }, () => {
    assert.equal(getConfig().sentryTracesSampleRate, 0);
  });
});

test("getConfig ignores non-integer chain ids", () => {
  withGlobalWindow({ chainId: "abc" }, () => {
    assert.equal(getConfig().chainId, 0);
  });
  withGlobalWindow({ chainId: 420420418 }, () => {
    assert.equal(getConfig().chainId, 420420418);
  });
});
