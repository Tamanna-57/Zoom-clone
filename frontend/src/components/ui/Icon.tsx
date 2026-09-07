/**
 * Hand-rolled 24x24 stroke icon set.
 *
 * Kept inline (rather than pulling an icon package) so the meeting toolbar can
 * animate strokes and swap "slashed" variants without a second dependency.
 */
export type IconName =
  | "video" | "video-off" | "mic" | "mic-off" | "screen" | "chat" | "people" | "record"
  | "smile" | "more" | "hangup" | "hand" | "settings" | "search" | "plus" | "calendar"
  | "clock" | "star" | "link" | "copy" | "trash" | "close" | "chevron-down" | "chevron-right"
  | "sparkles" | "check" | "home" | "sun" | "moon" | "grid" | "spotlight" | "shield" | "bell"
  | "monitor" | "play" | "download" | "pencil" | "logout" | "lock" | "info" | "wave" | "arrow-left"
  | "phone" | "user-plus" | "film" | "list" | "pin";

const PATHS: Record<IconName, React.ReactNode> = {
  video: <><rect x="2" y="6" width="13" height="12" rx="2.5" /><path d="M15 10.5 22 7v10l-7-3.5z" /></>,
  "video-off": <><path d="M15 10.5 22 7v10l-4-2" /><path d="M12.5 6H4.5A2.5 2.5 0 0 0 2 8.5v7A2.5 2.5 0 0 0 4.5 18h9" /><path d="m3 3 18 18" /></>,
  mic: <><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></>,
  "mic-off": <><path d="M15 5.5A3 3 0 0 0 9 5.5v4M9 12.5A3 3 0 0 0 15 12v-1" /><path d="M5 11a7 7 0 0 0 10.5 6M19 11a7 7 0 0 1-.6 2.8" /><path d="M12 18v3M8.5 21h7M3 3l18 18" /></>,
  screen: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.4A8 8 0 1 1 21 12z" /></>,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.3a3.2 3.2 0 0 1 0 5.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  record: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
  hangup: <><path d="M2.5 14.5c5-5 14-5 19 0l-2 2.5-3.5-1v-2.6a13 13 0 0 0-8 0V16l-3.5 1z" /></>,
  hand: <><path d="M9 11V4.8a1.4 1.4 0 0 1 2.8 0V11M11.8 10.5V3.8a1.4 1.4 0 0 1 2.8 0v6.7M14.6 11V5.8a1.4 1.4 0 0 1 2.8 0V14a7 7 0 0 1-7 7 6 6 0 0 1-4.4-1.9L3 15.4a1.5 1.5 0 0 1 2.2-2L9 17" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 14H3.7a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 5 7.2l-.1-.1A2 2 0 1 1 7.7 4.3l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.9 1z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" /></>,
  star: <><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.2 6.4" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0L5 12.6a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  sparkles: <><path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 16l-1.7-4.6L5.8 9.7 10.3 8z" /><path d="M18.5 15.5 19.3 18l2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8zM5 2.5l.6 1.7 1.6.6-1.6.6L5 7.2l-.6-1.8-1.6-.6 1.6-.6z" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  home: <><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  grid: <><rect x="3" y="4" width="7.5" height="7" rx="1.4" /><rect x="13.5" y="4" width="7.5" height="7" rx="1.4" /><rect x="3" y="13" width="7.5" height="7" rx="1.4" /><rect x="13.5" y="13" width="7.5" height="7" rx="1.4" /></>,
  spotlight: <><rect x="3" y="4" width="18" height="11" rx="1.6" /><rect x="3" y="17" width="5" height="4" rx="1" /><rect x="9.5" y="17" width="5" height="4" rx="1" /><rect x="16" y="17" width="5" height="4" rx="1" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.3-7.5 9.5-4.4-1.2-7.5-4.9-7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6z" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></>,
  monitor: <><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8.5 21h7M12 16.5V21" /></>,
  play: <path d="M8 5.5 18.5 12 8 18.5z" />,
  download: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V18" /></>,
  pencil: <><path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m14.5 5.5 4 4" /></>,
  logout: <><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 8 6 12l4 4M6 12h10" /></>,
  lock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  wave: <><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" /></>,
  "arrow-left": <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  phone: <><path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3A2.5 2.5 0 0 1 17.3 19 15 15 0 0 1 5 6.7 2.5 2.5 0 0 1 6.5 3z" /></>,
  "user-plus": <><circle cx="9.5" cy="8" r="3.4" /><path d="M3 20a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6" /></>,
  film: <><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><path d="M7 4.5v15M17 4.5v15M2.5 12h19M2.5 8.2h4.5M2.5 15.8h4.5M17 8.2h4.5M17 15.8h4.5" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  pin: <><path d="M15 3 21 9l-3.5 1.5-4 4L12 21l-2-5.5L4.5 13l6.5-1.5L15 8z" /></>,
};

export function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
