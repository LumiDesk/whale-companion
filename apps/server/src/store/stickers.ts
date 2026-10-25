import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { config } from "../config.js";

export interface ISticker {
  id: string;
  file: string;
  mime: string;
  tags: string[];
  createdAt: number;
}

const dir = join(config.paths.dataDir, "stickers");
const indexPath = join(dir, "index.json");

const readIndex = (): ISticker[] => {
  try {
    if (!existsSync(indexPath)) return [];
    const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
    return Array.isArray(parsed) ? (parsed as ISticker[]) : [];
  } catch (e) {
    console.error("[stickers] 索引读取失败", e);
    return [];
  }
};

const writeIndex = (list: ISticker[]) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(indexPath, JSON.stringify(list, null, 2), "utf8");
};

const extOf = (mime: string) =>
  mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpg";

/** 收一张图进图库 */
export const ingestSticker = (
  bytes: Uint8Array,
  mime: string,
  tags: string[],
): ISticker => {
  mkdirSync(dir, { recursive: true });

  const id = randomUUID();
  const file = `${id}.${extOf(mime)}`;
  writeFileSync(join(dir, file), bytes);

  const sticker: ISticker = { id, file, mime, tags, createdAt: Date.now() };
  const list = readIndex();
  list.push(sticker);
  writeIndex(list);

  return sticker;
};

export const listStickers = (): ISticker[] => readIndex();

/** 按提示词挑一张：标签命中优先，否则随机 */
export const pickSticker = (hint = ""): ISticker | undefined => {
  const list = readIndex();
  if (list.length === 0) return undefined;

  const hit = hint
    ? list.find((s) => s.tags.some((t) => t && hint.includes(t)))
    : undefined;

  return hit ?? list[Math.floor(Math.random() * list.length)];
};

export const readSticker = (sticker: ISticker): Buffer =>
  readFileSync(join(dir, sticker.file));
