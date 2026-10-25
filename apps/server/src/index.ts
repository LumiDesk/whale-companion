import { startQQ } from "./channels/qq/gateway.js";
import { getAccessToken } from "./channels/qq/token.js";
import { sendC2CProactive } from "./channels/qq/send.js";
import { startProactive } from "./core/proactive.js";
import { retagUntaggedStickers } from "./core/tagger.js";
import { slog } from "./util.js";

slog("小鲸鱼启动中…");

// QQ 长连接（内部自带重连，不会阻塞启动）
void startQQ().catch((e) => slog("QQ 通道异常退出", e));

// 主动消息：渠道发送方式由这里注入，core 不直接碰 QQ
startProactive(async (userId, text) => {
  const token = await getAccessToken();
  await sendC2CProactive(userId, token, text);
});

// 上次没打完标签的图，启动后补上
retagUntaggedStickers();
