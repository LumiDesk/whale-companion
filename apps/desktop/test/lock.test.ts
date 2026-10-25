import assert from "node:assert/strict";
import test from "node:test";

const { isLockFresh, parseLock } = await import("../src/lib/lock");

test("解析正常的锁文件", () => {
  const lock = parseLock(
    JSON.stringify({ pid: 123, startedAt: 1000, heartbeat: 2000 }),
  );

  assert.deepEqual(lock, { pid: 123, startedAt: 1000, heartbeat: 2000 });
});

test("坏锁文件返回 null", () => {
  assert.equal(parseLock(null), null);
  assert.equal(parseLock("{bad"), null);
  assert.equal(parseLock(JSON.stringify({ pid: 0 })), null);
  assert.equal(parseLock(JSON.stringify({ pid: 1, startedAt: 0 })), null);
});

test("心跳过期就认为没有实例在跑", () => {
  const lock = { pid: 1, startedAt: 1000, heartbeat: 10_000 };

  assert.equal(isLockFresh(lock, 10_500, 300_000), true);
  assert.equal(isLockFresh(lock, 400_000, 300_000), false);
  assert.equal(isLockFresh(null, 10_500), false);
});
