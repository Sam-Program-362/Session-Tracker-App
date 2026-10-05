// Icon name -> SVG path data, drawn inside a 24x24 viewBox.
// Feather-style thin strokes; no emoji anywhere in the app.
export const ICONS = {
  work: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20.923V4a2 2 0 012-2h12a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2v-9",
  study: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  hobby: "M11 4a2 2 0 114 0v7c0 1.104.896 2 2 2s2-.896 2-2v-7c0-2.206-1.794-4-4-4zm4 12a2 2 0 11-4 0m4-8a2 2 0 100-4 2 2 0 000 4zm-6 8a2 2 0 11-4 0 2 2 0 014 0zm6-4a2 2 0 100-4 2 2 0 000 4z",
  ideas: "M9.663 17h9.677M9 21h6m-3.5-19.5A4.5 4.5 0 0115.5 6a4.5 4.5 0 013.5 7.5c-.6.6-.9 1.1-1 1.8v.2H6v-.2c-.1-.7-.4-1.2-1-1.8A4.5 4.5 0 018.5 6a4.5 4.5 0 013-4.5z",
  add: "M12 4v16m8-8H4",
  close: "M6 18L18 6M6 6l12 12",
  note: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 102.828 2.828L11.828 11H9v-2.828l8.586-8.586z",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  check: "M5 13l4 4L19 7",
} as const;

export type IconName = keyof typeof ICONS;

/** The icons offered when creating a custom category. */
export const PICKABLE_ICONS = [
  "work",
  "study",
  "hobby",
  "ideas",
  "clock",
  "tasks",
] as const satisfies readonly IconName[];