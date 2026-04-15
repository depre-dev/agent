const EVENT_TOPICS = [
  "session.claimed",
  "session.submitted",
  "verification.resolved",
  "escrow.job_funded",
  "escrow.job_claimed",
  "escrow.work_submitted",
  "escrow.job_rejected",
  "escrow.job_closed",
  "escrow.job_reopened",
  "escrow.dispute_opened",
  "account.job_stake_locked",
  "account.job_stake_released",
  "account.job_stake_slashed",
  "reputation.badge_minted",
  "reputation.updated",
  "reputation.slashed",
  "system.reconnect",
  "system.provider_error",
  "system.listener_error",
  "gap"
];

export function startEventStream({ wallet, sessionId, jobId, topics = [], onEvent, onGap, onError }) {
  let source = undefined;
  let stopped = false;
  let reconnectDelayMs = 1000;
  let reconnectTimer = undefined;
  let lastEventId = "";

  const connect = () => {
    clearTimeout(reconnectTimer);
    if (stopped) {
      return;
    }

    const params = new URLSearchParams();
    if (wallet) params.set("wallet", wallet);
    if (sessionId) params.set("sessionId", sessionId);
    if (jobId) params.set("jobId", jobId);
    if (topics.length) params.set("topics", topics.join(","));
    if (lastEventId) params.set("lastEventId", lastEventId);

    source = new EventSource(`/api/events?${params.toString()}`);

    for (const topic of EVENT_TOPICS) {
      source.addEventListener(topic, (event) => {
        if (event.lastEventId) {
          lastEventId = event.lastEventId;
        }
        reconnectDelayMs = 1000;
        const payload = parseEvent(event);
        if (topic === "gap") {
          onGap?.(payload);
          return;
        }
        onEvent?.(payload);
      });
    }

    source.onerror = (event) => {
      onError?.(event);
      source?.close();
      reconnectTimer = setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
    };
  };

  connect();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    source?.close();
  };
}

function parseEvent(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return {
      topic: event.type,
      raw: event.data
    };
  }
}
