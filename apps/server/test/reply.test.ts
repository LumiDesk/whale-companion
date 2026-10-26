import assert from "node:assert/strict";
import test from "node:test";

const { parseReply, splitReply } = await import("../src/core/reply.js");

test("没有标记时原样返回", () => {
  assert.deepEqual(parseReply("主人今天好安静呀"), {
    text: "主人今天好安静呀",
    sticker: undefined,
  });
});

test("剥掉标记并取出关键词", () => {
  assert.deepEqual(parseReply("哼，才不是等你呢 [表情包:傲娇]"), {
    text: "哼，才不是等你呢",
    sticker: "傲娇",
  });
});

test("中文冒号也能认", () => {
  assert.equal(parseReply("好耶 [表情包：开心]").sticker, "开心");
});

test("全角方括号也能认", () => {
  assert.deepEqual(parseReply("嗯【表情包：无语】"), {
    text: "嗯",
    sticker: "无语",
  });
});

test("只有标记时正文为空", () => {
  assert.deepEqual(parseReply("[表情包:贴贴]"), { text: "", sticker: "贴贴" });
});

test("多个标记只取第一个", () => {
  assert.deepEqual(parseReply("嗯 [表情包:无语] 别闹 [表情包:生气]"), {
    text: "嗯  别闹",
    sticker: "无语",
  });
});

test("旧的 || 分隔不再拆条，只还原成换行", () => {
  assert.deepEqual(parseReply("一是这样 || 二是那样"), {
    text: "一是这样\n二是那样",
    sticker: undefined,
  });
});

test("正常长度的回复整条发，不按空行拆开", () => {
  assert.deepEqual(splitReply("第一段\n\n第二段"), ["第一段\n\n第二段"]);
  assert.deepEqual(splitReply("只有一句"), ["只有一句"]);
});

test("空内容不发送", () => {
  assert.deepEqual(splitReply("   "), []);
});

test("超过上限才切，硬切也不丢字", () => {
  const long = "啊".repeat(600);
  const parts = splitReply(long, 100);

  assert.equal(parts.length, 6);
  assert.ok(parts.every((p) => p.length <= 100));
  assert.equal(parts.join(""), long);
});

test("超长时优先在段落/句末断开", () => {
  const text = `${"第一段".repeat(30)}。\n\n${"第二段".repeat(30)}。`;
  const parts = splitReply(text, 100);

  assert.ok(parts.length >= 2);
  assert.ok(parts[0].endsWith("。"));
  assert.equal(
    parts.join("").replace(/\s/g, ""),
    text.replace(/\s/g, ""),
  );
});

test("上限为 0 或负数时不会死循环", () => {
  assert.deepEqual(splitReply("abc", 0), ["a", "b", "c"]);
  assert.deepEqual(splitReply("abc", -10), ["a", "b", "c"]);
});

test("上限不是数字时不切分", () => {
  assert.deepEqual(splitReply("一二三", Number.NaN), ["一二三"]);
  assert.deepEqual(splitReply("一二三", Number.POSITIVE_INFINITY), ["一二三"]);
});

test("硬切不会把 emoji 切成半个代理对", () => {
  const text = "😀".repeat(8);
  const parts = splitReply(text, 3);

  assert.ok(parts.length >= 2);
  for (const part of parts) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(part), `半个高代理：${part}`);
    assert.ok(!/^[\uDC00-\uDFFF]/.test(part), `半个低代理：${part}`);
  }
  assert.equal(parts.join(""), text);
});
