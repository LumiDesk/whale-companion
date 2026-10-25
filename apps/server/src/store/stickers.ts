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

/** 收一张图进图库（标签可以先空着，后台补） */
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

/** 后台打标完成后回填；图已经被删了就静默跳过 */
export const updateStickerTags = (id: string, tags: string[]): void => {
  const list = readIndex();
  const found = list.find((s) => s.id === id);
  if (!found) return;

  found.tags = tags;
  writeIndex(list);
};

export const listUntaggedStickers = (): ISticker[] =>
  readIndex().filter((s) => s.tags.length === 0);

export const readSticker = (sticker: ISticker): Buffer =>
  readFileSync(join(dir, sticker.file));
