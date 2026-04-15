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
  const params = new URLSearchParams();
  if (wallet) params.set("wallet", wallet);
  if (sessionId) params.set("sessionId", sessionId);
  if (jobId) params.set("jobId", jobId);
  if (topics.length) params.set("topics", topics.join(","));

  const source = new EventSource(`/api/events?${params.toString()}`);

  for (const topic of EVENT_TOPICS) {
    source.addEventListener(topic, (event) => {
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
  };

  return () => {
    source.close();
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
