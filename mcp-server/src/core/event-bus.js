const DEFAULT_EVENT_BUFFER_SIZE = 500;

export class EventBus {
  constructor({ bufferSize = DEFAULT_EVENT_BUFFER_SIZE } = {}) {
    this.bufferSize = bufferSize;
    this.buffer = [];
    this.subscribers = new Set();
  }

  subscribe(filter, handler) {
    const subscription = {
      filter: normalizeFilter(filter),
      handler
    };
    this.subscribers.add(subscription);
    return () => {
      this.subscribers.delete(subscription);
    };
  }

  publish(event) {
    const normalized = normalizeEvent(event);
    this.buffer.push(normalized);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }

    for (const subscription of this.subscribers) {
      if (matchesFilter(normalized, subscription.filter)) {
        subscription.handler(normalized);
      }
    }

    return normalized;
  }

  replay(filter = {}, lastEventId = undefined) {
    const normalizedFilter = normalizeFilter(filter);
    if (!lastEventId) {
      return {
        events: this.buffer.filter((event) => matchesFilter(event, normalizedFilter)),
        gap: false
      };
    }

    const cursorIndex = this.buffer.findIndex((event) => event.id === lastEventId);
    if (cursorIndex === -1) {
      return {
        events: this.buffer.filter((event) => matchesFilter(event, normalizedFilter)),
        gap: this.buffer.length > 0
      };
    }

    return {
      events: this.buffer.slice(cursorIndex + 1).filter((event) => matchesFilter(event, normalizedFilter)),
      gap: false
    };
  }
}

function normalizeFilter(filter = {}) {
  return {
    wallet: filter.wallet?.trim() || undefined,
    jobId: filter.jobId?.trim() || undefined,
    sessionId: filter.sessionId?.trim() || undefined,
    topics: normalizeTopics(filter.topics)
  };
}

function normalizeEvent(event) {
  const wallets = new Set(
    [event.wallet, ...(Array.isArray(event.wallets) ? event.wallets : [])]
      .map((value) => value?.trim())
      .filter(Boolean)
  );

  return {
    id: event.id,
    topic: event.topic,
    wallet: event.wallet?.trim() || undefined,
    wallets: [...wallets],
    jobId: event.jobId?.trim() || undefined,
    sessionId: event.sessionId?.trim() || undefined,
    blockNumber: event.blockNumber ?? null,
    txHash: event.txHash ?? null,
    timestamp: event.timestamp ?? new Date().toISOString(),
    data: event.data ?? {}
  };
}

function normalizeTopics(topics) {
  if (!topics) return [];
  if (Array.isArray(topics)) {
    return topics.map((topic) => String(topic).trim()).filter(Boolean);
  }
  return String(topics)
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

export function matchesFilter(event, filter = {}) {
  const topics = normalizeTopics(filter.topics);
  if (topics.length && !topics.includes(event.topic)) {
    return false;
  }

  if (filter.jobId && event.jobId !== filter.jobId) {
    return false;
  }

  if (filter.sessionId && event.sessionId !== filter.sessionId) {
    return false;
  }

  if (filter.wallet) {
    const wallets = new Set([event.wallet, ...(event.wallets ?? [])].filter(Boolean));
    if (!wallets.has(filter.wallet)) {
      return false;
    }
  }

  return true;
}
