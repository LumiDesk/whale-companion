export type BotState = "stopped" | "starting" | "running" | "crashed";

export const isBotActive = (state: string): boolean =>
  state === "running" || state === "starting";

export interface IAutoRestartState {
  count: number;
  lastAt: number;
}

export type AutoRestartDecision =
  | { kind: "none" }
  | { kind: "give-up" }
  | { kind: "restart"; count: number; wait: number; lastAt: number };

const RESTART_WAITS = [3000, 10_000, 30_000] as const;
const RESET_AFTER_MS = 10 * 60_000;
const MAX_RESTARTS = 3;

/**
 * 崩溃自动重启策略：只处理“非正常退出 + 开关打开”，
 * 10 分钟内最多 3 次，间隔 3s / 10s / 30s。
 */
export const decideAutoRestart = (
  state: IAutoRestartState,
  input: {
    wasStopping: boolean;
    code: number;
    enabled: boolean;
  },
  now = Date.now(),
): AutoRestartDecision => {
  if (
    input.wasStopping ||
    !input.enabled ||
    !Number.isFinite(input.code) ||
    input.code === 0
  ) {
    return { kind: "none" };
  }

  const count = now - state.lastAt > RESET_AFTER_MS ? 0 : state.count;
  if (count >= MAX_RESTARTS) {
    return { kind: "give-up" };
  }

  const next = count + 1;
  return {
    kind: "restart",
    count: next,
    wait: RESTART_WAITS[Math.min(next - 1, RESTART_WAITS.length - 1)],
    lastAt: now,
  };
};
