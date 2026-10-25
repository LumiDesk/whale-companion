import assert from "node:assert/strict";
import test from "node:test";

const { detectStickerRequest } = await import(
  "../src/core/sticker-request.js"
);

test("最普通的要图", () => {
  assert.deepEqual(detectStickerRequest("发个表情包"), {
    requested: true,
    keyword: "",
  });
});

test("带修饰词时抽出检索词", () => {
  assert.deepEqual(detectStickerRequest("给我来张委屈巴巴的表情包"), {
    requested: true,
    keyword: "委屈巴巴",
  });
  assert.equal(detectStickerRequest("发个开心的表情包").keyword, "开心");
});

test("聊表情包本身不算要图", () => {
  assert.equal(detectStickerRequest("你发的表情包好好笑").requested, false);
  assert.equal(detectStickerRequest("表情包是什么梗").requested, false);
  assert.equal(detectStickerRequest("这个表情包好可爱").requested, false);
});

test("普通消息不会误判", () => {
  assert.equal(detectStickerRequest("今天好累").requested, false);
  assert.equal(detectStickerRequest("图片发你了").requested, false);
});

test("太长的一句话不当作要图", () => {
  assert.equal(
    detectStickerRequest("你能不能现在立刻马上给我发一张特别特别可爱的表情包").requested,
    false,
  );
});
