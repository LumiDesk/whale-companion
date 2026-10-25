import assert from "node:assert/strict";
import test from "node:test";

const { bigrams, cosine, rankStickers } = await import(
  "../src/core/sticker-search.js"
);

const sticker = (id: string, tags: string[], createdAt = 1) => ({
  id,
  file: `${id}.jpg`,
  mime: "image/jpeg",
  tags,
  createdAt,
});

test("二元组：短文本也能切", () => {
  assert.deepEqual(bigrams("开心"), ["开心"]);
  assert.deepEqual(bigrams("好开心呀"), ["好开", "开心", "心呀"]);
});

test("余弦：完全相同 = 1，毫无交集 = 0", () => {
  const a = new Map([["开心", 1]]);
  const b = new Map([["开心", 1]]);
  const c = new Map([["难过", 1]]);
  assert.equal(cosine(a, b), 1);
  assert.equal(cosine(a, c), 0);
});

test("语义排序：查询与标签越像排越前", () => {
  const list = [
    sticker("a", ["难过", "委屈"]),
    sticker("b", ["开心", "大笑"]),
    sticker("c", ["无语", "翻白眼"]),
  ];
  const ranked = rankStickers(list, "开心");
  assert.equal(ranked[0].sticker.id, "b");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("同样的分数时，新图优先", () => {
  const list = [
    sticker("old", ["开心"], 100),
    sticker("new", ["开心"], 200),
  ];
  assert.equal(rankStickers(list, "开心")[0].sticker.id, "new");
});

test("挑图：没命中且不允许随机 → 不发", async () => {
  const { pickStickerSmart } = await import("../src/core/sticker-pick.js");
  const list = [sticker("a", ["沙滩", "热到虚脱"])];
  assert.equal(pickStickerSmart(list, "完全不相干的词"), undefined);
});

test("挑图：允许随机时兜底一张", async () => {
  const { pickStickerSmart } = await import("../src/core/sticker-pick.js");
  const list = [sticker("a", ["沙滩", "热到虚脱"])];
  assert.equal(
    pickStickerSmart(list, "完全不相干的词", { allowRandom: true })?.sticker
      .id,
    "a",
  );
});
