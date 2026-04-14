export function formatDiscordEvent(eventName: string, payload: unknown) {
  return {
    content: `[${eventName}]`,
    embeds: [
      {
        title: eventName,
        description: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

