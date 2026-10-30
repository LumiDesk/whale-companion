import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-stickers-"));
process.env.WHALE_DATA_DIR = dataDir;

const {
  findStickerById,
  ingestSticker,
  listStickers,
  listUntaggedStickers,
  markStickerUsed,
  readSticker,
  updateStickerTags,
} = await import("../src/store/stickers.js");

test("收图后写索引，webp 用正确扩展名", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const { sticker } = ingestSticker(bytes, "image/webp", []);

  assert.ok(sticker.file.endsWith(".webp"));
  assert.deepEqual(Array.from(readSticker(sticker)), [1, 2, 3, 4]);
  assert.equal(listStickers().length, 1);
  assert.equal(listUntaggedStickers().length, 1);
});

test("打标回填后不再出现在未打标列表", () => {
  const sticker = listStickers()[0];
  updateStickerTags(sticker.id, ["开心", "转圈"]);

  const updated = listStickers().find((item) => item.id === sticker.id);
  assert.deepEqual(updated?.tags, ["开心", "转圈"]);
  assert.equal(updated?.desc, "开心");
  assert.equal(listUntaggedStickers().length, 0);
});

test("发送记录：useCount / lastUsedAt / lastContext 写进索引", () => {
  const sticker = listStickers()[0];
  markStickerUsed(sticker.id, "他说困了");

  const updated = listStickers().find((item) => item.id === sticker.id);
  assert.equal(updated?.useCount, 1);
  assert.ok((updated?.lastUsedAt ?? 0) > 0);
  assert.equal(updated?.lastContext, "他说困了");
});

test("按 id 前缀查找", () => {
  const sticker = listStickers()[0];
  assert.equal(findStickerById(sticker.id.slice(0, 8))?.id, sticker.id);
  assert.equal(findStickerById("不存在的id"), undefined);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
