// 必须最先加载：--config 会在这里合并进 process.env
import "./config.js";

import { startQQ } from "./channels/qq/gateway.js";
import { getAccessToken } from "./channels/qq/token.js";
import { sendC2CProactive } from "./channels/qq/send.js";
import { startProactive } from "./core/proactive.js";
import { retagUntaggedStickers } from "./core/tagger.js";
import { reportStatus } from "./status.js";
import { slog } from "./util.js";

slog("小鲸鱼启动中…");
reportStatus({ type: "boot", pid: process.pid });

/**
 * GUI 模式下，桌面端会传父进程 PID。
 * GUI 崩了（来不及杀子进程）时，机器人自己退出，避免孤儿进程占着 QQ 连接。
 */
const parentPid = Number(process.env.WHALE_PARENT_PID ?? 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      slog("GUI 已退出，机器人随之退出");
      process.exit(0);
    }
  }, 5000);

  timer.unref();
}

// QQ 长连接（内部自带重连，不会阻塞启动）
void startQQ().catch((e) => slog("QQ 通道异常退出", e));

// 主动消息：渠道发送方式由这里注入，core 不直接碰 QQ
startProactive(async (userId, text) => {
  const token = await getAccessToken();
  await sendC2CProactive(userId, token, text);
});

// 上次没打完标签的图，启动后补上
retagUntaggedStickers();

reportStatus({ type: "ready", pid: process.pid });
