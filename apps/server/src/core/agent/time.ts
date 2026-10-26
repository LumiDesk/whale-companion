const pad2 = (value: number): string =>
  value < 10 ? `0${value}` : String(value);

/** 本地时间：当天只给 HH:MM，跨天补 MM-DD */
export const formatClock = (at: number, now = Date.now()): string => {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";

  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const current = new Date(now);
  const sameDay =
    current.getFullYear() === date.getFullYear() &&
    current.getMonth() === date.getMonth() &&
    current.getDate() === date.getDate();

  return sameDay
    ? clock
    : `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
};

/** 距现在多久：3s / 18m / 2h / 3d；未来时间夹到 0s */
export const formatAge = (at: number, now = Date.now()): string => {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
};

export const formatDateTime = (at: number): string =>
  new Date(at).toLocaleString("zh-CN");
