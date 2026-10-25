import { config } from "../config.js";
import { askModel } from "./llm.js";
import { getPersona } from "./persona.js";
import { loadMemory, renderMemory } from "../store/memory.js";
import { listUsers, markProactive } from "../store/users.js";
import { getAccessToken } from "../channels/qq/token.js";
import { sendC2CProactive } from "../channels/qq/send.js";
import { slog } from "../util.js";

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

const tick = async (): Promise<void> => {
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

  const hours = Math.round((now - user.lastSeen) / 3_600_000);
  const system = [getPersona(), renderMemory(loadMemory(user.userId))]
    .filter(Boolean)
    .join("\n\n");

  try {
    const text = await askModel([
      { role: "system", content: system },
      {
        role: "user",
        content:
          `现在是 ${new Date().toLocaleString("zh-CN")}。主人已经 ${hours} 小时没说话了。` +
          "用一句你自己的话主动打个招呼，可以分享你刚想到的小事。" +
          "不要说“系统”“推送”“有什么可以帮你”这类词，一句话就够。",
      },
    ]);

    const token = await getAccessToken();
    await sendC2CProactive(user.userId, token, text);
    markProactive(user.userId, "qq");
    slog("主动打招呼成功");
  } catch (e) {
    slog("主动消息失败（平台可能不允许主动推送）", e);
  }
};

/** 启动主动消息定时器；平台不允许时只会打日志，不影响其他功能 */
export const startProactive = (): void => {
  if (!config.proactive.enabled) {
    slog("主动消息已关闭");
    return;
  }

  setInterval(() => {
    void tick();
  }, config.proactive.intervalMs);

  slog(
    `主动消息已开启：每 ${Math.round(config.proactive.intervalMs / 60_000)} 分钟检查一次，` +
      `免打扰 ${config.proactive.quietStart}:00-${config.proactive.quietEnd}:00`,
  );
};
