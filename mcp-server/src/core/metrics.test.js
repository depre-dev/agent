import test from "node:test";
import assert from "node:assert/strict";

import { MetricRegistry } from "./metrics.js";

test("counter inc and serialise emits HELP + TYPE + sample", () => {
  const registry = new MetricRegistry();
  const counter = registry.counter("http_requests_total", "Total HTTP requests.", ["status"]);
  counter.inc({ status: "200" });
  counter.inc({ status: "200" });
  counter.inc({ status: "500" }, 3);
  const output = registry.serialize();
  assert.match(output, /# HELP http_requests_total Total HTTP requests\./);
  assert.match(output, /# TYPE http_requests_total counter/);
  assert.match(output, /http_requests_total\{status="200"\} 2/);
  assert.match(output, /http_requests_total\{status="500"\} 3/);
});

test("gauge set/inc/dec serialise correctly", () => {
  const registry = new MetricRegistry();
  const gauge = registry.gauge("sse_active_connections", "Open SSE connections.");
  gauge.inc();
  gauge.inc();
  gauge.dec();
  gauge.set(undefined, 7);
  const output = registry.serialize();
  assert.match(output, /sse_active_connections 7/);
});

test("histogram exposes _count and _sum", () => {
  const registry = new MetricRegistry();
  const histogram = registry.histogram("latency_ms", "Request latency.", ["path"]);
  histogram.observe({ path: "/jobs" }, 10);
  histogram.observe({ path: "/jobs" }, 20);
  histogram.observe({ path: "/health" }, 5);
  const output = registry.serialize();
  assert.match(output, /latency_ms_count\{path="\/jobs"\} 2/);
  assert.match(output, /latency_ms_sum\{path="\/jobs"\} 30/);
  assert.match(output, /latency_ms_count\{path="\/health"\} 1/);
});

test("metric names are validated", () => {
  const registry = new MetricRegistry();
  assert.throws(() => registry.counter("bad name", "desc"), /Invalid metric name/);
});

test("label values are Prometheus-escaped", () => {
  const registry = new MetricRegistry();
  const counter = registry.counter("weird", "desc", ["label"]);
  counter.inc({ label: 'a"b\\c' });
  const output = registry.serialize();
  assert.match(output, /weird\{label="a\\"b\\\\c"\} 1/);
});

test("re-registering the same metric returns the existing instance", () => {
  const registry = new MetricRegistry();
  const a = registry.counter("foo", "help", []);
  const b = registry.counter("foo", "help", []);
  assert.strictEqual(a, b);
});
