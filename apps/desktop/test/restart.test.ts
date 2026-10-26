import assert from "node:assert/strict";
import test from "node:test";

const { decideAutoRestart, isBotActive } = await import("../src/lib/restart");

test("Bot 运行/启动中视为活跃", () => {
  assert.equal(isBotActive("running"), true);
  assert.equal(isBotActive("starting"), true);
  assert.equal(isBotActive("stopped"), false);
  assert.equal(isBotActive("crashed"), false);
});

test("正常停止、开关关闭、退出码 0 都不自动重启", () => {
  const state = { count: 0, lastAt: 0 };
  assert.deepEqual(
    decideAutoRestart(state, {
      wasStopping: true,
      code: 1,
      enabled: true,
    }),
    { kind: "none" },
  );
  assert.deepEqual(
    decideAutoRestart(state, {
      wasStopping: false,
      code: 1,
      enabled: false,
    }),
    { kind: "none" },
  );
  assert.deepEqual(
    decideAutoRestart(state, {
      wasStopping: false,
      code: 0,
      enabled: true,
    }),
    { kind: "none" },
  );
});

test("重启间隔依次为 3s / 10s / 30s，第 4 次放弃", () => {
  const now = 100_000;
  const first = decideAutoRestart(
    { count: 0, lastAt: 0 },
    { wasStopping: false, code: 1, enabled: true },
    now,
  );
  assert.deepEqual(first, {
    kind: "restart",
    count: 1,
    wait: 3000,
    lastAt: now,
  });

  const second = decideAutoRestart(
    { count: 1, lastAt: now },
    { wasStopping: false, code: 1, enabled: true },
    now + 1000,
  );
  assert.equal(second.kind, "restart");
  assert.equal(second.kind === "restart" ? second.wait : 0, 10_000);

  const third = decideAutoRestart(
    { count: 2, lastAt: now },
    { wasStopping: false, code: 1, enabled: true },
    now + 2000,
  );
  assert.equal(third.kind, "restart");
  assert.equal(third.kind === "restart" ? third.wait : 0, 30_000);

  const fourth = decideAutoRestart(
    { count: 3, lastAt: now },
    { wasStopping: false, code: 1, enabled: true },
    now + 3000,
  );
  assert.deepEqual(fourth, { kind: "give-up" });
});

test("超过 10 分钟没有崩溃，计数清零", () => {
  const decision = decideAutoRestart(
    { count: 3, lastAt: 0 },
    { wasStopping: false, code: 1, enabled: true },
    10 * 60_000 + 1,
  );
  assert.equal(decision.kind, "restart");
  assert.equal(decision.kind === "restart" ? decision.count : 0, 1);
});
