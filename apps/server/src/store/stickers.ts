import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "./atomic.js";

export interface ISticker {
  id: string;
  file: string;
  mime: string;
  tags: string[];
  createdAt: number;
  /** 图片内容的 SHA-256；旧索引可能没有 */
  hash?: string;
  /** 图片字节数；旧索引可能没有 */
  size?: number;
  /** 人类可读标签（默认取第一个标签）；旧索引可能没有 */
  desc?: string;
  /** 发送过几次 */
  useCount?: number;
  /** 最近一次发送时间 */
  lastUsedAt?: number;
  /** 最近一次发送时的语境（≤40 字） */
  lastContext?: string;
  /** 发送失败后的冷却截止时间（例如 QQ 不接受这张 GIF） */
  unsendableUntil?: number;
}

export interface IIngestResult {
  sticker: ISticker;
  /** true = 图库里已有完全相同的内容，这次没有写新文件 */
  duplicate: boolean;
}

export interface IDedupeResult {
  /** 合并了多少组重复图 */
  groups: number;
  /** 从索引移除、并从磁盘删除了多少张 */
  removed: number;
}

const dir = join(config.paths.dataDir, "stickers");
const indexPath = join(dir, "index.json");

/**
 * 合并重复图标签时的上限。
 * 挑图用的是标签字符二元组的余弦相似度，标签越多分数越被稀释；
 * 留一点余量，避免增强过的图反而掉到 STICKER_MIN_SCORE 以下。
 */
const MAX_MERGED_TAGS = 12;

let indexCache: {
  mtimeMs: number;
  size: number;
  data: ISticker[];
} | null = null;

const asCount = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/** 旧索引没有 desc / useCount 等字段，读取时补齐，不强制重写磁盘 */
const normalizeSticker = (value: ISticker): ISticker => {
  const tags = Array.isArray(value.tags) ? value.tags.filter(Boolean) : [];
  const desc =
    typeof value.desc === "string" && value.desc.trim()
      ? value.desc.trim()
      : (tags[0] ?? "");
  const lastContext =
    typeof value.lastContext === "string" ? value.lastContext.trim() : "";
  const unsendableUntil = Number(value.unsendableUntil);

  return {
    ...value,
    tags,
    desc,
    useCount: asCount(value.useCount),
    lastUsedAt: asCount(value.lastUsedAt),
    ...(lastContext ? { lastContext } : {}),
    ...(Number.isFinite(unsendableUntil) && unsendableUntil > 0
      ? { unsendableUntil }
      : {}),
  };
};

const readIndex = (): ISticker[] => {
  try {
    if (!existsSync(indexPath)) {
      indexCache = null;
      return [];
    }

    const stat = statSync(indexPath);
    if (
      indexCache &&
      indexCache.mtimeMs === stat.mtimeMs &&
      indexCache.size === stat.size
    ) {
      return indexCache.data;
    }

    const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
    const list = Array.isArray(parsed)
      ? (parsed as ISticker[]).map(normalizeSticker)
      : [];
    indexCache = { mtimeMs: stat.mtimeMs, size: stat.size, data: list };
    return list;
  } catch (e) {
    console.error("[stickers] 索引读取失败", e);
    return [];
  }
};

/** 写失败返回 false，由调用方决定回滚；不再把异常直接抛给无关流程 */
const writeIndex = (list: ISticker[]): boolean => {
  try {
    writeJsonAtomic(indexPath, list);
    indexCache = null;
    return true;
  } catch (e) {
    console.error("[stickers] 索引写入失败", e);
    return false;
  }
};

const extOf = (mime: string): string => {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "jpg";
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const fileOf = (sticker: ISticker): string => join(dir, sticker.file);

const statSize = (sticker: ISticker): number | null => {
  try {
    const stat = statSync(fileOf(sticker));
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
};

const hashFile = (sticker: ISticker): string | null => {
  try {
    return sha256(readFileSync(fileOf(sticker)));
  } catch {
    return null;
  }
};

const tagsOf = (sticker: ISticker): string[] =>
  Array.isArray(sticker.tags) ? sticker.tags : [];

const mergeTags = (lists: string[][]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const raw of list) {
      const tag = raw.trim();
      if (!tag || seen.has(tag)) continue;

      seen.add(tag);
      out.push(tag);
      if (out.length >= MAX_MERGED_TAGS) return out;
    }
  }

  return out;
};

