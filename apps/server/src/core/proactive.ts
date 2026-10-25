import { config } from "../config.js";
import { askModel } from "./llm.js";
import { buildSystem } from "./prompt.js";
import { parseReply } from "./reply.js";
import { loadHistory, saveHistory } from "../store/history.js";
import { listUsers, markProactive } from "../store/users.js";
import { slog } from "../util.js";

/** 由组合根注入真正的发送方式，core 不直接碰 QQ */
export type ProactiveSender = (userId: string, text: string) => Promise<void>;

const inQuietHours = (hour: number): boolean => {
  const { quietStart, quietEnd } = config.proactive;
  return quietStart > quietEnd
    ? hour >= quietStart || hour < quietEnd
    : hour >= quietStart && hour < quietEnd;
};

const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

let running = false;

const tick = async (send: ProactiveSender): Promise<void> => {
  if (running) return;

  const now = Date.now();
  if (inQuietHours(new Date().getHours())) return;

  const candidates = listUsers()
    .filter(
      (u) =>
        u.channel === "qq" &&
        now - u.lastSeen > config.proactive.minIdleMs &&
        now - u.lastSeen < config.proactive.maxIdleDays * 86_400_000 &&
        (!u.lastProactiveAt || u.lastProactiveAt < startOfToday()),
    )
    .sort((a, b) => b.lastSeen - a.lastSeen);

  const user = candidates[0];
  if (!user) return;

  running = true;

  const hours = Math.round((now - user.lastSeen) / 3_600_000);
  const system = buildSystem(user.userId);

  try {
    const raw = await askModel([
      { role: "system", content: system },
      {
        role: "user",
        content:
          `现在是 ${new Date().toLocaleString("zh-CN")}。主人已经 ${hours} 小时没说话了。` +
          "用一句你自己的话主动打个招呼，可以分享你刚想到的小事。" +
          "不要说“系统”“推送”“有什么可以帮你”这类词，一句话就够。",
      },
    ]);

    const text = parseReply(raw).text;
    if (!text) {
      slog("主动消息生成了空内容，跳过");
      return;
    }

    await send(user.userId, text);

    // 主动说过的话也要进历史，否则下一轮她自己不记得
    saveHistory(user.userId, [
      ...loadHistory(user.userId),
      { role: "assistant", content: text },
    ]);

    markProactive(user.userId, "qq");
    slog("主动打招呼成功");
  } catch (e) {
    slog("主动消息失败（平台可能不允许主动推送）", e);
  } finally {
    running = false;
  }
};

/** 启动主动消息定时器；平台不允许时只会打日志，不影响其他功能 */
export const startProactive = (send: ProactiveSender): void => {
  if (!config.proactive.enabled) {
    slog("主动消息已关闭");
    return;
  }

  setInterval(() => {
    void tick(send);
  }, config.proactive.intervalMs);

  slog(
    `主动消息已开启：每 ${Math.round(config.proactive.intervalMs / 60_000)} 分钟检查一次，` +
      `免打扰 ${config.proactive.quietStart}:00-${config.proactive.quietEnd}:00`,
  );
};
