import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { parseCommand } = await import("../src/core/commands.js");

test("普通消息不是命令", () => {
  assert.equal(parseCommand("今天好累"), undefined);
});

test("解析命令与参数", () => {
  assert.deepEqual(parseCommand("/remember 我不吃香菜"), {
    name: "remember",
    args: "我不吃香菜",
  });
});

test("不带参数的命令", () => {
  assert.deepEqual(parseCommand("/help"), { name: "help", args: "" });
});

test("命令大小写不敏感", () => {
  assert.equal(parseCommand("/HELP")?.name, "help");
});

test("斜杠后面没东西不算命令", () => {
  assert.equal(parseCommand("/"), undefined);
});
