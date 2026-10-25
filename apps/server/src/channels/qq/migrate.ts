import { join } from "node:path";

import { config } from "../../config.js";
import { sanitizeHistoryFile } from "../../store/history.js";
import { slog } from "../../util.js";
import { cleanQQContent } from "./text.js";

/**
 * 旧版本把 `<faceType=...>` / `<@...>` 原样写进了 history.json。
 * 这些标记每轮都会被重新喂给模型，白烧 token 还容易带偏语气。
 * 启动时清一次；没有改动就不写盘，也不会反复制造备份。
 */
export const cleanLegacyHistory = (): void => {
  const result = sanitizeHistoryFile(
    join(config.paths.dataDir, "history.json"),
    cleanQQContent,
  );

  if (result.changed === 0) return;

  slog(
    `历史清理完成：${result.users} 个用户、${result.changed} 条消息；` +
      `备份在 ${result.backup}`,
  );
};
