export interface ILockFile {
  pid: number;
  startedAt: number;
  heartbeat: number;
}

/** 单实例锁：进程可能崩溃，所以用「心跳」而不是 tasklist 判断存活 */
export const parseLock = (raw: string | null): ILockFile | null => {
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as Partial<ILockFile>;
    const pid = Number(data.pid);
    const startedAt = Number(data.startedAt);
    const heartbeat = Number(data.heartbeat ?? data.startedAt);

    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    if (!Number.isFinite(heartbeat) || heartbeat <= 0) return null;

    return { pid, startedAt, heartbeat };
  } catch {
    return null;
  }
};

export const isLockFresh = (
  lock: ILockFile | null,
  now = Date.now(),
  staleMs = 3 * 60_000,
): boolean => {
  if (!lock) return false;
  return now - lock.heartbeat >= 0 && now - lock.heartbeat < staleMs;
};
