import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-sticker-dedupe-"));
process.env.WHALE_DATA_DIR = dataDir;

const stickersDir = join(dataDir, "stickers");
const indexPath = join(stickersDir, "index.json");

const { dedupeStickers, ingestSticker, listStickers } =
  await import("../src/store/stickers.js");

const reset = (): void => {
  rmSync(stickersDir, { recursive: true, force: true });
  mkdirSync(stickersDir, { recursive: true });
};

const writeIndex = (list: unknown[]): void => {
  writeFileSync(indexPath, JSON.stringify(list, null, 2));
};

const files = (): string[] =>
  readdirSync(stickersDir).filter((name) => name !== "index.json");

const sticker = (
  id: string,
  file: string,
  createdAt: number,
  tags: string[] = [],
): Record<string, unknown> => ({
  id,
  file,
  mime: "image/jpeg",
  tags,
  createdAt,
});

test("同一张图只入库一次，hash / size 落盘", () => {
  reset();
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  const first = ingestSticker(bytes, "image/jpeg", []);
  assert.equal(first.duplicate, false);
  assert.equal(first.sticker.hash?.length, 64);
  assert.equal(first.sticker.size, 5);

  const second = ingestSticker(bytes, "image/jpeg", []);
  assert.equal(second.duplicate, true);
  assert.equal(second.sticker.id, first.sticker.id);
  assert.equal(listStickers().length, 1);
  assert.equal(files().length, 1);
});

test("同 size 不同内容不误判", () => {
  reset();

  const first = ingestSticker(new Uint8Array([1, 1, 1]), "image/png", []);
  const second = ingestSticker(new Uint8Array([2, 2, 2]), "image/png", []);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(listStickers().length, 2);
  assert.equal(files().length, 2);
});

test("旧索引没有 hash / size 时按 size 补算并命中", () => {
  reset();
  const bytes = new Uint8Array([9, 8, 7, 6]);
  writeFileSync(join(stickersDir, "legacy.jpg"), bytes);
  writeIndex([sticker("legacy", "legacy.jpg", 100, ["旧图"])]);

  const result = ingestSticker(bytes, "image/jpeg", []);

  assert.equal(result.duplicate, true);
  assert.equal(result.sticker.id, "legacy");
  assert.equal(listStickers().length, 1);
  assert.equal(files().length, 1);

  const stored = listStickers()[0];
  assert.equal(stored.hash?.length, 64);
  assert.equal(stored.size, 4);
});

test("去重合并标签、保留最早一张、删掉多余文件且幂等", () => {
  reset();
  const bytes = new Uint8Array([5, 5, 5, 5]);
  writeFileSync(join(stickersDir, "a.jpg"), bytes);
  writeFileSync(join(stickersDir, "b.jpg"), bytes);
  writeFileSync(join(stickersDir, "c.jpg"), bytes);
  writeIndex([
    sticker("a", "a.jpg", 100, ["旧标签"]),
    sticker("b", "b.jpg", 200, ["新标签", "旧标签"]),
    sticker("c", "c.jpg", 300, ["第三个"]),
  ]);

  assert.deepEqual(dedupeStickers(), { groups: 1, removed: 2 });

  const list = listStickers();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "a");
  assert.deepEqual(list[0].tags, ["旧标签", "新标签", "第三个"]);
  assert.equal(list[0].size, 4);
  assert.ok(list[0].hash);
  assert.deepEqual(files(), ["a.jpg"]);

  // 第二次启动不应该再写索引、再删东西
  assert.deepEqual(dedupeStickers(), { groups: 0, removed: 0 });
});

test("同 size 不同内容不会被合并", () => {
  reset();
  writeFileSync(join(stickersDir, "a.jpg"), new Uint8Array([1, 2, 3]));
  writeFileSync(join(stickersDir, "b.jpg"), new Uint8Array([4, 5, 6]));
  writeIndex([
    sticker("a", "a.jpg", 100, ["甲"]),
    sticker("b", "b.jpg", 200, ["乙"]),
  ]);

  assert.deepEqual(dedupeStickers(), { groups: 0, removed: 0 });
  assert.equal(listStickers().length, 2);
  assert.deepEqual(files().sort(), ["a.jpg", "b.jpg"]);
});

test("并集标签最多保留 12 个", () => {
  reset();
  const bytes = new Uint8Array([7, 7, 7]);
  writeFileSync(join(stickersDir, "a.jpg"), bytes);
  writeFileSync(join(stickersDir, "b.jpg"), bytes);

  const first = Array.from({ length: 8 }, (_, i) => `甲${i}`);
  const second = Array.from({ length: 8 }, (_, i) => `乙${i}`);
  writeIndex([
    sticker("a", "a.jpg", 100, first),
    sticker("b", "b.jpg", 200, second),
  ]);

  assert.deepEqual(dedupeStickers(), { groups: 1, removed: 1 });

  const list = listStickers();
  assert.equal(list.length, 1);
  assert.equal(list[0].tags.length, 12);
  assert.deepEqual(list[0].tags.slice(0, 8), first);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
