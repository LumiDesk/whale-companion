import { config } from "../config.js";
import { askModel } from "./llm.js";
import { buildSystem } from "./prompt.js";
import { parseReply } from "./reply.js";
import { loadHistory, saveHistory } from "../store/history.js";
import {
  clearNextWake,
  listUsers,
  markProactive,
  proactiveCountFor,
  recordReply,
} from "../store/users.js";
import { slog } from "../util.js";

/** 由组合根注入：跑一个 proactive 回合，返回是否真的发出消息 */
export type ProactiveRunner = (
  userId: string,
  intent: string,
  afterMinutes: number,
  allowSilent: boolean,
) => Promise<boolean>;

const inQuietHours = (hour: number): boolean => {
  const { quietStart, quietEnd } = config.proactive;
  return quietStart > quietEnd
    ? hour >= quietStart || hour < quietEnd
    : hour >= quietStart && hour < quietEnd;
};

let running = false;

const pickDueWake = (now: number) =>
  listUsers()
    .filter(
      (user) =>
        user.channel === "qq" &&
        typeof user.nextWakeAt === "number" &&
        user.nextWakeAt <= now &&
        now - user.nextWakeAt < 24 * 60 * 60 * 1000,
    )
    .sort((a, b) => (a.nextWakeAt ?? 0) - (b.nextWakeAt ?? 0))[0];

const pickIdleUser = (now: number, today: Date) =>
  listUsers()
    .filter(
      (user) =>
        user.channel === "qq" &&
        now - user.lastSeen > config.proactive.minIdleMs &&
        now - user.lastSeen < config.proactive.maxIdleDays * 86_400_000 &&
        proactiveCountFor(user, today) < config.proactive.maxPerDay,
    )
    .sort((a, b) => b.lastSeen - a.lastSeen)[0];

const runDueWake = async (
  run: ProactiveRunner,
  now: number,
): Promise<boolean> => {
  const user = pickDueWake(now);
  if (!user) return false;

  const today = new Date(now);

  if (inQuietHours(today.getHours())) return true;

  if (proactiveCountFor(user, today) >= config.proactive.maxPerDay) {
    clearNextWake(user.userId, "qq");
    slog(`主动消息达到今日上限，清掉 ${user.userId.slice(0, 8)} 的唤醒`);
    return true;
  }

  if (now - user.lastSeen > config.proactive.maxIdleDays * 86_400_000) {
    clearNextWake(user.userId, "qq");
    slog(`主动消息超过最长闲置，清掉 ${user.userId.slice(0, 8)} 的唤醒`);
    return true;
  }

  const elapsed = Math.max(
    0,
    Math.round((now - (user.nextWakeAt ?? now)) / 60_000),
  );
  const afterMinutes = Math.max(0, elapsed);

  running = true;
  try {
    const sent = await run(
      user.userId,
      user.wakeIntent ?? "想找他说说话",
      afterMinutes,
      user.wakeAllowSilent ?? true,
    );

    clearNextWake(user.userId, "qq");
    if (sent) {
      markProactive(user.userId, "qq", today);
      slog(`主动消息已发出（${user.userId.slice(0, 8)}）`);
    } else {
      slog(`主动消息这次选择不说（${user.userId.slice(0, 8)}）`);
    }
  } catch (e) {
    slog("主动消息失败（平台可能不允许主动推送）", e);
    clearNextWake(user.userId, "qq");
  } finally {
    running = false;
  }

  return true;
};

const runIdleFallback = async (
  run: ProactiveRunner,
  now: number,
): Promise<void> => {
  const today = new Date(now);
  if (inQuietHours(today.getHours())) return;

  const user = pickIdleUser(now, today);
  if (!user) return;

  running = true;
  try {
    const sent = await run(
      user.userId,
      "他有一阵子没说话了，可以主动打个招呼，分享一件刚想到的小事",
      0,
      false,
    );

    if (sent) {
      markProactive(user.userId, "qq", today);
      slog("主动打招呼成功");
    }
  } catch (e) {
    slog("主动消息失败（平台可能不允许主动推送）", e);
  } finally {
    running = false;
  }
};

const tick = async (run: ProactiveRunner): Promise<void> => {
  if (running) return;

  const now = Date.now();

  try {
    if (await runDueWake(run, now)) return;
    await runIdleFallback(run, now);
  } catch (e) {
    slog("主动消息检查失败", e);
  }
};

/** 测试/手动触发用：跑一次调度检查 */
export const runProactiveNow = (run: ProactiveRunner): Promise<void> =>
  tick(run);

/** 旧路径：无 Agent 时的一次性主动消息 */
const legacyProactive = async (
  userId: string,
  hours: number,
): Promise<boolean> => {
  const system = buildSystem(userId);
  const raw = await askModel([
    { role: "system", content: system },
    {
      role: "user",
      content:
        `现在是 ${new Date().toLocaleString("zh-CN")}。${config.persona.ownerName}已经 ${hours} 小时没说话了。` +
        "用一句你自己的话主动打个招呼，可以分享你刚想到的小事。" +
        "不要说“系统”“推送”“有什么可以帮你”这类词，一句话就够。",
    },
  ]);

  const text = parseReply(raw).text;
  if (!text) return false;

  const { sendC2CProactive } = await import("../channels/qq/send.js");
  const { getAccessToken } = await import("../channels/qq/token.js");
  const token = await getAccessToken();
  await sendC2CProactive(userId, token, text);
  recordReply(userId);

  saveHistory(userId, [
    ...loadHistory(userId),
    { role: "assistant", content: text },
  ]);
  return true;
};

const runLegacyFallback = async (now: number): Promise<void> => {
  const today = new Date(now);
  if (inQuietHours(today.getHours())) return;

  const user = pickIdleUser(now, today);
  if (!user) return;

  running = true;
  try {
    const hours = Math.round((now - user.lastSeen) / 3_600_000);
    const sent = await legacyProactive(user.userId, hours);
    if (sent) {
      markProactive(user.userId, "qq", today);
      slog("主动打招呼成功");
    }
  } catch (e) {
    slog("主动消息失败（平台可能不允许主动推送）", e);
  } finally {
    running = false;
  }
};

/** 启动主动消息调度；平台不允许时只会打日志，不影响其他功能 */
export const startProactive = (run: ProactiveRunner): void => {
  if (!config.proactive.enabled) {
    slog("主动消息已关闭");
    return;
  }

  if (!config.agent.enabled) {
    const timer = setInterval(() => {
      if (running) return;
      void runLegacyFallback(Date.now());
    }, config.proactive.intervalMs);
    timer.unref?.();
    slog(
      `主动消息（旧路径）已开启：每 ${Math.round(config.proactive.intervalMs / 60_000)} 分钟检查一次，` +
        `免打扰 ${config.proactive.quietStart}:00-${config.proactive.quietEnd}:00`,
    );
    return;
  }

  // 兜底：闲置最久的用户；显式 wake 另用 60 秒精查
  const timer = setInterval(() => {
    void tick(run);
  }, config.proactive.intervalMs);
  timer.unref?.();

  const wakeTimer = setInterval(() => {
    if (running) return;
    void runDueWake(run, Date.now());
  }, 60_000);
  wakeTimer.unref?.();

  slog(
    `主动消息已开启：每 ${Math.round(config.proactive.intervalMs / 60_000)} 分钟检查一次，` +
      `显式唤醒每 60 秒检查；免打扰 ${config.proactive.quietStart}:00-${config.proactive.quietEnd}:00`,
  );
};
