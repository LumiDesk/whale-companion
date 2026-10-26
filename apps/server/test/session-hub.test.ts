import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { createSessionHub } = await import(
  "../src/channels/qq/session-hub.js"
);
import type { IIncomingMessage } from "../src/core/agent/types.js";
import type { IBatch } from "../src/channels/qq/aggregator.js";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const push = (hub: ReturnType<typeof createSessionHub>, text: string, msgId = "m1") =>
  hub.push({
    userId: "u1",
    msgId,
    text,
    images: [],
  });

test("空闲时按停口聚合，再开回合", async () => {
  const batches: IBatch[] = [];
  const hub = createSessionHub({
    timing: { silenceMs: 20, maxWaitMs: 200, maxTexts: 10, maxImages: 10 },
    onTurn: async (batch) => {
      batches.push(batch);
    },
  });

  push(hub, "你好");
  push(hub, "在吗");
  await sleep(60);

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].texts, ["你好", "在吗"]);
  hub.stop();
});

test("回合进行中收到的新消息进 inbox，被 wait 返回", async () => {
  let waited: IIncomingMessage[] = [];
  let turnResolve!: () => void;
  const turnDone = new Promise<void>((resolve) => {
    turnResolve = resolve;
  });

  const hub = createSessionHub({
    timing: { silenceMs: 10, maxWaitMs: 200, maxTexts: 10, maxImages: 10 },
    onTurn: async () => {
      const result = await hub.wait("u1", { timeoutMs: 500, quietMs: 50 });
      waited = result.messages;
      turnResolve();
    },
  });

  push(hub, "第一句");
  await sleep(40);

  push(hub, "补充一句", "m2");
  await turnDone;

  assert.deepEqual(
    waited.map((message) => message.text),
    ["补充一句"],
  );
  hub.stop();
});

test("onCommand 返回 true 时不进入回合", async () => {
  const batches: IBatch[] = [];
  const commands: string[] = [];
  const hub = createSessionHub({
    timing: { silenceMs: 10, maxWaitMs: 200, maxTexts: 10, maxImages: 10 },
    onTurn: async (batch) => {
      batches.push(batch);
    },
    onCommand: async (message) => {
      commands.push(message.text);
      return true;
    },
  });

  push(hub, "/help");
  await sleep(50);

  assert.deepEqual(commands, ["/help"]);
  assert.deepEqual(batches, []);
  hub.stop();
});

test("回合结束后还没消费的 inbox 会开下一轮", async () => {
  const batches: IBatch[] = [];
  const hub = createSessionHub({
    timing: { silenceMs: 10, maxWaitMs: 200, maxTexts: 10, maxImages: 10 },
    onTurn: async (batch) => {
      batches.push(batch);
      if (batches.length === 1) {
        // 第一轮故意不等，让新消息留在 inbox
        push(hub, "第二轮", "m3");
      }
    },
  });

  push(hub, "第一轮");
  await sleep(700);

  assert.equal(batches.length, 2);
  assert.deepEqual(batches[1].texts, ["第二轮"]);
  hub.stop();
});
