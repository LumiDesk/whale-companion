const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconStatus = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />
  </svg>
);

export const IconSettings = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09A1.7 1.7 0 0 0 20.95 10H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
  </svg>
);

export const IconLogs = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const IconInfo = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const IconPlay = () => (
  <svg {...base} aria-hidden="true">
    <path d="M8 5l11 7-11 7V5Z" />
  </svg>
);

export const IconPause = () => (
  <svg {...base} aria-hidden="true">
    <path d="M9 5v14M15 5v14" />
  </svg>
);

export const IconRestart = () => (
  <svg {...base} aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 4v7h-7" />
  </svg>
);

export const IconFolder = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);

export const IconEye = () => (
  <svg {...base} aria-hidden="true">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export const IconEyeOff = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 3l18 18" />
    <path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.7M6.2 7.4A17 17 0 0 0 2 12s3.5 6 10 6a10.9 10.9 0 0 0 3.2-.5" />
  </svg>
);

export const IconTrash = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12" />
  </svg>
);

export const IconCheck = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 12l5 5L20 6" />
  </svg>
);

export const IconAlert = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 9v5M12 17h.01" />
  </svg>
);

export const IconClose = () => (
  <svg {...base} aria-hidden="true">
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
);
