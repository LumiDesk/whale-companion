import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-memory-v2-"));
process.env.WHALE_DATA_DIR = dataDir;

const {
  loadMemory,
  pruneMemory,
  renderMemory,
  saveMemory,
} = await import("../src/store/memory.js");

test("记忆 v2：facts/topics/thoughts 能落盘并读回", () => {
  const now = Date.now();
  saveMemory("u1", {
    summary: "他最近在准备面试",
    facts: ["不吃香菜"],
    topics: [
      {
        text: "面试准备得怎么样",
        lastMentionAt: now,
        pendingQuestion: "问他面试结果",
      },
    ],
    thoughts: [
      {
        text: "想问他要不要一起吃饭",
        createdAt: now,
        expiresAt: now + 60_000,
        motivation: "关心",
      },
    ],
    updatedAt: now,
  });

  const mem = loadMemory("u1");
  assert.equal(mem.summary, "他最近在准备面试");
  assert.deepEqual(mem.facts, ["不吃香菜"]);
  assert.equal(mem.topics[0].pendingQuestion, "问他面试结果");
  assert.equal(mem.thoughts[0].motivation, "关心");
});

test("记忆渲染包含四个段落", () => {
  const now = Date.now();
  saveMemory("u2", {
    summary: "旧对话",
    facts: ["喜欢猫"],
    topics: [{ text: "周末去哪", lastMentionAt: now }],
    thoughts: [
      { text: "想说晚安", createdAt: now, expiresAt: now + 60_000 },
    ],
    updatedAt: now,
  });

  const text = renderMemory(loadMemory("u2"), "主人", now);
  assert.match(text, /你们之前的经历/);
  assert.match(text, /关于主人/);
  assert.match(text, /进行中的话题/);
  assert.match(text, /你想说但还没说的/);
});

test("过期话题和想法会被清理", () => {
  const now = Date.now();
  const mem = {
    summary: "",
    facts: [],
    topics: [
      { text: "旧话题", lastMentionAt: now - 25 * 60 * 60 * 1000 },
      { text: "新话题", lastMentionAt: now },
    ],
    thoughts: [
      { text: "过期", createdAt: now - 1000, expiresAt: now - 1 },
      { text: "没过期", createdAt: now, expiresAt: now + 60_000 },
    ],
    updatedAt: now,
  };

  assert.equal(pruneMemory(mem, now), true);
  assert.deepEqual(
    mem.topics.map((topic) => topic.text),
    ["新话题"],
  );
  assert.deepEqual(
    mem.thoughts.map((thought) => thought.text),
    ["没过期"],
  );
});

test("facts 超过 20 条时保留最近的", () => {
  saveMemory("u3", {
    summary: "",
    facts: Array.from({ length: 25 }, (_, index) => `fact-${index}`),
    topics: [],
    thoughts: [],
    updatedAt: Date.now(),
  });

  const facts = loadMemory("u3").facts;
  assert.equal(facts.length, 20);
  assert.equal(facts[0], "fact-5");
  assert.equal(facts[19], "fact-24");
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