interface IDuplicateLookup {
  sticker: ISticker | null;
  list: ISticker[];
  /** 是否给旧条目补了 hash / size */
  backfilled: boolean;
}

/**
 * 在已有索引里找同内容的一张。
 * 旧条目没有 hash：先用 size 缩小候选，只对同 size 的文件读一次并回填补齐；
 * 这样第一次升级不会把整个图库都读进内存。
 */
const findDuplicate = (
  list: ISticker[],
  hash: string,
  size: number,
): IDuplicateLookup => {
  let next = list;
  let backfilled = false;

  const replace = (sticker: ISticker, updated: ISticker): void => {
    if (!backfilled) {
      next = [...list];
      backfilled = true;
    }

    const index = next.findIndex((item) => item.id === sticker.id);
    if (index >= 0) next[index] = updated;
    else next.push(updated);
  };

  for (const sticker of list) {
    if (sticker.hash === hash) return { sticker, list: next, backfilled };
    if (sticker.hash) continue;

    const stored = Number(sticker.size);
    const fileSize =
      Number.isFinite(stored) && stored > 0 ? stored : statSize(sticker);
    if (fileSize === null || fileSize !== size) continue;

    const fileHash = hashFile(sticker);
    if (!fileHash) continue;

    const updated = { ...sticker, hash: fileHash, size };
    replace(sticker, updated);

    if (fileHash === hash) {
      return { sticker: updated, list: next, backfilled };
    }
  }

  return { sticker: null, list: next, backfilled };
};

