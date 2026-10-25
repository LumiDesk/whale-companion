import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { createAggregator } = await import(
  "../src/channels/qq/aggregator.js"
);

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const msg = (msgId: string, text: string) => ({
  userId: "u1",
  msgId,
  text,
  images: [],
});

test("连发多条：停口后才合并成一轮", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const got: any[] = [];
  const agg = createAggregator(async (b) => {
    got.push(b);
  });

  agg.push(msg("m1", "在吗"));
  t.mock.timers.tick(2000);
  agg.push(msg("m2", "跟你说个事"));

  t.mock.timers.tick(2999);
  await settle();
  assert.equal(got.length, 0, "还在停口窗口中，不该回复");

  t.mock.timers.tick(1);
  await settle();
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].texts, ["在吗", "跟你说个事"]);
  assert.equal(got[0].msgId, "m2");

  t.mock.timers.reset();
});

test("一直发也不会饿死：到 maxWait 强制结算", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const got: any[] = [];
  const agg = createAggregator(async (b) => {
    got.push(b);
  });

  for (let i = 0; i < 5; i += 1) {
    agg.push(msg(`m${i}`, `第 ${i} 句`));
    t.mock.timers.tick(2000);
  }

  // t=10000：即使最后一条的停口计时器还没到，也必须结算
  await settle();
  assert.equal(got.length, 1);
  assert.equal(got[0].texts.length, 5);

  // 结算后新消息重新开一轮
  agg.push(msg("m9", "还有一句"));
  t.mock.timers.tick(3000);
  await settle();
  assert.equal(got.length, 2);
  assert.deepEqual(got[1].texts, ["还有一句"]);

  t.mock.timers.reset();
});

test("攒满上限立即结算，不等停口", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const got: any[] = [];
  const agg = createAggregator(async (b) => {
    got.push(b);
  });

  for (let i = 0; i < 10; i += 1) agg.push(msg(`m${i}`, `第 ${i} 句`));

  await settle();
  assert.equal(got.length, 1);
  assert.equal(got[0].texts.length, 10);

  t.mock.timers.reset();
});

test("不同用户各自计时，互不影响", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const got: any[] = [];
  const agg = createAggregator(async (b) => {
    got.push(b);
  });

  agg.push({ ...msg("a1", "A"), userId: "a" });
  agg.push({ ...msg("b1", "B"), userId: "b" });

  t.mock.timers.tick(3000);
  await settle();

  assert.equal(got.length, 2);
  assert.deepEqual(
    got.map((b) => b.userId).sort(),
    ["a", "b"],
  );

  t.mock.timers.reset();
});
