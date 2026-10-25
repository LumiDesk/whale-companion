/**
 * 写给桌面端的状态事件：一行一个 JSON，前缀固定。
 * 只有 GUI 启动时才输出，CLI 模式的日志保持干净。
 */
export const STATUS_PREFIX = "@@WHALE ";

/** 每次现读，避免 --config 合并环境变量的时机问题 */
const enabled = (): boolean => process.env.WHALE_GUI === "1";

export const reportStatus = (event: Record<string, unknown>): void => {
  if (!enabled()) return;

  process.stdout.write(
    `${STATUS_PREFIX}${JSON.stringify({ v: 1, ts: Date.now(), ...event })}\n`,
  );
};
