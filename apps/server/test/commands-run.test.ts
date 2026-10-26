import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-commands-"));
process.env.WHALE_DATA_DIR = dataDir;

const { runCommand } = await import("../src/core/commands.js");
const { loadHistory, saveHistory } = await import("../src/store/history.js");
const { loadMemory, saveMemory } = await import("../src/store/memory.js");

test("/help 由命令表生成，包含参数用法", async () => {
  const text = await runCommand("help", "", "u1");
  assert.match(text, /\/remember 内容/);
  assert.match(text, /\/status/);
  assert.match(text, /\/forget/);
});

test("/new 清历史但保留记忆", async () => {
  saveHistory("u1", [{ role: "user", content: "旧消息" }]);
  saveMemory("u1", {
    summary: "旧摘要",
    facts: ["不吃香菜"],
    updatedAt: Date.now(),
  });

  await runCommand("new", "", "u1");

  assert.equal(loadHistory("u1").length, 0);
  assert.equal(loadMemory("u1").summary, "旧摘要");
  assert.deepEqual(loadMemory("u1").facts, ["不吃香菜"]);
});

test("/forget 连记忆一起清空", async () => {
  await runCommand("forget", "", "u1");

  assert.equal(loadHistory("u1").length, 0);
  assert.equal(loadMemory("u1").summary, "");
  assert.deepEqual(loadMemory("u1").facts, []);
});

test("未知命令给提示", async () => {
  const text = await runCommand("nope", "", "u1");
  assert.match(text, /没有 \/nope/);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
