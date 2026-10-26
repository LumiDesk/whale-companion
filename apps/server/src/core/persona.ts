import { existsSync, readFileSync } from "node:fs";

import { config } from "../config.js";
import { slog } from "../util.js";

/** 默认人设也读不到时的最小兜底，保证 Bot 还能回话 */
const MINIMAL_PERSONA =
  "你叫「小鲸鱼」，是主人养的一只蓝色小鲸鱼。说话口语、简短、有点傲娇，但很在意主人。";

const warned = new Set<string>();

const readPersona = (file: string, label: string): string => {
  try {
    if (!existsSync(file)) return "";
    return readFileSync(file, "utf8").trim();
  } catch (error) {
    if (!warned.has(file)) {
      warned.add(file);
      slog(`读取${label}失败，尝试回退`, error);
    }
    return "";
  }
};

/**
 * 读当前生效的人设：
 * 1. APPDATA 里的用户覆盖（桌面端编辑器写入）；
 * 2. 安装目录里的默认人设（随版本更新）；
 * 3. 最小兜底。
 *
 * 每次现读，改完下一条生效。称呼在这里做字面替换，
 * 让「主人」在人设正文里也变成用户设置的称呼。
 */
export const getPersona = (): string => {
  let text = readPersona(config.paths.persona, "用户人设");

  if (!text && config.paths.defaultPersona !== config.paths.persona) {
    text = readPersona(config.paths.defaultPersona, "默认人设");
  }

  if (!text) {
    if (!warned.has("minimal")) {
      warned.add("minimal");
      slog("人设文件为空，使用最小兜底人设");
    }
    text = MINIMAL_PERSONA;
  }

  const owner = config.persona.ownerName.trim();
  if (owner && owner !== "主人") {
    text = text.split("主人").join(owner);
  }

  return text;
};
