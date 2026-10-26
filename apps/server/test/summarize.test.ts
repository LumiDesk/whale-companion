import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-summarize-"));
process.env.WHALE_DATA_DIR = dataDir;

const { loadHistory, saveHistory } = await import("../src/store/history.js");
const { loadMemory, saveMemory } = await import("../src/store/memory.js");
const { summarizeIfNeeded } = await import("../src/core/summarize.js");

const seed = (userId: string, count = 150) => {
  saveHistory(
    userId,
    Array.from({ length: count }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `第 ${index} 条消息`,
    })),
  );
};

const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("摘要期间写入的新消息不会被旧快照覆盖", async () => {
  const userId = "u-new-message";
  seed(userId);

  const pending = deferred();
  const task = summarizeIfNeeded(userId, () => pending.promise);

  // 模拟摘要 await 期间用户又发了一条
  saveHistory(userId, [
    ...loadHistory(userId),
    { role: "user", content: "摘要期间的新消息" },
  ]);

  pending.resolve("这是摘要");
  await task;

  const after = loadHistory(userId);
  assert.ok(
    after.some((m) => m.content === "摘要期间的新消息"),
    "新消息应该还在",
  );
  assert.equal(loadMemory(userId).summary, "", "摘要不应该写回");
});

test("摘要期间 /forget 不会被旧摘要复活", async () => {
  const userId = "u-forget";
  seed(userId);
  saveMemory(userId, {
    summary: "旧摘要",
    facts: ["旧事实"],
    updatedAt: Date.now(),
  });

  const pending = deferred();
  const task = summarizeIfNeeded(userId, () => pending.promise);

  saveHistory(userId, []);
  saveMemory(userId, { summary: "", facts: [], updatedAt: Date.now() });

  pending.resolve("旧对话摘要");
  await task;

  assert.deepEqual(loadHistory(userId), []);
  assert.equal(loadMemory(userId).summary, "");
  assert.deepEqual(loadMemory(userId).facts, []);
});

test("摘要长度有上限", async () => {
  const userId = "u-long-summary";
  seed(userId);

  await summarizeIfNeeded(userId, async () => "很长的摘要".repeat(100));

  const mem = loadMemory(userId);
  assert.ok(mem.summary.length <= 300, `摘要长度 ${mem.summary.length}`);
  assert.ok(mem.summary.length > 0);
});

test("摘要输入过长时只取最近一段", async () => {
  const userId = "u-long-transcript";
  saveHistory(
    userId,
    Array.from({ length: 150 }, (_, index) => ({
      role: "user" as const,
      content: `第 ${index} 条 ${"内容".repeat(100)}`,
    })),
  );

  let transcript = "";
  await summarizeIfNeeded(userId, async (messages) => {
    const user = messages[messages.length - 1];
    transcript = typeof user.content === "string" ? user.content : "";
    return "摘要";
  });

  assert.ok(transcript.length < 25_000, `摘要输入 ${transcript.length} 字`);
  assert.ok(transcript.includes("第 129 条"), "应该保留最近一段老对话");
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
