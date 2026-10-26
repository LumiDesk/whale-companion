// 必须最先加载：--config 会在这里合并进 process.env
import "./config.js";

import { startQQ } from "./channels/qq/gateway.js";
import { cleanLegacyHistory } from "./channels/qq/migrate.js";
import { getAccessToken } from "./channels/qq/token.js";
import { sendC2CProactive } from "./channels/qq/send.js";
import { listModels } from "./core/models.js";
import { runSelfCheck } from "./core/self-check.js";
import { startProactive } from "./core/proactive.js";
import { retagAllNow, retagUntaggedStickers } from "./core/tagger.js";
import { reportStatus } from "./status.js";
import { slog } from "./util.js";

const args = process.argv.slice(2);
const mode = args.includes("--list-models")
  ? "list-models"
  : args.includes("--self-check")
    ? "self-check"
    : args.includes("--retag")
      ? "retag"
      : "bot";

/** 一次性命令的输出：桌面端按 `@@WHALE` 行解析，不依赖 WHALE_GUI */
const emit = (event: Record<string, unknown>): void => {
  process.stdout.write(
    `@@WHALE ${JSON.stringify({ v: 1, ts: Date.now(), ...event })}\n`,
  );
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runListModels = async (): Promise<void> => {
  try {
    const models = await listModels();
    emit({ type: "models", ok: true, models });
    process.exitCode = 0;
  } catch (error) {
    emit({ type: "models", ok: false, error: errorText(error) });
    process.exitCode = 1;
  }
};

/** 一次性自检：不启动 WS、不写历史，逐项输出结果 */
const runSelfCheckMode = async (): Promise<void> => {
  const ok = await runSelfCheck((result) => {
    emit({ type: "check", ...result });
  });

  emit({ type: "check-done", ok });
  process.exitCode = ok ? 0 : 1;
};

/** 一次性重新打标：不启动 WS，处理完退出 */
const runRetagMode = async (): Promise<void> => {
  try {
    const result = await retagAllNow();
    emit({ type: "retag", ok: true, ...result });
    process.exitCode = 0;
  } catch (error) {
    emit({ type: "retag", ok: false, error: errorText(error) });
    process.exitCode = 1;
  }
};

const main = (): void => {
  let stopping = false;

  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    slog(`收到 ${signal}，准备退出`);
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

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

  // 清理旧版本留在历史里的平台标记；失败不阻塞启动
  try {
    cleanLegacyHistory();
  } catch (e) {
    slog("历史清理失败（不影响启动）", e);
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
};

if (mode === "list-models") {
  void runListModels();
} else if (mode === "self-check") {
  void runSelfCheckMode();
} else if (mode === "retag") {
  void runRetagMode();
} else {
  main();
}
