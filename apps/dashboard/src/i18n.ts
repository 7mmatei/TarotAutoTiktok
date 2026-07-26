export const messages = {
  "en-US": {
    title: "LIVE Reading Control Room",
    subtitle: "Local operations · entertainment and personal reflection",
    status: "Status",
    queue: "Paid queue",
    awaiting: "Awaiting question",
    current: "Current reading",
    events: "Recent events",
    start: "Start session",
    pause: "Pause playback",
    resume: "Resume playback",
    empty: "Nothing pending",
    completed: "completed",
    questionWindow: "120-second window",
    users: "users",
    viewerQuestion: "Waiting for the viewer's next question",
    safe: "Readings are for entertainment and personal reflection. They do not replace medical, psychological, legal, or financial advice."
  }
} as const;

export type Locale = keyof typeof messages;
