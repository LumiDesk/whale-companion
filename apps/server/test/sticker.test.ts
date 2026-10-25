import assert from "node:assert/strict";
import test from "node:test";

const { bigrams, cosine, rankStickers } = await import(
  "../src/core/sticker-search.js"
);
const { splitReply } = await import("../src/core/reply.js");

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

test("分条：按 || 拆开，最多三条", () => {
  assert.deepEqual(splitReply("一 || 二 || 三 || 四"), ["一", "二", "三"]);
  assert.deepEqual(splitReply("只有一句"), ["只有一句"]);
  assert.deepEqual(splitReply("   "), []);
});

test("分条：空行也会拆", () => {
  assert.deepEqual(splitReply("第一段\n\n第二段"), ["第一段", "第二段"]);
});

test("分条：超长单段在句号处断一刀", () => {
  const long =
    "今天其实挺想你的，就是没好意思说出口，毕竟我这么傲娇对吧。" +
    "你要是忙完了就回我一句嘛，我保证不闹，也就哼一声装装样子。" +
    "真的，就哼一声。";
  const parts = splitReply(long);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].endsWith("。"));
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
