/**
 * Zero-dep Prometheus metrics registry.
 *
 * Supports counters (monotonic), gauges (set/inc/dec), and a tiny histogram
 * (count + sum, so you can compute averages; no quantiles). Emits the
 * standard Prometheus text exposition format so existing scrapers work
 * without extra dependencies.
 *
 * Kept small on purpose — if metric complexity grows past this, swap in
 * `prom-client` at the registry boundary without touching call sites.
 */

const HELP = Symbol("metrics.help");

export class MetricRegistry {
  constructor() {
    this.metrics = new Map();
  }

  counter(name, help, labelNames = []) {
    return this._register(name, help, labelNames, createCounter);
  }

  gauge(name, help, labelNames = []) {
    return this._register(name, help, labelNames, createGauge);
  }

  histogram(name, help, labelNames = []) {
    return this._register(name, help, labelNames, createHistogram);
  }

  _register(name, help, labelNames, factory) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/u.test(name)) {
      throw new Error(`Invalid metric name: ${name}`);
    }
    const existing = this.metrics.get(name);
    if (existing) {
      return existing;
    }
    const metric = factory({ name, help, labelNames });
    this.metrics.set(name, metric);
    return metric;
  }

  /** Return the full /metrics text-format payload. */
  serialize() {
    const lines = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric[HELP]}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      for (const line of metric.serialize()) {
        lines.push(line);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

function createCounter({ name, help, labelNames }) {
  const entries = new Map();
  return {
    name,
    type: "counter",
    [HELP]: help,
    inc(labels = {}, amount = 1) {
      const key = labelKey(labels, labelNames);
      entries.set(key, (entries.get(key) ?? 0) + amount);
    },
    serialize() {
      return serializeSamples(name, entries);
    }
  };
}

function createGauge({ name, help, labelNames }) {
  const entries = new Map();
  return {
    name,
    type: "gauge",
    [HELP]: help,
    set(labels, value) {
      entries.set(labelKey(labels ?? {}, labelNames), Number(value));
    },
    inc(labels = {}, amount = 1) {
      const key = labelKey(labels, labelNames);
      entries.set(key, (entries.get(key) ?? 0) + amount);
    },
    dec(labels = {}, amount = 1) {
      const key = labelKey(labels, labelNames);
      entries.set(key, (entries.get(key) ?? 0) - amount);
    },
    serialize() {
      return serializeSamples(name, entries);
    }
  };
}

/**
 * Minimal "observe once" histogram — count and sum only. Emits the
 * `_count` and `_sum` series plus a synthetic `+Inf` bucket so Prometheus
 * doesn't complain about missing buckets. Good enough for averages and
 * request-duration smoke checks; insufficient for quantile queries.
 */
function createHistogram({ name, help, labelNames }) {
  const sums = new Map();
  const counts = new Map();
  return {
    name,
    type: "histogram",
    [HELP]: help,
    observe(labels, value) {
      const key = labelKey(labels ?? {}, labelNames);
      sums.set(key, (sums.get(key) ?? 0) + Number(value));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    serialize() {
      const lines = [];
      for (const [key, count] of counts) {
        const labelSuffix = key === "" ? "" : `{${key}}`;
        lines.push(`${name}_bucket${labelSuffix ? `${labelSuffix.slice(0, -1)},le="+Inf"}` : `{le="+Inf"}`} ${count}`);
        lines.push(`${name}_count${labelSuffix} ${count}`);
        lines.push(`${name}_sum${labelSuffix} ${sums.get(key) ?? 0}`);
      }
      return lines;
    }
  };
}

function labelKey(labels, labelNames) {
  if (labelNames.length === 0) {
    return "";
  }
  const parts = [];
  for (const name of labelNames) {
    const value = labels[name];
    if (value === undefined || value === null) {
      parts.push(`${name}=""`);
    } else {
      parts.push(`${name}="${escapeLabel(String(value))}"`);
    }
  }
  return parts.join(",");
}

function escapeLabel(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
}

function serializeSamples(name, entries) {
  const lines = [];
  for (const [key, value] of entries) {
    lines.push(key === "" ? `${name} ${value}` : `${name}{${key}} ${value}`);
  }
  return lines;
}
