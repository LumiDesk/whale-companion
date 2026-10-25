import assert from "node:assert/strict";
import test from "node:test";

const { parseReply } = await import("../src/core/reply.js");

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

test("只有标记时正文为空", () => {
  assert.deepEqual(parseReply("[表情包:贴贴]"), { text: "", sticker: "贴贴" });
});

test("多个标记只取第一个", () => {
  assert.deepEqual(parseReply("嗯 [表情包:无语] 别闹 [表情包:生气]"), {
    text: "嗯  别闹",
    sticker: "无语",
  });
});
