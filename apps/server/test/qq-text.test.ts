import assert from "node:assert/strict";
import test from "node:test";

const { cleanQQContent } = await import("../src/channels/qq/text.js");

test("清掉 QQ 表情标签", () => {
  assert.equal(
    cleanQQContent(
      '好哦<faceType=1,faceId="201",ext="eyJ0ZXh0Ijoi54K56LWeIn0=">',
    ),
    "好哦",
  );
});

test("连续多个表情标签都清掉", () => {
  assert.equal(
    cleanQQContent(
      '当然啦<faceType=1,faceId="75",ext="a"><faceType=1,faceId="75",ext="b">，困ing',
    ),
    "当然啦，困ing",
  );
});

test("@ 也清掉", () => {
  assert.equal(cleanQQContent("<@!123456> 在吗"), "在吗");
});

test("只有标签时得到空串", () => {
  assert.equal(cleanQQContent('<faceType=6,faceId="0",ext="">'), "");
});

test("正常换行和文字保持不变", () => {
  assert.equal(cleanQQContent("第一行\n\n第二行"), "第一行\n\n第二行");
});