/** 收一张图进图库（标签可以先空着，后台补）；同内容只留最早的一张 */
export const ingestSticker = (
  bytes: Uint8Array,
  mime: string,
  tags: string[],
): IIngestResult => {
  mkdirSync(dir, { recursive: true });

  const hash = sha256(bytes);
  const size = bytes.byteLength;
  const lookup = findDuplicate(readIndex(), hash, size);

  if (lookup.sticker) {
    if (lookup.backfilled) writeIndex(lookup.list);
    return { sticker: lookup.sticker, duplicate: true };
  }

  const id = randomUUID();
  const file = `${id}.${extOf(mime)}`;
  const target = join(dir, file);
  const temp = `${target}.${process.pid}.tmp`;

  try {
    // 先写临时文件再 rename，避免崩溃时留下半张图
    writeFileSync(temp, bytes);
    renameSync(temp, target);

    const sticker: ISticker = {
      id,
      file,
      mime,
      tags,
      desc: tags[0] ?? "",
      useCount: 0,
      createdAt: Date.now(),
      hash,
      size,
    };
    const list = [...lookup.list, sticker];

    if (!writeIndex(list)) {
      // 索引没写成功就不留孤儿文件
      rmSync(target, { force: true });
      throw new Error("表情包索引写入失败");
    }

    return { sticker, duplicate: false };
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

/**
 * 合并旧图库里的重复图：
 * - 先按 size 分组，只给同 size 的候选算 hash（重复图必然同 size）；
 * - 同 hash 的组保留 createdAt 最早的一张，标签取并集；
 * - 先原子写索引，成功后再删多余文件，避免索引与磁盘不一致。
 */
export const dedupeStickers = (): IDedupeResult => {
  const list = readIndex();
  if (list.length < 2) return { groups: 0, removed: 0 };

  const working = list.map((sticker) => ({
    ...sticker,
    tags: [...tagsOf(sticker)],
  }));
  const bySize = new Map<number, ISticker[]>();
  let changed = false;

  for (const sticker of working) {
    const stored = Number(sticker.size);
    const size =
      Number.isFinite(stored) && stored > 0 ? stored : statSize(sticker);
    if (size === null || size <= 0) continue;

    if (sticker.size !== size) {
      sticker.size = size;
      changed = true;
    }

    const bucket = bySize.get(size) ?? [];
    bucket.push(sticker);
    bySize.set(size, bucket);
  }

  const removed: ISticker[] = [];
  const removedIds = new Set<string>();
  let groups = 0;

  for (const bucket of bySize.values()) {
    if (bucket.length < 2) continue;

    const byHash = new Map<string, ISticker[]>();

    for (const sticker of bucket) {
      let hash = sticker.hash;
      if (!hash) {
        hash = hashFile(sticker) ?? undefined;
        if (!hash) continue;
        sticker.hash = hash;
        changed = true;
      }

      const group = byHash.get(hash) ?? [];
      group.push(sticker);
      byHash.set(hash, group);
    }

    for (const group of byHash.values()) {
      if (group.length < 2) continue;

      groups += 1;
      group.sort(
        (a, b) =>
          (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) ||
          a.id.localeCompare(b.id),
      );

      const canonical = group[0];
      const merged = mergeTags(group.map((sticker) => sticker.tags));
      if (
        merged.length !== canonical.tags.length ||
        merged.some((tag, index) => tag !== canonical.tags[index])
      ) {
        canonical.tags = merged;
        changed = true;
      }

      for (const extra of group.slice(1)) {
        if (removedIds.has(extra.id)) continue;
        removed.push(extra);
        removedIds.add(extra.id);
      }
    }
  }

  if (!changed && removed.length === 0) return { groups: 0, removed: 0 };

  const next = working.filter((sticker) => !removedIds.has(sticker.id));
  if (!writeIndex(next)) return { groups: 0, removed: 0 };

  for (const sticker of removed) {
    try {
      rmSync(fileOf(sticker), { force: true });
    } catch (error) {
      // 索引已经清掉了，这里最多留一个孤儿文件；不要因此回滚索引
      console.error("[stickers] 删除重复图失败", sticker.id, error);
    }
  }

  return { groups, removed: removed.length };
};

export const listStickers = (): ISticker[] => readIndex();

/** 后台打标完成后回填；图已经被删了就静默跳过 */
export const updateStickerTags = (id: string, tags: string[]): void => {
  const list = readIndex();
  if (!list.some((sticker) => sticker.id === id)) return;

  const next = list.map((sticker) =>
    sticker.id === id
      ? { ...sticker, tags, desc: sticker.desc || tags[0] || "" }
      : sticker,
  );
  writeIndex(next);
};

/**
 * 按 id 找一张：先精确匹配，再允许 6 位以上的前缀（模型看到的是 8 位短 id）。
 */
export const findStickerById = (ref: string): ISticker | undefined => {
  const query = ref.trim().toLowerCase();
  if (!query) return undefined;

  const list = readIndex();
  const exact = list.find((sticker) => sticker.id.toLowerCase() === query);
  if (exact) return exact;
  if (query.length < 6) return undefined;

  return list.find((sticker) => sticker.id.toLowerCase().startsWith(query));
};

/** 记录一次发送：次数 + 最近时间 + 语境，供"别老用同一张"和提示词使用 */
export const markStickerUsed = (id: string, context = ""): void => {
  const list = readIndex();
  const index = list.findIndex((sticker) => sticker.id === id);
  if (index < 0) return;

  const current = list[index];
  const next = [...list];
  next[index] = {
    ...current,
    useCount: (current.useCount ?? 0) + 1,
    lastUsedAt: Date.now(),
    lastContext: context.trim().slice(0, 40) || current.lastContext,
  };
  writeIndex(next);
};

/** 发送失败（例如 QQ 不接受这张 GIF）时临时跳过它 */
export const markStickerUnsendable = (id: string, ms = 60 * 60_000): void => {
  const list = readIndex();
  const index = list.findIndex((sticker) => sticker.id === id);
  if (index < 0) return;

  const next = [...list];
  next[index] = { ...next[index], unsendableUntil: Date.now() + ms };
  writeIndex(next);
};

/** 按标签/备注做包含匹配，给 list_stickers 和"未命中候选"用 */
export const searchStickers = (query = "", limit = 10): ISticker[] => {
  const list = readIndex();
  const q = query.trim().toLowerCase();
  const max = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  if (!q) return list.slice(-max).reverse();

  return list
    .filter((sticker) =>
      [sticker.desc ?? "", ...sticker.tags].join(" ").toLowerCase().includes(q),
    )
    .slice(0, max);
};

export const listUntaggedStickers = (): ISticker[] =>
  readIndex().filter((s) => s.tags.length === 0);

export const readSticker = (sticker: ISticker): Buffer =>
  readFileSync(join(dir, sticker.file));
