import assert from "node:assert/strict";
import test from "node:test";

// config.ts 在导入时就要求这些变量存在，测试里给占位值
process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { buildUserContent } = await import("../src/core/chat.js");

test("没有图片时，用户内容就是纯字符串", () => {
  assert.equal(buildUserContent("你好", []), "你好");
});

test("有图片时，拼成「文字 + image_url」数组", () => {
  const content = buildUserContent("看看这个", [
    { data: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" },
  ]);

  assert.ok(Array.isArray(content));
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: "text", text: "看看这个" });

  const part = content[1] as { type: string; image_url: { url: string } };
  assert.equal(part.type, "image_url");
  assert.ok(part.image_url.url.startsWith("data:image/png;base64,"));
});

test("只有图片没有文字时，不塞空的 text 块", () => {
  const content = buildUserContent("", [
    { data: new Uint8Array([9]).buffer, mime: "image/jpeg" },
  ]);

  assert.ok(Array.isArray(content));
  assert.equal(content.length, 1);
  assert.equal((content[0] as { type: string }).type, "image_url");
});
